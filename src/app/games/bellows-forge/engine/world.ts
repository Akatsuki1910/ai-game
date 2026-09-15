export interface StrikeEvent {
  isSuccess: boolean;
  isTooCold: boolean;
  isTooHot: boolean;
  precisionRatio: number;
  scoreGained: number;
}

export interface ScorchEvent {
  round: number;
}

export interface PieceCompleteEvent {
  round: number;
  hitsRequired: number;
}

export interface GameOverEvent {
  round: number;
  score: number;
}

const START_QUALITY = 3;

const TEMPERATURE_MIN = 0;
const TEMPERATURE_MAX = 100;

const BASE_COOL_RATE = 10; // 何もしないでいると1秒あたりこれだけ温度が下がる
const COOL_RATE_GROWTH = 1.12; // ラウンドごとの冷却速度の増加率
const MAX_COOL_RATE = 28;

const PUMP_RATE = 46; // ふいごを踏んでいる間、1秒あたりこれだけ温度が上がる(冷却と同時に進行)
const STRIKE_COOL_AMOUNT = 9; // 成功打で加工した分だけ温度が下がる
const OVERHEAT_RESET_TEMPERATURE = 42; // 焦げついた直後に落ち着く温度

const BASE_BAND_WIDTH = 34;
const BAND_SHRINK_PER_ROUND = 2.4;
const MIN_BAND_WIDTH = 12;
const BAND_CENTER_MIN = 30;
const BAND_CENTER_MAX = 82;

const BASE_HITS_REQUIRED = 4;
const HITS_GROWTH_PER_ROUND = 1;
const MAX_HITS_REQUIRED = 12;

const SUCCESS_BASE_SCORE = 12;
const PRECISION_BONUS_SCORE = 18;
const PIECE_COMPLETE_BONUS = 40;

const START_TEMPERATURE = 15;

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * 鍛冶場の「温度帯を保ちながら打つ」プロトタイプのコアロジック。
 * 温度は常に自然冷却で下がり続けるため、ふいごで送風して目標帯(targetMin〜targetMax)
 * に収めてから打つ必要がある。帯の外で打つと失敗(quality減少)、送風しすぎて
 * TEMPERATURE_MAX に達すると焼け焦げて自動的にペナルティが入る。
 */
export class BellowsForgeWorld {
  temperature = START_TEMPERATURE;
  targetMin = 0;
  targetMax = 0;
  coolRate = BASE_COOL_RATE;

  round = 1;
  hitsLanded = 0;
  hitsRequired = BASE_HITS_REQUIRED;
  quality = START_QUALITY;
  score = 0;
  isOver = false;
  isPumping = false;

  onStrike: ((event: StrikeEvent) => void) | null = null;
  onScorch: ((event: ScorchEvent) => void) | null = null;
  onPieceComplete: ((event: PieceCompleteEvent) => void) | null = null;
  onGameOver: ((event: GameOverEvent) => void) | null = null;

  private wasAtOverheatCap = false;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.round = 1;
    this.score = 0;
    this.quality = START_QUALITY;
    this.isOver = false;
    this.temperature = START_TEMPERATURE;
    this.startNextPiece();
  }

  get temperatureRatio(): number {
    return this.temperature / TEMPERATURE_MAX;
  }

  get bandMinRatio(): number {
    return this.targetMin / TEMPERATURE_MAX;
  }

  get bandMaxRatio(): number {
    return this.targetMax / TEMPERATURE_MAX;
  }

  get hitsProgressRatio(): number {
    return this.hitsRequired > 0 ? clamp(this.hitsLanded / this.hitsRequired, 0, 1) : 0;
  }

  startPumping(): void {
    if (this.isOver) return;
    this.isPumping = true;
  }

  stopPumping(): void {
    this.isPumping = false;
  }

  strike(): void {
    if (this.isOver) return;

    const isTooCold = this.temperature < this.targetMin;
    const isTooHot = this.temperature > this.targetMax;
    const isSuccess = !isTooCold && !isTooHot;

    let scoreGained = 0;
    let precisionRatio = 0;

    if (isSuccess) {
      const bandWidth = this.targetMax - this.targetMin;
      const bandCenter = (this.targetMin + this.targetMax) / 2;
      const distanceRatio =
        bandWidth > 0 ? Math.abs(this.temperature - bandCenter) / (bandWidth / 2) : 0;
      precisionRatio = clamp(1 - distanceRatio, 0, 1);
      scoreGained = SUCCESS_BASE_SCORE + Math.round(PRECISION_BONUS_SCORE * precisionRatio);
      this.score += scoreGained;
      this.hitsLanded += 1;
      this.temperature = clamp(
        this.temperature - STRIKE_COOL_AMOUNT,
        TEMPERATURE_MIN,
        TEMPERATURE_MAX,
      );
    } else if (isTooHot) {
      // 冷たすぎる打撃は「まだ形にならない」だけで無害だが、熱すぎる打撃は
      // 加工中の金属を傷めるため品質を減らす。
      this.quality -= 1;
    }

    this.onStrike?.({ isSuccess, isTooCold, isTooHot, precisionRatio, scoreGained });

    if (!isSuccess) {
      if (isTooHot) this.checkGameOver();
      return;
    }

    if (this.hitsLanded >= this.hitsRequired) {
      this.completePiece();
    }
  }

  step(deltaSeconds: number): void {
    if (this.isOver || deltaSeconds <= 0) return;

    const pumpDelta = this.isPumping ? PUMP_RATE * deltaSeconds : 0;
    const coolDelta = this.coolRate * deltaSeconds;
    this.temperature = clamp(
      this.temperature + pumpDelta - coolDelta,
      TEMPERATURE_MIN,
      TEMPERATURE_MAX,
    );

    if (this.temperature >= TEMPERATURE_MAX) {
      if (!this.wasAtOverheatCap) {
        this.wasAtOverheatCap = true;
        this.quality -= 1;
        this.temperature = OVERHEAT_RESET_TEMPERATURE;
        this.onScorch?.({ round: this.round });
        this.checkGameOver();
      }
    } else {
      this.wasAtOverheatCap = false;
    }
  }

  private completePiece(): void {
    const finishedRound = this.round;
    const finishedHitsRequired = this.hitsRequired;
    this.score += PIECE_COMPLETE_BONUS;
    this.round += 1;
    this.onPieceComplete?.({ round: finishedRound, hitsRequired: finishedHitsRequired });
    this.startNextPiece();
  }

  private startNextPiece(): void {
    this.hitsRequired = Math.min(
      MAX_HITS_REQUIRED,
      BASE_HITS_REQUIRED + (this.round - 1) * HITS_GROWTH_PER_ROUND,
    );
    this.coolRate = Math.min(MAX_COOL_RATE, BASE_COOL_RATE * COOL_RATE_GROWTH ** (this.round - 1));
    const bandWidth = Math.max(
      MIN_BAND_WIDTH,
      BASE_BAND_WIDTH - (this.round - 1) * BAND_SHRINK_PER_ROUND,
    );
    const bandCenter = randRange(BAND_CENTER_MIN, BAND_CENTER_MAX);
    this.targetMin = clamp(bandCenter - bandWidth / 2, TEMPERATURE_MIN, TEMPERATURE_MAX);
    this.targetMax = clamp(bandCenter + bandWidth / 2, TEMPERATURE_MIN, TEMPERATURE_MAX);
    this.hitsLanded = 0;
    this.isPumping = false;
    this.wasAtOverheatCap = this.temperature >= TEMPERATURE_MAX;
  }

  private checkGameOver(): void {
    if (this.isOver) return;
    if (this.quality <= 0) {
      this.quality = 0;
      this.isOver = true;
      this.onGameOver?.({ round: this.round, score: this.score });
    }
  }
}

export const BELLOWS_FORGE_START_QUALITY = START_QUALITY;
