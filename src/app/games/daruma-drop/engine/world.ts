export type SwingOutcome = "too-weak" | "perfect" | "overpower";

export interface PowerWindow {
  min: number;
  max: number;
}

export interface SwingResultEvent {
  outcome: SwingOutcome;
  power: number;
  window: PowerWindow;
  scoreGained: number;
  stabilityDelta: number;
  combo: number;
  blocksRemaining: number;
  round: number;
  roundCompleted: boolean;
}

export interface TimeoutEvent {
  round: number;
  stabilityDelta: number;
}

export const INITIAL_BLOCKS = 5;
export const STABILITY_MAX = 100;
export const BASE_SWING_TIME_LIMIT = 6.5;

const WINDOW_SHRINK_PER_ROUND = 0.018;
const BASE_WINDOW_WIDTH = 0.3;
const MIN_WINDOW_WIDTH = 0.1;
const WINDOW_LOW_BOUND = 0.05;
const WINDOW_HIGH_BOUND = 0.95;

const SWING_TIME_SHRINK_PER_ROUND = 0.25;
const MIN_SWING_TIME_LIMIT = 3;

const PERFECT_RECOVERY = 4;
const PERFECT_BASE_SCORE = 100;
const PERFECT_COMBO_SCORE = 15;
const OVERPOWER_BASE_SCORE = 40;

const WEAK_PENALTY_BASE = 6;
const WEAK_PENALTY_SCALE = 40;
const OVERPOWER_PENALTY_BASE = 10;
const OVERPOWER_PENALTY_SCALE = 50;
const TIMEOUT_PENALTY = 8;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * だるま落とし風の積み木パズル。
 * 「引いて離す」のパワーが毎回のターゲット帯（ウィンドウ）に収まれば最下段の積み木が
 * 綺麗に抜け、ラウンドが進むほど積み木は増えウィンドウは狭くなる。
 * 弱すぎ/強すぎの度合いに応じてだるまの安定度が減り、0になると崩れて終了する。
 */
export class DarumaDropWorld {
  round = 1;
  totalBlocksInRound = INITIAL_BLOCKS;
  blocksRemaining = INITIAL_BLOCKS;
  stability = STABILITY_MAX;
  score = 0;
  combo = 0;
  isOver = false;
  swingTimeLimit = BASE_SWING_TIME_LIMIT;
  swingTimer = BASE_SWING_TIME_LIMIT;
  currentWindow: PowerWindow = { min: 0.35, max: 0.65 };

  onSwingResult: ((event: SwingResultEvent) => void) | null = null;
  onTimeout: ((event: TimeoutEvent) => void) | null = null;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.round = 1;
    this.totalBlocksInRound = INITIAL_BLOCKS;
    this.blocksRemaining = this.totalBlocksInRound;
    this.stability = STABILITY_MAX;
    this.score = 0;
    this.combo = 0;
    this.isOver = false;
    this.swingTimeLimit = BASE_SWING_TIME_LIMIT;
    this.swingTimer = this.swingTimeLimit;
    this.currentWindow = this.generateWindow();
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;
    this.swingTimer -= deltaSeconds;
    if (this.swingTimer <= 0) this.applyTimeout();
  }

  /** パワー(0〜1)で木槌を振る。ウィンドウとの位置関係で結果が決まる。 */
  attemptSwing(powerRaw: number): SwingResultEvent {
    const power = clamp(powerRaw, 0, 1);
    const window = this.currentWindow;

    if (this.isOver) {
      return {
        outcome: "too-weak",
        power,
        window,
        scoreGained: 0,
        stabilityDelta: 0,
        combo: this.combo,
        blocksRemaining: this.blocksRemaining,
        round: this.round,
        roundCompleted: false,
      };
    }

    let outcome: SwingOutcome;
    let stabilityDelta: number;
    let scoreGained = 0;
    let blockCleared = false;

    if (power < window.min) {
      outcome = "too-weak";
      const deviation = window.min - power;
      stabilityDelta = -(WEAK_PENALTY_BASE + deviation * WEAK_PENALTY_SCALE);
      this.combo = 0;
    } else if (power > window.max) {
      outcome = "overpower";
      const deviation = power - window.max;
      stabilityDelta = -(OVERPOWER_PENALTY_BASE + deviation * OVERPOWER_PENALTY_SCALE);
      scoreGained = OVERPOWER_BASE_SCORE;
      this.combo = 0;
      blockCleared = true;
    } else {
      outcome = "perfect";
      stabilityDelta = PERFECT_RECOVERY;
      this.combo += 1;
      scoreGained = PERFECT_BASE_SCORE + this.combo * PERFECT_COMBO_SCORE;
      blockCleared = true;
    }

    this.stability = clamp(this.stability + stabilityDelta, 0, STABILITY_MAX);
    this.score += scoreGained;

    let roundCompleted = false;
    if (blockCleared) {
      this.blocksRemaining -= 1;
      if (this.blocksRemaining <= 0) {
        roundCompleted = true;
        this.round += 1;
        this.totalBlocksInRound = INITIAL_BLOCKS + (this.round - 1);
        this.blocksRemaining = this.totalBlocksInRound;
        this.swingTimeLimit = Math.max(
          MIN_SWING_TIME_LIMIT,
          BASE_SWING_TIME_LIMIT - (this.round - 1) * SWING_TIME_SHRINK_PER_ROUND,
        );
      }
      this.currentWindow = this.generateWindow();
    }

    this.swingTimer = this.swingTimeLimit;
    if (this.stability <= 0) this.isOver = true;

    const event: SwingResultEvent = {
      outcome,
      power,
      window,
      scoreGained,
      stabilityDelta,
      combo: this.combo,
      blocksRemaining: this.blocksRemaining,
      round: this.round,
      roundCompleted,
    };
    this.onSwingResult?.(event);
    return event;
  }

  private applyTimeout(): void {
    this.stability = clamp(this.stability - TIMEOUT_PENALTY, 0, STABILITY_MAX);
    this.combo = 0;
    this.swingTimer = this.swingTimeLimit;
    this.onTimeout?.({ round: this.round, stabilityDelta: -TIMEOUT_PENALTY });
    if (this.stability <= 0) this.isOver = true;
  }

  private generateWindow(): PowerWindow {
    const width = Math.min(
      Math.max(BASE_WINDOW_WIDTH - (this.round - 1) * WINDOW_SHRINK_PER_ROUND, MIN_WINDOW_WIDTH),
      WINDOW_HIGH_BOUND - WINDOW_LOW_BOUND,
    );
    const start = randRange(WINDOW_LOW_BOUND, WINDOW_HIGH_BOUND - width);
    return { min: start, max: start + width };
  }
}
