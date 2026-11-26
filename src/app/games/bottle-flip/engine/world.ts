export type FlipOutcome = "perfect" | "good" | "fail";

export interface FlipResultEvent {
  readonly outcome: FlipOutcome;
  readonly power: number;
  readonly rotations: number;
  readonly flightDuration: number;
  readonly angleErrorRad: number;
  readonly scoreGained: number;
  readonly combo: number;
  readonly bestCombo: number;
  readonly successes: number;
  readonly lives: number;
  readonly isGameOver: boolean;
}

export const START_LIVES = 3;
export const GRAVITY = 9.8;
export const MIN_LAUNCH_SPEED = 4;
export const MAX_LAUNCH_SPEED = 9;
export const MIN_SPIN_RATE = 3;
export const MAX_SPIN_RATE = 18;

const PERFECT_TOLERANCE_BASE = 0.24;
const PERFECT_TOLERANCE_MIN = 0.08;
const PERFECT_TOLERANCE_STEP = 0.006;
const GOOD_TOLERANCE_BASE = 0.55;
const GOOD_TOLERANCE_MIN = 0.24;
const GOOD_TOLERANCE_STEP = 0.01;

const PERFECT_SCORE_BASE = 100;
const PERFECT_COMBO_SCORE = 20;
const GOOD_SCORE = 35;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** 角度を (-π, π] に正規化する。 */
function wrapAngle(angle: number): number {
  let wrapped = angle % (2 * Math.PI);
  if (wrapped > Math.PI) wrapped -= 2 * Math.PI;
  else if (wrapped <= -Math.PI) wrapped += 2 * Math.PI;
  return wrapped;
}

function launchSpeedForPower(power: number): number {
  return MIN_LAUNCH_SPEED + power * (MAX_LAUNCH_SPEED - MIN_LAUNCH_SPEED);
}

function spinRateForPower(power: number): number {
  return MIN_SPIN_RATE + power * (MAX_SPIN_RATE - MIN_SPIN_RATE);
}

/** 真上に投げて同じ高さへ落ちてくるまでの滞空時間。 */
function flightDurationForPower(power: number): number {
  return (2 * launchSpeedForPower(power)) / GRAVITY;
}

/** 滞空中に積算される総回転角(ラジアン)。power に対して単調増加。 */
function totalRotationForPower(power: number): number {
  return spinRateForPower(power) * flightDurationForPower(power);
}

/**
 * ボトルを長押し(チャージ)してから離す、リアルタイム・ボトルフリップ物理パズル。
 * パワー(0〜1)がそのまま「投げ上げる速さ」と「回転の速さ」の両方を決めるため、
 * 強く投げるほど滞空時間は伸びるが回転も速くなり、ちょうど整数回転(0,1,2,...回)で
 * 着地できたときだけ立って決まる。着地するたびに許容角度が狭くなっていく。
 */
export class BottleFlipWorld {
  score = 0;
  lives = START_LIVES;
  combo = 0;
  bestCombo = 0;
  successes = 0;
  isOver = false;
  lastResult: FlipResultEvent | null = null;

  reset(): void {
    this.score = 0;
    this.lives = START_LIVES;
    this.combo = 0;
    this.bestCombo = 0;
    this.successes = 0;
    this.isOver = false;
    this.lastResult = null;
  }

  get perfectTolerance(): number {
    return Math.max(
      PERFECT_TOLERANCE_MIN,
      PERFECT_TOLERANCE_BASE - this.successes * PERFECT_TOLERANCE_STEP,
    );
  }

  get goodTolerance(): number {
    return Math.max(GOOD_TOLERANCE_MIN, GOOD_TOLERANCE_BASE - this.successes * GOOD_TOLERANCE_STEP);
  }

  /** パワー(0〜1)でボトルを投げ上げる。結果は滞空時間を待たず即座に確定する。 */
  attemptFlip(powerRaw: number): FlipResultEvent {
    const power = clamp01(powerRaw);

    if (this.isOver) {
      return {
        outcome: "fail",
        power,
        rotations: 0,
        flightDuration: 0,
        angleErrorRad: 0,
        scoreGained: 0,
        combo: this.combo,
        bestCombo: this.bestCombo,
        successes: this.successes,
        lives: this.lives,
        isGameOver: true,
      };
    }

    const flightDuration = flightDurationForPower(power);
    const totalRotation = totalRotationForPower(power);
    const rotations = totalRotation / (2 * Math.PI);
    const angleErrorRad = Math.abs(wrapAngle(totalRotation));

    let outcome: FlipOutcome;
    let scoreGained = 0;

    if (angleErrorRad <= this.perfectTolerance) {
      outcome = "perfect";
      this.combo += 1;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      scoreGained = PERFECT_SCORE_BASE + this.combo * PERFECT_COMBO_SCORE;
      this.successes += 1;
    } else if (angleErrorRad <= this.goodTolerance) {
      outcome = "good";
      this.combo = 0;
      scoreGained = GOOD_SCORE;
      this.successes += 1;
    } else {
      outcome = "fail";
      this.combo = 0;
      this.lives = Math.max(0, this.lives - 1);
    }

    this.score += scoreGained;
    if (this.lives <= 0) this.isOver = true;

    const event: FlipResultEvent = {
      outcome,
      power,
      rotations,
      flightDuration,
      angleErrorRad,
      scoreGained,
      combo: this.combo,
      bestCombo: this.bestCombo,
      successes: this.successes,
      lives: this.lives,
      isGameOver: this.isOver,
    };
    this.lastResult = event;
    return event;
  }
}
