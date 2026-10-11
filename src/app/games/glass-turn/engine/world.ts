export type FinishResult = "onTarget" | "offSpec";
export type FailReason = "popped" | "collapsed";

export interface FinishEvent {
  round: number;
  result: FinishResult;
  points: number;
  radius: number;
  wobble: number;
}

export interface FailEvent {
  round: number;
  reason: FailReason;
}

export const LIVES_MAX = 3;
export const INITIAL_TEMPERATURE = 10;
export const MAX_RADIUS = 150;
export const TARGET_CENTER_MIN = 45;
export const TARGET_CENTER_MAX = 115;

const IDLE_COOL_RATE = 0.5;
const BLOW_COOL_RATE = 1.5;
const BLOW_GROWTH_RATE = 30;

const WOBBLE_GROWTH_RATE = 0.9;
const WOBBLE_SETTLE_ROLLING_RATE = 1.8;
const WOBBLE_IDLE_DECAY_RATE = 0.35;
const ROLL_GRACE_SECONDS = 0.35;

const INITIAL_BAND_HALF_WIDTH = 20;
const MIN_BAND_HALF_WIDTH = 9;
const BAND_SHRINK_PER_ROUND = 1.2;

const MAX_COOL_MULTIPLIER = 1.6;
const COOL_MULTIPLIER_GROWTH_PER_ROUND = 0.04;

const SCORE_BASE_ON_TARGET = 120;
const SCORE_COMBO_BONUS = 20;
const SCORE_BASE_OFF_SPEC = 25;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * 吹きガラスの玉を膨らませて狙った大きさで仕上げるリアルタイム工芸パズルの
 * 純粋ロジック層。React / pixi.js には依存しない。
 *
 * 送風(setBlowing)で玉は膨らむが同時に冷めやすくなり、転がし(registerRoll)を
 * 怠ると玉が歪んで(wobble)崩れる。目標の大きさ(targetMin〜targetMax)で
 * finish()するほど高得点。膨らませすぎるとポンと割れ、歪みすぎると崩れる。
 */
export class GlassTurnWorld {
  private isBlowing = false;
  private timeSinceLastRoll = Number.POSITIVE_INFINITY;
  private center = TARGET_CENTER_MIN;

  radius = 0;
  wobble = 0;
  temperature = INITIAL_TEMPERATURE;
  round = 1;
  score = 0;
  combo = 0;
  lives = LIVES_MAX;
  isOver = false;

  onFinish: ((event: FinishEvent) => void) | null = null;
  onFail: ((event: FailEvent) => void) | null = null;

  constructor() {
    this.reset();
  }

  get bandHalfWidth(): number {
    return Math.max(
      MIN_BAND_HALF_WIDTH,
      INITIAL_BAND_HALF_WIDTH - (this.round - 1) * BAND_SHRINK_PER_ROUND,
    );
  }

  get targetCenter(): number {
    return this.center;
  }

  get targetMin(): number {
    return this.center - this.bandHalfWidth;
  }

  get targetMax(): number {
    return this.center + this.bandHalfWidth;
  }

  get isRolling(): boolean {
    return this.timeSinceLastRoll < ROLL_GRACE_SECONDS;
  }

  get coolMultiplier(): number {
    return Math.min(MAX_COOL_MULTIPLIER, 1 + (this.round - 1) * COOL_MULTIPLIER_GROWTH_PER_ROUND);
  }

  reset(): void {
    this.round = 1;
    this.score = 0;
    this.combo = 0;
    this.lives = LIVES_MAX;
    this.isOver = false;
    this.startPiece();
  }

  /** 送風(ポインタ/Enter長押し)の状態を設定する。押している間、玉が膨らみ続ける。 */
  setBlowing(active: boolean): void {
    if (this.isOver) return;
    this.isBlowing = active;
  }

  /** 吹き竿を転がした(左右に振った/矢印キーを押した)ことを記録する。歪みを抑える。 */
  registerRoll(): void {
    if (this.isOver) return;
    this.timeSinceLastRoll = 0;
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    this.timeSinceLastRoll += deltaSeconds;
    const rolling = this.isRolling;

    if (this.isBlowing) {
      this.radius += BLOW_GROWTH_RATE * deltaSeconds;
      this.temperature -= BLOW_COOL_RATE * this.coolMultiplier * deltaSeconds;
    } else {
      this.temperature -= IDLE_COOL_RATE * this.coolMultiplier * deltaSeconds;
    }
    this.temperature = Math.max(0, this.temperature);

    if (this.isBlowing && !rolling) {
      this.wobble = clamp(this.wobble + WOBBLE_GROWTH_RATE * deltaSeconds, 0, 1);
    } else if (rolling) {
      this.wobble = clamp(this.wobble - WOBBLE_SETTLE_ROLLING_RATE * deltaSeconds, 0, 1);
    } else {
      this.wobble = clamp(this.wobble - WOBBLE_IDLE_DECAY_RATE * deltaSeconds, 0, 1);
    }

    if (this.radius >= MAX_RADIUS) {
      this.radius = MAX_RADIUS;
      this.handleFail("popped");
      return;
    }
    if (this.wobble >= 1) {
      this.wobble = 1;
      this.handleFail("collapsed");
      return;
    }
    if (this.temperature <= 0) {
      this.finish();
    }
  }

  /**
   * 冷め切る前に自分の判断で仕上げる。目標帯の中なら高得点、外れていても
   * 歪みが少なければ小さく加点する(全損にはしない)。
   */
  finish(): FinishResult | null {
    if (this.isOver) return null;

    const inBand = this.radius >= this.targetMin && this.radius <= this.targetMax;
    const quality = 1 - this.wobble;
    let points: number;
    let result: FinishResult;

    if (inBand) {
      const centerDistanceRatio = Math.min(
        1,
        Math.abs(this.radius - this.center) / this.bandHalfWidth,
      );
      const base = SCORE_BASE_ON_TARGET * (1 - 0.5 * centerDistanceRatio) * (0.4 + 0.6 * quality);
      points = Math.max(0, Math.round(base)) + this.combo * SCORE_COMBO_BONUS;
      this.combo += 1;
      result = "onTarget";
    } else {
      points = Math.max(0, Math.round(SCORE_BASE_OFF_SPEC * (0.3 + 0.7 * quality)));
      this.combo = 0;
      result = "offSpec";
    }

    this.score += points;
    const round = this.round;
    const { radius, wobble } = this;
    this.onFinish?.({ round, result, points, radius, wobble });
    this.advanceRound();
    return result;
  }

  private handleFail(reason: FailReason): void {
    this.combo = 0;
    this.lives -= 1;
    this.onFail?.({ round: this.round, reason });
    if (this.lives <= 0) {
      this.isOver = true;
      return;
    }
    this.advanceRound();
  }

  private advanceRound(): void {
    this.round += 1;
    this.startPiece();
  }

  private startPiece(): void {
    this.radius = 0;
    this.wobble = 0;
    this.temperature = INITIAL_TEMPERATURE;
    this.isBlowing = false;
    this.timeSinceLastRoll = Number.POSITIVE_INFINITY;
    this.center = TARGET_CENTER_MIN + Math.random() * (TARGET_CENTER_MAX - TARGET_CENTER_MIN);
  }
}
