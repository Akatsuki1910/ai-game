export const JACK_COLORS = ["azure", "amber", "violet", "mint", "rose"] as const;
export type JackColor = (typeof JACK_COLORS)[number];

export type SourceState = "idle" | "live" | "cooldown";

export interface SourceJack {
  readonly index: number;
  readonly color: JackColor;
  state: SourceState;
  /** live: 残りタイムアウト秒 / cooldown: 再点灯までの残り秒 / idle: 0 */
  timer: number;
  /** live 化した瞬間のタイムアウト秒。残り時間の割合表示に使う。 */
  duration: number;
}

export interface DestinationJack {
  readonly index: number;
  readonly color: JackColor;
}

export type ConnectResult = "correct" | "wrong" | "invalid";

export interface ConnectEvent {
  result: ConnectResult;
  sourceIndex: number;
  destinationIndex: number;
  points: number;
}

export interface TimeoutEvent {
  sourceIndex: number;
}

export const SLOT_COUNT = JACK_COLORS.length;
export const LIVES_MAX = 3;

const INITIAL_LIVE_SECONDS = 3.4;
const MIN_LIVE_SECONDS = 1.4;
const LIVE_SECONDS_DECAY_PER_SUCCESS = 0.12;

const INITIAL_SPAWN_INTERVAL = 1.2;
const MIN_SPAWN_INTERVAL = 0.45;
const SPAWN_INTERVAL_DECAY_PER_SUCCESS = 0.05;

const INITIAL_MAX_CONCURRENT = 1;
const MAX_CONCURRENT_CAP = 3;
const CONCURRENT_INCREASE_EVERY = 5;

const COOLDOWN_SECONDS = 0.35;
const SCORE_PER_CONNECT = 100;

function shuffledColors(): JackColor[] {
  const colors = [...JACK_COLORS];
  for (let i = colors.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [colors[i], colors[j]] = [colors[j], colors[i]];
  }
  return colors;
}

/**
 * 夜間交換手のリアルタイム結線パズル。発信側(source)の色は常に固定順、
 * 受信側(destination)の色はラウンド開始時にシャッフルされる。プレイヤーは
 * 光った発信ジャックと同じ色の受信ジャックを見つけてケーブルを繋ぐ。
 */
export class SwitchboardWorld {
  private _sourceJacks: SourceJack[] = [];
  private _destinationJacks: DestinationJack[] = [];
  private spawnTimer = 0;
  private successCount = 0;

  score = 0;
  lives = LIVES_MAX;
  isOver = false;

  onConnect: ((event: ConnectEvent) => void) | null = null;
  onTimeout: ((event: TimeoutEvent) => void) | null = null;

  constructor() {
    this.reset();
  }

  get sourceJacks(): readonly SourceJack[] {
    return this._sourceJacks;
  }

  get destinationJacks(): readonly DestinationJack[] {
    return this._destinationJacks;
  }

  get liveDuration(): number {
    return Math.max(
      MIN_LIVE_SECONDS,
      INITIAL_LIVE_SECONDS - this.successCount * LIVE_SECONDS_DECAY_PER_SUCCESS,
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
    this._sourceJacks = JACK_COLORS.map((color, index) => ({
      index,
      color,
      state: "idle",
      timer: 0,
      duration: 0,
    }));
    this._destinationJacks = shuffledColors().map((color, index) => ({ index, color }));
    this.spawnTimer = 0;
    this.successCount = 0;
    this.score = 0;
    this.lives = LIVES_MAX;
    this.isOver = false;
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    for (const jack of this._sourceJacks) {
      if (jack.state === "live") {
        jack.timer -= deltaSeconds;
        if (jack.timer <= 0) this.handleTimeout(jack);
      } else if (jack.state === "cooldown") {
        jack.timer -= deltaSeconds;
        if (jack.timer <= 0) {
          jack.state = "idle";
          jack.timer = 0;
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

  /** プレイヤーが発信ジャックから受信ジャックへケーブルを繋いだ瞬間に呼ぶ。 */
  attemptConnect(sourceIndex: number, destinationIndex: number): ConnectResult {
    const source = this._sourceJacks[sourceIndex];
    const destination = this._destinationJacks[destinationIndex];
    if (this.isOver || !source || !destination || source.state !== "live") {
      const event: ConnectEvent = {
        result: "invalid",
        sourceIndex,
        destinationIndex,
        points: 0,
      };
      this.onConnect?.(event);
      return "invalid";
    }

    source.state = "cooldown";
    source.timer = COOLDOWN_SECONDS;

    if (destination.color === source.color) {
      this.successCount += 1;
      const points = SCORE_PER_CONNECT;
      this.score += points;
      this.onConnect?.({ result: "correct", sourceIndex, destinationIndex, points });
      return "correct";
    }

    this.lives -= 1;
    this.onConnect?.({ result: "wrong", sourceIndex, destinationIndex, points: 0 });
    if (this.lives <= 0) this.isOver = true;
    return "wrong";
  }

  private handleTimeout(jack: SourceJack): void {
    jack.state = "cooldown";
    jack.timer = COOLDOWN_SECONDS;
    this.lives -= 1;
    this.onTimeout?.({ sourceIndex: jack.index });
    if (this.lives <= 0) this.isOver = true;
  }

  private trySpawn(): void {
    const liveCount = this._sourceJacks.filter((jack) => jack.state === "live").length;
    if (liveCount >= this.maxConcurrent) return;

    const idleJacks = this._sourceJacks.filter((jack) => jack.state === "idle");
    if (idleJacks.length === 0) return;

    const picked = idleJacks[Math.floor(Math.random() * idleJacks.length)];
    const duration = this.liveDuration;
    picked.state = "live";
    picked.timer = duration;
    picked.duration = duration;
  }
}
