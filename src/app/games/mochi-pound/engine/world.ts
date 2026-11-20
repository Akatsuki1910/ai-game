export type StrikeAccuracy = "perfect" | "good" | "miss" | "hand";

export interface StrikeEvent {
  accuracy: StrikeAccuracy;
  points: number;
  combo: number;
}

export interface RoundCompletedEvent {
  /** クリアし終えた臼(うす)のラウンド番号(次のラウンドではなく、たった今ついた臼)。 */
  round: number;
  bonus: number;
}

export const START_LIVES = 3;
export const AMPLITUDE = 0.95; // 杵が振れる最大角度(ラジアン, 鉛直下向きからの片側)。

const BASE_OMEGA = 1.6; // rad/秒
const OMEGA_GROWTH_PER_ROUND = 0.15;
const MAX_OMEGA = 3.4;

const BASE_WINDOW = 0.5; // rad。この範囲内なら GOOD。
const WINDOW_DECAY_PER_ROUND = 0.035;
const MIN_WINDOW = 0.22;
const PERFECT_RATIO = 0.4; // PERFECT判定はウィンドウ幅のこの割合以内。

const BASE_HAND_CLEAR_SECONDS = 0.55;
const HAND_CLEAR_DECAY_PER_ROUND = 0.03;
const MIN_HAND_CLEAR_SECONDS = 0.28;

const BASE_STRETCH_GOAL = 600;
const STRETCH_GOAL_GROWTH_PER_ROUND = 40;
const MAX_STRETCH_GOAL = 1000;

const PERFECT_STRETCH_GAIN = 140;
const GOOD_STRETCH_GAIN = 80;
const PERFECT_POINTS = 120;
const GOOD_POINTS = 60;
const COMBO_BONUS_PER_STREAK = 8;
const MAX_COMBO_BONUS = 80;
const ROUND_BASE_BONUS = 150;
const ROUND_BONUS_PER_LEVEL = 20;

function omegaForRound(round: number): number {
  return Math.min(MAX_OMEGA, BASE_OMEGA + (round - 1) * OMEGA_GROWTH_PER_ROUND);
}

function windowForRound(round: number): number {
  return Math.max(MIN_WINDOW, BASE_WINDOW - (round - 1) * WINDOW_DECAY_PER_ROUND);
}

function handClearForRound(round: number): number {
  return Math.max(
    MIN_HAND_CLEAR_SECONDS,
    BASE_HAND_CLEAR_SECONDS - (round - 1) * HAND_CLEAR_DECAY_PER_ROUND,
  );
}

function stretchGoalForRound(round: number): number {
  return Math.min(
    MAX_STRETCH_GOAL,
    BASE_STRETCH_GOAL + (round - 1) * STRETCH_GOAL_GROWTH_PER_ROUND,
  );
}

/**
 * 杵(きね)を振り下ろして餅をつくリアルタイム・タイミングパズルの純粋ロジック層。
 * 杵は鉛直下向きを中心に振り子運動を続けており、最下点(角度0)付近でタップすると
 * 餅が伸びる。合いの手(返し手)が餅をひっくり返す短い時間帯に振り下ろすと
 * 手を叩いてしまい失敗になる。React / pixi.js には一切依存しない。
 */
export class MochiPoundWorld {
  round = 1;
  lives = START_LIVES;
  score = 0;
  combo = 0;
  stretch = 0;
  stretchGoal = stretchGoalForRound(1);
  angle = 0;
  isOver = false;
  handCooldownRemaining = 0;

  private omega = omegaForRound(1);
  private windowRad = windowForRound(1);
  private handClearSeconds = handClearForRound(1);
  private time = 0;

  onStrike: ((event: StrikeEvent) => void) | null = null;
  onRoundCompleted: ((event: RoundCompletedEvent) => void) | null = null;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.round = 1;
    this.lives = START_LIVES;
    this.score = 0;
    this.combo = 0;
    this.stretch = 0;
    this.isOver = false;
    this.handCooldownRemaining = 0;
    this.time = 0;
    this.angle = 0;
    this.applyRoundParams();
  }

  get isHandPresent(): boolean {
    return this.handCooldownRemaining > 0;
  }

  get perfectThreshold(): number {
    return this.windowRad * PERFECT_RATIO;
  }

  get goodThreshold(): number {
    return this.windowRad;
  }

  private applyRoundParams(): void {
    this.omega = omegaForRound(this.round);
    this.windowRad = windowForRound(this.round);
    this.handClearSeconds = handClearForRound(this.round);
    this.stretchGoal = stretchGoalForRound(this.round);
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;
    this.time += deltaSeconds;
    this.angle = AMPLITUDE * Math.sin(this.omega * this.time);
    if (this.handCooldownRemaining > 0) {
      this.handCooldownRemaining = Math.max(0, this.handCooldownRemaining - deltaSeconds);
    }
  }

  /** 杵を振り下ろす(クリック/タップ/Enterキー)。 */
  strike(): void {
    if (this.isOver) return;

    if (this.isHandPresent) {
      this.registerFailure("hand");
      return;
    }

    const offset = Math.abs(this.angle);
    if (offset > this.windowRad) {
      this.registerFailure("miss");
      return;
    }

    const accuracy: StrikeAccuracy = offset <= this.perfectThreshold ? "perfect" : "good";
    const stretchGain = accuracy === "perfect" ? PERFECT_STRETCH_GAIN : GOOD_STRETCH_GAIN;
    const pointsBase = accuracy === "perfect" ? PERFECT_POINTS : GOOD_POINTS;

    this.combo += 1;
    const comboBonus = Math.min(MAX_COMBO_BONUS, this.combo * COMBO_BONUS_PER_STREAK);
    const points = Math.round(pointsBase + comboBonus);
    this.score += points;
    this.stretch = Math.min(this.stretchGoal, this.stretch + stretchGain);
    this.handCooldownRemaining = this.handClearSeconds;

    this.onStrike?.({ accuracy, points, combo: this.combo });

    if (this.stretch >= this.stretchGoal) {
      const bonus = ROUND_BASE_BONUS + this.round * ROUND_BONUS_PER_LEVEL;
      this.score += bonus;
      this.onRoundCompleted?.({ round: this.round, bonus });
      this.round += 1;
      this.stretch = 0;
      this.lives = Math.min(START_LIVES, this.lives + 1);
      this.applyRoundParams();
    }
  }

  private registerFailure(accuracy: "miss" | "hand"): void {
    this.combo = 0;
    this.handCooldownRemaining = 0;
    this.lives = Math.max(0, this.lives - 1);
    this.onStrike?.({ accuracy, points: 0, combo: 0 });
    if (this.lives <= 0) this.isOver = true;
  }
}
