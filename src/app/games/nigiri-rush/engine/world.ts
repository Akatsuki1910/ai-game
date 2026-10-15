export const SUSHI_KINDS = ["tuna", "salmon", "egg", "cucumber"] as const;
export const HAZARD_KIND = "wasabi" as const;
export type OrderableKind = (typeof SUSHI_KINDS)[number];
export type SushiKind = OrderableKind | typeof HAZARD_KIND;

const ALL_KINDS: readonly SushiKind[] = [...SUSHI_KINDS, HAZARD_KIND];

export const LANE_COUNT = 3;
export const LIVES_MAX = 3;

export type LaneState = "empty" | "active" | "cooldown";

export interface Lane {
  readonly index: number;
  state: LaneState;
  kind: SushiKind | null;
  /** active: 取り逃すまでの残り秒 / cooldown: 次の出現までの残り秒 / empty: 0 */
  timer: number;
  /** active化した瞬間の残り秒。経過割合の表示に使う。 */
  duration: number;
}

export type GrabResult = "correct" | "wrongItem" | "hazard" | "invalid";

export interface GrabEvent {
  result: GrabResult;
  laneIndex: number;
  kind: SushiKind | null;
  points: number;
}

export interface MissEvent {
  laneIndex: number;
  kind: OrderableKind;
}

const INITIAL_ACTIVE_SECONDS = 3.2;
const MIN_ACTIVE_SECONDS = 1.3;
const ACTIVE_SECONDS_DECAY_PER_SUCCESS = 0.14;

const INITIAL_SPAWN_INTERVAL = 1.05;
const MIN_SPAWN_INTERVAL = 0.4;
const SPAWN_INTERVAL_DECAY_PER_SUCCESS = 0.045;

// 同時出現数を1から始めると、狙いのネタ(5種類中1つ)が出るまで毎回1レーン分の
// 出現サイクルを丸ごと待つことになり手持ち無沙汰になりやすい。2から始めて
// 同時に2つ流すことで、注文中のネタに出会う頻度を確保する。
const INITIAL_MAX_CONCURRENT = 2;
const MAX_CONCURRENT_CAP = LANE_COUNT;
const CONCURRENT_INCREASE_EVERY = 4;

const COOLDOWN_SECONDS = 0.3;
const SCORE_BASE = 100;
const STREAK_BONUS_PER = 15;
const STREAK_BONUS_CAP = 8;

function pickOrderableKind(exclude?: OrderableKind): OrderableKind {
  const options = exclude ? SUSHI_KINDS.filter((kind) => kind !== exclude) : SUSHI_KINDS;
  const picked = options[Math.floor(Math.random() * options.length)];
  return picked ?? SUSHI_KINDS[0];
}

// 出現するネタが完全に一様抽選だと、注文中のネタ(5種類中1つ)に出会う頻度が低く
// 待ち時間ばかりの手持ち無沙汰なゲームになってしまう。注文中のネタが出やすいよう
// 重みを付け、残りを他の4種類(わさびを含む)に均等に配る。
const TARGET_SPAWN_WEIGHT = 0.35;

function pickSpawnKind(target: OrderableKind): SushiKind {
  if (Math.random() < TARGET_SPAWN_WEIGHT) return target;
  const others = ALL_KINDS.filter((kind) => kind !== target);
  return others[Math.floor(Math.random() * others.length)] ?? HAZARD_KIND;
}

/**
 * 回転寿司の注文パズル。レーンを流れる寿司のうち、注文中のネタだけを狙って取る。
 * わさびに触れる・違うネタを取る・注文中のネタを取り逃すと、いずれもライフが減る。
 */
export class NigiriWorld {
  private _lanes: Lane[] = [];
  private spawnTimer = 0;
  private successCount = 0;
  private streak = 0;

  score = 0;
  lives = LIVES_MAX;
  isOver = false;
  target: OrderableKind = SUSHI_KINDS[0];

  onGrab: ((event: GrabEvent) => void) | null = null;
  onMiss: ((event: MissEvent) => void) | null = null;

  constructor() {
    this.reset();
  }

  get lanes(): readonly Lane[] {
    return this._lanes;
  }

  get activeDuration(): number {
    return Math.max(
      MIN_ACTIVE_SECONDS,
      INITIAL_ACTIVE_SECONDS - this.successCount * ACTIVE_SECONDS_DECAY_PER_SUCCESS,
    );
  }

  get spawnInterval(): number {
    return Math.max(
      MIN_SPAWN_INTERVAL,
      INITIAL_SPAWN_INTERVAL - this.successCount * SPAWN_INTERVAL_DECAY_PER_SUCCESS,
    );
  }

  get maxConcurrent(): number {
    return Math.min(
      MAX_CONCURRENT_CAP,
      INITIAL_MAX_CONCURRENT + Math.floor(this.successCount / CONCURRENT_INCREASE_EVERY),
    );
  }

  reset(): void {
    this._lanes = Array.from({ length: LANE_COUNT }, (_, index) => ({
      index,
      state: "empty" as LaneState,
      kind: null,
      timer: 0,
      duration: 0,
    }));
    this.spawnTimer = 0;
    this.successCount = 0;
    this.streak = 0;
    this.score = 0;
    this.lives = LIVES_MAX;
    this.isOver = false;
    this.target = pickOrderableKind();
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    for (const lane of this._lanes) {
      if (lane.state === "active") {
        lane.timer -= deltaSeconds;
        if (lane.timer <= 0) this.handleExpire(lane);
      } else if (lane.state === "cooldown") {
        lane.timer -= deltaSeconds;
        if (lane.timer <= 0) {
          lane.state = "empty";
          lane.timer = 0;
          lane.kind = null;
        }
      }
      if (this.isOver) return;
    }

    this.spawnTimer -= deltaSeconds;
    if (this.spawnTimer <= 0) {
      this.trySpawn();
      this.spawnTimer = this.spawnInterval;
    }
  }

  /** プレイヤーが指定レーンの寿司を取ろうとした瞬間に呼ぶ。 */
  attemptGrab(laneIndex: number): GrabResult {
    const lane = this._lanes[laneIndex];
    if (this.isOver || !lane || lane.state !== "active" || lane.kind === null) {
      this.onGrab?.({ result: "invalid", laneIndex, kind: lane?.kind ?? null, points: 0 });
      return "invalid";
    }

    const kind = lane.kind;
    lane.state = "cooldown";
    lane.timer = COOLDOWN_SECONDS;

    if (kind === HAZARD_KIND) {
      this.streak = 0;
      this.lives -= 1;
      this.onGrab?.({ result: "hazard", laneIndex, kind, points: 0 });
      if (this.lives <= 0) this.isOver = true;
      return "hazard";
    }

    if (kind === this.target) {
      const points = SCORE_BASE + Math.min(this.streak, STREAK_BONUS_CAP) * STREAK_BONUS_PER;
      this.streak += 1;
      this.successCount += 1;
      this.score += points;
      this.target = pickOrderableKind(kind);
      this.onGrab?.({ result: "correct", laneIndex, kind, points });
      return "correct";
    }

    this.streak = 0;
    this.lives -= 1;
    this.onGrab?.({ result: "wrongItem", laneIndex, kind, points: 0 });
    if (this.lives <= 0) this.isOver = true;
    return "wrongItem";
  }

  private handleExpire(lane: Lane): void {
    const kind = lane.kind;
    lane.state = "cooldown";
    lane.timer = COOLDOWN_SECONDS;
    if (kind !== null && kind !== HAZARD_KIND && kind === this.target) {
      this.streak = 0;
      this.lives -= 1;
      this.onMiss?.({ laneIndex: lane.index, kind });
      if (this.lives <= 0) this.isOver = true;
    }
  }

  private trySpawn(): void {
    const activeCount = this._lanes.filter((lane) => lane.state === "active").length;
    if (activeCount >= this.maxConcurrent) return;

    const emptyLanes = this._lanes.filter((lane) => lane.state === "empty");
    if (emptyLanes.length === 0) return;

    const lane = emptyLanes[Math.floor(Math.random() * emptyLanes.length)];
    if (!lane) return;
    const kind = pickSpawnKind(this.target);
    const duration = this.activeDuration;
    lane.state = "active";
    lane.kind = kind;
    lane.timer = duration;
    lane.duration = duration;
  }
}
