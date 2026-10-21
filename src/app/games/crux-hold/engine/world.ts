export type Hand = "left" | "right";

export interface GrabJudgedEvent {
  hand: Hand;
  isPerfect: boolean;
  points: number;
  combo: number;
}

export interface GrabMissedEvent {
  reason: "wrong-hand" | "timing" | "timeout";
  leftGrip: number;
  rightGrip: number;
}

export interface FallEvent {
  heightClimbed: number;
  maxCombo: number;
}

export const START_GRIP = 100;

export const BASE_POINTS = 100;
const PERFECT_BONUS = 50;
const COMBO_BONUS_PER_STREAK = 8;
const MAX_COMBO_BONUS = 160;

const HEIGHT_GAIN_PER_GRAB = 1;
const PERFECT_HEIGHT_BONUS = 0.4;

/** 掴んだ直後、新しくアンカーになる手が得る「掴み直し」の余裕分。 */
const GRAB_RELIEF = 16;
/** 伸ばしている(アンカーでない)手が休んで回復する速度(/秒)。 */
const REACH_HAND_REGEN_RATE = 10;
/** 失敗(誤入力・タイミングずれ・見逃し)1回でアンカー側の腕力が失うぶん。 */
const MISS_PENALTY = 14;

const MIN_SWEEP_SECONDS = 1.0;
const MAX_SWEEP_SECONDS = 2.2;
const SWEEP_SECONDS_DECAY_PER_METER = 0.015;

const MIN_WINDOW_WIDTH = 0.15;
const MAX_WINDOW_WIDTH = 0.34;
const WINDOW_WIDTH_DECAY_PER_METER = 0.004;

const MIN_DRAIN_RATE = 5;
const MAX_DRAIN_RATE = 15;
const DRAIN_RATE_GROWTH_PER_METER = 0.08;

/** 登った高さが上がるほど、1回の「伸ばし」にかけられる時間(秒)は短くなる。 */
export function sweepSecondsForHeight(heightClimbed: number): number {
  return Math.max(
    MIN_SWEEP_SECONDS,
    MAX_SWEEP_SECONDS - heightClimbed * SWEEP_SECONDS_DECAY_PER_METER,
  );
}

/** 登った高さが上がるほど、掴める「当たり帯」の幅は狭くなる。 */
export function windowWidthForHeight(heightClimbed: number): number {
  return Math.max(
    MIN_WINDOW_WIDTH,
    MAX_WINDOW_WIDTH - heightClimbed * WINDOW_WIDTH_DECAY_PER_METER,
  );
}

/** 登った高さが上がるほど、ぶら下がっている側の腕力が減る速さ(/秒)は上がる。 */
export function drainRateForHeight(heightClimbed: number): number {
  return Math.min(MAX_DRAIN_RATE, MIN_DRAIN_RATE + heightClimbed * DRAIN_RATE_GROWTH_PER_METER);
}

function oppositeHand(hand: Hand): Hand {
  return hand === "left" ? "right" : "left";
}

function clampGrip(value: number): number {
  return Math.min(START_GRIP, Math.max(0, value));
}

/**
 * 岩壁を交互の手で登り続けるリアルタイム・ボルダリング反射パズルの純粋ロジック層。
 * React / pixi.js には一切依存しない。画面サイズにも依存しない。
 *
 * 常に片方の手(アンカー)が体重を支えて腕力(grip)を消耗し、もう片方の手(requiredHand)が
 * 次のホールドへ伸ばされて休みながら腕力を回復する。伸ばしている手で、刻々と伸びていく
 * 「リーチ(reach)」が当たり帯(windowStart〜windowEnd)に入っている間にタップすると
 * ホールドを掴んで高さが進み、支える手が入れ替わる。手を間違える・タイミングを外す・
 * 見逃す(リーチが1.0に達する)といずれもアンカー側の腕力が減り、両腕とも0になると滑落する。
 */
export class CruxHoldWorld {
  score = 0;
  heightClimbed = 0;
  combo = 0;
  maxCombo = 0;
  leftGrip = START_GRIP;
  rightGrip = START_GRIP;
  requiredHand: Hand = "right";
  reach = 0;
  windowStart = 0;
  windowEnd = 0;
  sweepSeconds = MAX_SWEEP_SECONDS;
  isOver = false;

  onGrabJudged: ((event: GrabJudgedEvent) => void) | null = null;
  onGrabMissed: ((event: GrabMissedEvent) => void) | null = null;
  onFall: ((event: FallEvent) => void) | null = null;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.score = 0;
    this.heightClimbed = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.leftGrip = START_GRIP;
    this.rightGrip = START_GRIP;
    this.requiredHand = "right";
    this.isOver = false;
    this.rollWindow();
  }

  /** 体重を支えている(消耗していく)側の手。 */
  get anchorHand(): Hand {
    return oppositeHand(this.requiredHand);
  }

  /** 現在のリーチが当たり帯の中にあるか。UI側の「掴めるタイミング」表示に使う。 */
  get isReachInWindow(): boolean {
    return this.reach >= this.windowStart && this.reach <= this.windowEnd;
  }

  getGrip(hand: Hand): number {
    return hand === "left" ? this.leftGrip : this.rightGrip;
  }

  private setGrip(hand: Hand, value: number): void {
    const clamped = clampGrip(value);
    if (hand === "left") this.leftGrip = clamped;
    else this.rightGrip = clamped;
  }

  private rollWindow(): void {
    const width = windowWidthForHeight(this.heightClimbed);
    this.windowStart = Math.random() * (1 - width);
    this.windowEnd = this.windowStart + width;
    this.sweepSeconds = sweepSecondsForHeight(this.heightClimbed);
    this.reach = 0;
  }

  private checkFall(): boolean {
    if (this.leftGrip <= 0 || this.rightGrip <= 0) {
      this.isOver = true;
      this.onFall?.({ heightClimbed: this.heightClimbed, maxCombo: this.maxCombo });
      return true;
    }
    return false;
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    const anchor = this.anchorHand;
    this.setGrip(
      anchor,
      this.getGrip(anchor) - drainRateForHeight(this.heightClimbed) * deltaSeconds,
    );
    this.setGrip(
      this.requiredHand,
      this.getGrip(this.requiredHand) + REACH_HAND_REGEN_RATE * deltaSeconds,
    );
    if (this.checkFall()) return;

    this.reach += deltaSeconds / this.sweepSeconds;
    if (this.reach >= 1) {
      this.resolveMiss("timeout");
    }
  }

  /** プレイヤーが左手/右手でホールドを掴みにいった瞬間に呼ぶ。 */
  tapHand(hand: Hand): void {
    if (this.isOver) return;

    if (hand !== this.requiredHand) {
      this.resolveMiss("wrong-hand");
      return;
    }
    if (!this.isReachInWindow) {
      this.resolveMiss("timing");
      return;
    }
    this.resolveGrab();
  }

  private resolveGrab(): void {
    const windowWidth = this.windowEnd - this.windowStart;
    const windowCenter = this.windowStart + windowWidth / 2;
    const isPerfect = Math.abs(this.reach - windowCenter) <= windowWidth * 0.25;

    this.combo += 1;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    const comboBonus = Math.min(MAX_COMBO_BONUS, this.combo * COMBO_BONUS_PER_STREAK);
    const perfectBonus = isPerfect ? PERFECT_BONUS : 0;
    const points = BASE_POINTS + comboBonus + perfectBonus;
    this.score += points;
    this.heightClimbed += HEIGHT_GAIN_PER_GRAB + (isPerfect ? PERFECT_HEIGHT_BONUS : 0);

    const grabbedHand = this.requiredHand;
    this.setGrip(grabbedHand, this.getGrip(grabbedHand) + GRAB_RELIEF);
    this.requiredHand = oppositeHand(grabbedHand);

    this.onGrabJudged?.({ hand: grabbedHand, isPerfect, points, combo: this.combo });
    this.rollWindow();
  }

  private resolveMiss(reason: GrabMissedEvent["reason"]): void {
    this.combo = 0;
    const anchor = this.anchorHand;
    this.setGrip(anchor, this.getGrip(anchor) - MISS_PENALTY);
    this.onGrabMissed?.({ reason, leftGrip: this.leftGrip, rightGrip: this.rightGrip });
    if (this.checkFall()) return;
    this.rollWindow();
  }
}
