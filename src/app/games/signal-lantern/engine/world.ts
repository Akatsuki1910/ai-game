export type SignalSymbol = "dot" | "dash";

export type SignalPhase = "showing" | "input" | "gameOver";

export interface CallAnsweredEvent {
  symbol: SignalSymbol;
  points: number;
  combo: number;
}

export interface CallMissedEvent {
  reason: "wrong" | "timeout";
  livesRemaining: number;
}

export interface LevelClearedEvent {
  level: number;
  bonus: number;
}

/** 長押しがこのミリ秒未満なら「点」、以上なら「線」と判定する。 */
export const DOT_HOLD_THRESHOLD_MS = 420;
export const START_LIVES = 3;

const DOT_SHOW_SECONDS = 0.22;
const DASH_SHOW_SECONDS = 0.55;

const MIN_CALLS_PER_LEVEL = 3;
const MAX_CALLS_PER_LEVEL = 8;

const BASE_INPUT_TIME_SECONDS = 2.6;
const INPUT_TIME_DECAY_PER_LEVEL = 0.12;
const MIN_INPUT_TIME_SECONDS = 1.1;

const BASE_POINTS = 12;
const COMBO_BONUS_PER_STREAK = 2;
const MAX_COMBO_BONUS = 30;
const LEVEL_BASE_BONUS = 60;
const LEVEL_BONUS_PER_LEVEL = 10;

function randomSymbol(): SignalSymbol {
  return Math.random() < 0.5 ? "dot" : "dash";
}

function callsForLevel(level: number): number {
  return Math.min(MAX_CALLS_PER_LEVEL, MIN_CALLS_PER_LEVEL + Math.floor((level - 1) / 2));
}

function inputTimeForLevel(level: number): number {
  return Math.max(
    MIN_INPUT_TIME_SECONDS,
    BASE_INPUT_TIME_SECONDS - (level - 1) * INPUT_TIME_DECAY_PER_LEVEL,
  );
}

function symbolShowSeconds(symbol: SignalSymbol): number {
  return symbol === "dot" ? DOT_SHOW_SECONDS : DASH_SHOW_SECONDS;
}

/**
 * 沖の灯台から届く信号(短い点滅=点・長い点滅=線)を見て、同じ長さだけレバーを
 * 握って打ち返すリアルタイム・タイミングパズルの純粋ロジック層。
 * React / pixi.js には一切依存しない。画面サイズにも依存しない。
 */
export class SignalLanternWorld {
  level = 1;
  lives = START_LIVES;
  score = 0;
  combo = 0;
  isOver = false;

  phase: SignalPhase = "showing";
  currentSymbol: SignalSymbol = "dot";
  /** 現在のレベルで正解した回数(0〜callsForLevel(level)未満)。 */
  roundIndex = 0;

  private showElapsed = 0;
  private inputElapsed = 0;
  private inputTimeLimit = 0;

  onCallAnswered: ((event: CallAnsweredEvent) => void) | null = null;
  onCallMissed: ((event: CallMissedEvent) => void) | null = null;
  onLevelCleared: ((event: LevelClearedEvent) => void) | null = null;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.level = 1;
    this.lives = START_LIVES;
    this.score = 0;
    this.combo = 0;
    this.isOver = false;
    this.roundIndex = 0;
    this.startNextCall();
  }

  /** このレベルをクリアするのに必要な正解数。 */
  get callsRequired(): number {
    return callsForLevel(this.level);
  }

  /** 応答フェーズの残り秒数(0〜inputTimeLimitSeconds)。showing中は inputTimeLimitSeconds と同じ値。 */
  get inputTimeRemaining(): number {
    if (this.phase !== "input") return this.inputTimeLimit;
    return Math.max(0, this.inputTimeLimit - this.inputElapsed);
  }

  get inputTimeLimitSeconds(): number {
    return this.inputTimeLimit;
  }

  private startNextCall(): void {
    this.currentSymbol = randomSymbol();
    this.phase = "showing";
    this.showElapsed = 0;
    this.inputElapsed = 0;
    this.inputTimeLimit = inputTimeForLevel(this.level);
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    if (this.phase === "showing") {
      this.showElapsed += deltaSeconds;
      if (this.showElapsed >= symbolShowSeconds(this.currentSymbol)) {
        this.phase = "input";
        this.inputElapsed = 0;
      }
      return;
    }

    if (this.phase === "input") {
      this.inputElapsed += deltaSeconds;
      if (this.inputElapsed >= this.inputTimeLimit) {
        this.registerMiss("timeout");
      }
    }
  }

  /** レバーを離した瞬間、握っていた長さ(ミリ秒)を渡して判定する。 */
  releaseLever(holdMs: number): void {
    if (this.isOver || this.phase !== "input") return;

    const attempted: SignalSymbol = holdMs < DOT_HOLD_THRESHOLD_MS ? "dot" : "dash";
    if (attempted !== this.currentSymbol) {
      this.registerMiss("wrong");
      return;
    }

    this.combo += 1;
    const comboBonus = Math.min(MAX_COMBO_BONUS, this.combo * COMBO_BONUS_PER_STREAK);
    const points = BASE_POINTS + comboBonus;
    this.score += points;
    this.onCallAnswered?.({ symbol: attempted, points, combo: this.combo });

    this.roundIndex += 1;
    if (this.roundIndex >= this.callsRequired) {
      const bonus = LEVEL_BASE_BONUS + this.level * LEVEL_BONUS_PER_LEVEL;
      this.score += bonus;
      this.onLevelCleared?.({ level: this.level, bonus });
      this.level += 1;
      this.roundIndex = 0;
    }

    this.startNextCall();
  }

  private registerMiss(reason: "wrong" | "timeout"): void {
    this.combo = 0;
    this.lives = Math.max(0, this.lives - 1);
    this.onCallMissed?.({ reason, livesRemaining: this.lives });
    if (this.lives <= 0) {
      this.isOver = true;
      this.phase = "gameOver";
      return;
    }
    this.startNextCall();
  }
}
