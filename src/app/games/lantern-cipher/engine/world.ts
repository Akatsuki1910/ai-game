const MIN_SLOTS = 3;
const MAX_SLOTS = 6;
const SLOTS_LEVEL_STEP = 2;

const MIN_COLORS = 4;
const MAX_COLORS = 8;
const COLORS_LEVEL_STEP = 3;

const MAX_ATTEMPTS_START = 10;
const MAX_ATTEMPTS_MIN = 6;
const ATTEMPTS_LEVEL_STEP = 4;

const ROUND_TIME_START_SECONDS = 30;
const ROUND_TIME_MIN_SECONDS = 15;
const ROUND_TIME_DECAY_PER_LEVEL = 1.5;

const START_LIVES = 3;

const BASE_CLEAR_POINTS = 100;
const POINTS_PER_UNUSED_ATTEMPT = 20;
const POINTS_PER_REMAINING_SECOND = 2;

export interface GuessResult {
  /** ラウンド内で何回目の試行か(1始まり)。履歴表示の安定したキーとして使う。 */
  readonly attemptNumber: number;
  readonly guess: readonly number[];
  readonly exactMatches: number;
  readonly colorMatches: number;
}

export interface RoundClearedEvent {
  readonly level: number;
  readonly points: number;
}

export type RoundFailedReason = "attempts" | "time";

export interface RoundFailedEvent {
  readonly level: number;
  readonly reason: RoundFailedReason;
  readonly livesRemaining: number;
}

function randomColorIndex(colorCount: number): number {
  return Math.floor(Math.random() * colorCount);
}

export function slotCountForLevel(level: number): number {
  return Math.min(MIN_SLOTS + Math.floor((level - 1) / SLOTS_LEVEL_STEP), MAX_SLOTS);
}

export function colorCountForLevel(level: number): number {
  return Math.min(MIN_COLORS + Math.floor((level - 1) / COLORS_LEVEL_STEP), MAX_COLORS);
}

export function maxAttemptsForLevel(level: number): number {
  return Math.max(
    MAX_ATTEMPTS_MIN,
    MAX_ATTEMPTS_START - Math.floor((level - 1) / ATTEMPTS_LEVEL_STEP),
  );
}

export function roundTimeSecondsForLevel(level: number): number {
  return Math.max(
    ROUND_TIME_MIN_SECONDS,
    ROUND_TIME_START_SECONDS - ROUND_TIME_DECAY_PER_LEVEL * (level - 1),
  );
}

/**
 * Mastermind式の判定。位置と色が完全一致した数(exactMatches)と、
 * 色は合っているが位置が違う数(colorMatches、多重集合の共通部分として数える)を返す。
 */
export function evaluateGuess(
  secret: readonly number[],
  guess: readonly number[],
): { exactMatches: number; colorMatches: number } {
  let exactMatches = 0;
  const secretRemaining = new Map<number, number>();
  const guessRemaining = new Map<number, number>();

  for (let i = 0; i < secret.length; i++) {
    if (secret[i] === guess[i]) {
      exactMatches += 1;
      continue;
    }
    secretRemaining.set(secret[i], (secretRemaining.get(secret[i]) ?? 0) + 1);
    guessRemaining.set(guess[i], (guessRemaining.get(guess[i]) ?? 0) + 1);
  }

  let colorMatches = 0;
  for (const [color, count] of guessRemaining) {
    colorMatches += Math.min(count, secretRemaining.get(color) ?? 0);
  }

  return { exactMatches, colorMatches };
}

/**
 * 提灯の暗号を解読するリアルタイム・ロジックパズル。
 * ラウンドごとに隠された色の並び(secretCode)を生成し、プレイヤーは残り試行回数と
 * 燃え尽きるロウソクの時間(roundTimeRemaining)が尽きる前に、フィードバック
 * (exactMatches/colorMatches)を手がかりに当てなければならない。
 */
export class LanternCipherWorld {
  level = 1;
  score = 0;
  lives = START_LIVES;
  isOver = false;

  /** ラウンドが生成されるたび(reset/clear/fail)に1増える。UI側が「新しいラウンドに切り替わった」ことを検知するための識別子。 */
  roundId = 0;

  slotCount = 0;
  colorCount = 0;
  maxAttempts = 0;
  attemptsUsed = 0;
  roundTimeRemaining = 0;

  secretCode: number[] = [];
  history: GuessResult[] = [];

  onRoundCleared: ((event: RoundClearedEvent) => void) | null = null;
  onRoundFailed: ((event: RoundFailedEvent) => void) | null = null;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.level = 1;
    this.score = 0;
    this.lives = START_LIVES;
    this.isOver = false;
    this.generateRound(this.level);
  }

  canSubmitGuess(guess: readonly number[]): boolean {
    if (this.isOver) return false;
    if (this.attemptsUsed >= this.maxAttempts) return false;
    if (guess.length !== this.slotCount) return false;
    return guess.every((color) => color >= 0 && color < this.colorCount);
  }

  submitGuess(guess: readonly number[]): GuessResult | null {
    if (!this.canSubmitGuess(guess)) return null;

    const { exactMatches, colorMatches } = evaluateGuess(this.secretCode, guess);
    this.attemptsUsed += 1;
    const result: GuessResult = {
      attemptNumber: this.attemptsUsed,
      guess: [...guess],
      exactMatches,
      colorMatches,
    };
    this.history = [...this.history, result];

    if (exactMatches === this.slotCount) {
      this.clearRound();
      return result;
    }

    if (this.attemptsUsed >= this.maxAttempts) {
      this.failRound("attempts");
    }

    return result;
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;
    this.roundTimeRemaining = Math.max(0, this.roundTimeRemaining - deltaSeconds);
    if (this.roundTimeRemaining <= 0) {
      this.failRound("time");
    }
  }

  private clearRound(): void {
    const points =
      BASE_CLEAR_POINTS +
      (this.maxAttempts - this.attemptsUsed) * POINTS_PER_UNUSED_ATTEMPT +
      Math.floor(this.roundTimeRemaining) * POINTS_PER_REMAINING_SECOND;
    this.score += points;
    this.onRoundCleared?.({ level: this.level, points });
    this.level += 1;
    this.generateRound(this.level);
  }

  private failRound(reason: RoundFailedReason): void {
    this.lives -= 1;
    this.onRoundFailed?.({ level: this.level, reason, livesRemaining: this.lives });
    if (this.lives <= 0) {
      this.isOver = true;
      return;
    }
    this.generateRound(this.level);
  }

  private generateRound(level: number): void {
    this.roundId += 1;
    this.slotCount = slotCountForLevel(level);
    this.colorCount = colorCountForLevel(level);
    this.maxAttempts = maxAttemptsForLevel(level);
    this.roundTimeRemaining = roundTimeSecondsForLevel(level);
    this.attemptsUsed = 0;
    this.history = [];
    this.secretCode = Array.from({ length: this.slotCount }, () =>
      randomColorIndex(this.colorCount),
    );
  }
}
