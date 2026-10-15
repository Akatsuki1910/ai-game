export interface FoldPinnedEvent {
  isSuccess: boolean;
  precision: number;
  foldIndex: number;
  pointsGained: number;
}

export interface RoundClearedEvent {
  round: number;
  panelCount: number;
  score: number;
}

export interface GameOverEvent {
  round: number;
  score: number;
}

export const ANGLE_MIN_DEG = 0;
export const ANGLE_MAX_DEG = 180;

const INITIAL_PANEL_COUNT = 3;
const MAX_PANEL_COUNT = 8;
export const INITIAL_WRINKLES = 3;

const TARGET_CENTER_DEG = 90;
const TARGET_AMPLITUDE_DEG = 55;

const INITIAL_TOLERANCE_DEG = 22;
export const MIN_TOLERANCE_DEG = 9;
const TOLERANCE_SHRINK_PER_ROUND = 2;

const INITIAL_OSC_SPEED = 0.6;
const MAX_OSC_SPEED = 1.6;
const OSC_SPEED_GROWTH_PER_ROUND = 0.12;

const PIN_BASE_SCORE = 40;
const PIN_PRECISION_BONUS_MAX = 60;
const ROUND_CLEAR_BONUS_PER_PANEL = 30;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * 紙の扇(せんす)を1枚ずつ折りたたむリアルタイム折り紙パズルの純粋ロジック層。
 * React / three.js には一切依存しない。
 *
 * 折り目(パネル)は常に1枚だけが「アクティブ」で、プレイヤーは currentAngleDeg を
 * 0〜180度の範囲で操作し続け、正弦波で揺れ動く targetCenterDeg ± toleranceDeg の
 * 帯に重なったタイミングで pin() を呼んで確定させる。外れると wrinkles(ライフ)が
 * 減り、そのパネルは0度に戻って再挑戦になる。すべてのパネルを折り終えるとラウンドが
 * クリアされ、次のラウンドではパネル数が増え、許容誤差が縮み、揺れが速くなる。
 */
export class SensuFoldWorld {
  panelCount = INITIAL_PANEL_COUNT;
  round = 1;
  foldIndex = 0;
  completedAngles: number[] = [];
  currentAngleDeg = 0;
  targetCenterDeg = TARGET_CENTER_DEG;
  toleranceDeg = INITIAL_TOLERANCE_DEG;
  wrinkles = INITIAL_WRINKLES;
  score = 0;
  isOver = false;

  private elapsedSeconds = 0;
  private oscSpeed = INITIAL_OSC_SPEED;

  onFoldPinned: ((event: FoldPinnedEvent) => void) | null = null;
  onRoundCleared: ((event: RoundClearedEvent) => void) | null = null;
  onGameOver: ((event: GameOverEvent) => void) | null = null;

  reset(): void {
    this.panelCount = INITIAL_PANEL_COUNT;
    this.round = 1;
    this.foldIndex = 0;
    this.completedAngles = [];
    this.currentAngleDeg = 0;
    this.elapsedSeconds = 0;
    this.oscSpeed = INITIAL_OSC_SPEED;
    this.targetCenterDeg = TARGET_CENTER_DEG;
    this.toleranceDeg = INITIAL_TOLERANCE_DEG;
    this.wrinkles = INITIAL_WRINKLES;
    this.score = 0;
    this.isOver = false;
  }

  /** ポインタの位置比率(0=角度0度側, 1=角度180度側)から直接角度を設定する。 */
  setAngleRatio(ratio: number): void {
    if (this.isOver) return;
    this.currentAngleDeg = clamp(ratio, 0, 1) * ANGLE_MAX_DEG;
  }

  /** キーボード等、連続的な増減量(度)を現在角度に加える。 */
  adjustAngle(deltaDeg: number): void {
    if (this.isOver) return;
    this.currentAngleDeg = clamp(this.currentAngleDeg + deltaDeg, ANGLE_MIN_DEG, ANGLE_MAX_DEG);
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;
    this.elapsedSeconds += deltaSeconds;
    this.targetCenterDeg =
      TARGET_CENTER_DEG + TARGET_AMPLITUDE_DEG * Math.sin(this.elapsedSeconds * this.oscSpeed);
  }

  /** 現在の角度でパネルをピン留めしようと試みる。成功/失敗どちらも onFoldPinned が発火する。 */
  pin(): void {
    if (this.isOver) return;

    const diff = Math.abs(this.currentAngleDeg - this.targetCenterDeg);
    const isSuccess = diff <= this.toleranceDeg;
    const foldIndex = this.foldIndex;

    if (isSuccess) {
      const precision = this.toleranceDeg > 0 ? 1 - diff / this.toleranceDeg : 1;
      const pointsGained = PIN_BASE_SCORE + Math.round(precision * PIN_PRECISION_BONUS_MAX);
      this.score += pointsGained;
      this.completedAngles.push(this.currentAngleDeg);
      this.foldIndex += 1;
      this.currentAngleDeg = 0;
      this.onFoldPinned?.({ isSuccess: true, precision, foldIndex, pointsGained });

      if (this.foldIndex >= this.panelCount) {
        this.clearRound();
      }
      return;
    }

    this.wrinkles -= 1;
    this.currentAngleDeg = 0;
    this.onFoldPinned?.({ isSuccess: false, precision: 0, foldIndex, pointsGained: 0 });

    if (this.wrinkles <= 0) {
      this.wrinkles = 0;
      this.isOver = true;
      this.onGameOver?.({ round: this.round, score: this.score });
    }
  }

  private clearRound(): void {
    this.score += this.panelCount * ROUND_CLEAR_BONUS_PER_PANEL;
    this.round += 1;
    this.panelCount = Math.min(MAX_PANEL_COUNT, this.panelCount + 1);
    this.toleranceDeg = Math.max(MIN_TOLERANCE_DEG, this.toleranceDeg - TOLERANCE_SHRINK_PER_ROUND);
    this.oscSpeed = Math.min(MAX_OSC_SPEED, this.oscSpeed + OSC_SPEED_GROWTH_PER_ROUND);
    this.foldIndex = 0;
    this.completedAngles = [];
    this.onRoundCleared?.({ round: this.round, panelCount: this.panelCount, score: this.score });
  }
}
