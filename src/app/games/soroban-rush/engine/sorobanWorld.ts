export interface RodState {
  isHeavenDown: boolean;
  earthUpCount: number;
}

export type RoundFeedback = "correct" | "wrong" | "timeout";

export const INITIAL_DIGIT_COUNT = 2;
export const MAX_DIGIT_COUNT = 4;
export const START_LIVES = 3;
export const EARTH_BEADS_PER_ROD = 4;

const ROUNDS_PER_DIGIT_TIER = 5;
const BASE_TIME_PER_DIGIT = 5;
const TIME_DECAY_PER_ROUND = 0.3;
const MIN_TIME_LIMIT = 4;
const BASE_POINTS_PER_DIGIT = 50;
const MAX_TIME_BONUS = 100;
const FEEDBACK_DURATION = 0.6;

function digitFromRod(rod: RodState): number {
  return (rod.isHeavenDown ? 5 : 0) + rod.earthUpCount;
}

function digitCountForRound(round: number): number {
  const tier = Math.floor((round - 1) / ROUNDS_PER_DIGIT_TIER);
  return Math.min(INITIAL_DIGIT_COUNT + tier, MAX_DIGIT_COUNT);
}

function timeLimitForRound(round: number, digitCount: number): number {
  const base = BASE_TIME_PER_DIGIT * digitCount;
  const decayed = base - TIME_DECAY_PER_ROUND * (round - 1);
  return Math.max(MIN_TIME_LIMIT, decayed);
}

function randomTargetNumber(digitCount: number): number {
  const min = digitCount > 1 ? 10 ** (digitCount - 1) : 0;
  const max = 10 ** digitCount - 1;
  return min + Math.floor(Math.random() * (max - min + 1));
}

/**
 * そろばん（4つ珠）の盤面と、目標の数に合わせるラウンド進行を扱う純粋ロジック。
 * 珠の見た目の座標やアニメーションは描画側（Game コンポーネント）の責務とし、
 * ここでは「各桁の珠の状態」と「現在の数・目標の数・残り時間・ライフ」だけを持つ。
 */
export class SorobanWorld {
  digitCount = INITIAL_DIGIT_COUNT;
  rods: RodState[] = [];
  targetNumber = 0;
  round = 1;
  score = 0;
  lives = START_LIVES;
  timeRemaining = 0;
  roundTimeLimit = 0;
  isOver = false;
  selectedRodIndex = 0;
  feedback: RoundFeedback | null = null;
  private feedbackAge = 0;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.score = 0;
    this.lives = START_LIVES;
    this.round = 1;
    this.digitCount = INITIAL_DIGIT_COUNT;
    this.isOver = false;
    this.feedback = null;
    this.feedbackAge = 0;
    this.spawnRound();
  }

  get currentNumber(): number {
    return this.rods.reduce(
      (total, rod, index) => total + digitFromRod(rod) * 10 ** (this.digitCount - 1 - index),
      0,
    );
  }

  digitAt(index: number): number {
    const rod = this.rods[index];
    return rod ? digitFromRod(rod) : 0;
  }

  setRodHeaven(index: number, isDown: boolean): void {
    const rod = this.rods[index];
    if (!rod) return;
    rod.isHeavenDown = isDown;
  }

  toggleRodHeaven(index: number): void {
    const rod = this.rods[index];
    if (!rod) return;
    rod.isHeavenDown = !rod.isHeavenDown;
  }

  /** ratio: 0(棚の下端=0個) 〜 1(梁のすぐ下=4個) で一の珠の数を連続的に設定する。ドラッグ操作用。 */
  setRodEarthFromRatio(index: number, ratio: number): void {
    const rod = this.rods[index];
    if (!rod) return;
    const clampedRatio = Math.min(Math.max(ratio, 0), 1);
    rod.earthUpCount = Math.round(clampedRatio * EARTH_BEADS_PER_ROD);
  }

  /** キーボード操作用。桁の値を 0-9 で +1/-1 し、珠の状態に変換する。 */
  adjustRodDigit(index: number, delta: number): void {
    const rod = this.rods[index];
    if (!rod) return;
    const nextDigit = (((digitFromRod(rod) + delta) % 10) + 10) % 10;
    rod.isHeavenDown = nextDigit >= 5;
    rod.earthUpCount = nextDigit % 5;
  }

  selectRod(delta: number): void {
    if (this.digitCount === 0) return;
    this.selectedRodIndex =
      (((this.selectedRodIndex + delta) % this.digitCount) + this.digitCount) % this.digitCount;
  }

  submit(): void {
    if (this.isOver) return;

    if (this.currentNumber === this.targetNumber) {
      const timeRatio = this.roundTimeLimit > 0 ? this.timeRemaining / this.roundTimeLimit : 0;
      const points =
        BASE_POINTS_PER_DIGIT * this.digitCount + Math.round(MAX_TIME_BONUS * timeRatio);
      this.score += points;
      this.setFeedback("correct");
      this.round += 1;
      this.digitCount = digitCountForRound(this.round);
      this.spawnRound();
      return;
    }

    this.loseLife("wrong", { advanceRound: false });
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    if (this.feedback) {
      this.feedbackAge += deltaSeconds;
      if (this.feedbackAge >= FEEDBACK_DURATION) {
        this.feedback = null;
        this.feedbackAge = 0;
      }
    }

    this.timeRemaining = Math.max(0, this.timeRemaining - deltaSeconds);
    if (this.timeRemaining <= 0) {
      this.loseLife("timeout", { advanceRound: true });
    }
  }

  private loseLife(reason: RoundFeedback, options: { advanceRound: boolean }): void {
    this.lives -= 1;
    this.setFeedback(reason);
    if (this.lives <= 0) {
      this.isOver = true;
      return;
    }
    if (options.advanceRound) {
      this.round += 1;
      this.digitCount = digitCountForRound(this.round);
      this.spawnRound();
    }
  }

  private setFeedback(feedback: RoundFeedback): void {
    this.feedback = feedback;
    this.feedbackAge = 0;
  }

  private spawnRound(): void {
    this.roundTimeLimit = timeLimitForRound(this.round, this.digitCount);
    this.timeRemaining = this.roundTimeLimit;
    this.targetNumber = randomTargetNumber(this.digitCount);
    this.rods = Array.from({ length: this.digitCount }, () => ({
      isHeavenDown: false,
      earthUpCount: 0,
    }));
    this.selectedRodIndex = 0;
  }
}
