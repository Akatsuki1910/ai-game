export interface SegmentAdvancedEvent {
  targetTempo: number;
  targetDynamics: number;
  difficulty: number;
}

export const TEMPO_MIN = 60;
export const TEMPO_MAX = 200;
export const DYNAMICS_MIN = 0;
export const DYNAMICS_MAX = 100;
export const FOCUS_MAX = 100;

const FOLLOW_RATE = 5.5; // /秒。バトンの入力位置に実際のテンポ/音量が追従する速さ。
const BASE_TEMPO_TOLERANCE = 34;
const BASE_DYNAMICS_TOLERANCE = 28;
const MIN_TEMPO_TOLERANCE = 12;
const MIN_DYNAMICS_TOLERANCE = 10;
const BASE_SEGMENT_SECONDS = 7;
const MIN_SEGMENT_SECONDS = 3.2;
const FOCUS_DRAIN_RATE = 24; // /秒。ズレている間に減る集中力。
const FOCUS_RECOVER_RATE = 14; // /秒。合っている間に戻る集中力。
const SCORE_RATE = 46; // /秒。合っている間に増えるスコアの基礎速度。
const COMBO_GROWTH_PER_SECOND = 0.12;
const COMBO_MULTIPLIER_CAP = 1.5;
const MAX_DIFFICULTY = 9;
const TOLERANCE_STEP_TEMPO = 2.4;
const TOLERANCE_STEP_DYNAMICS = 2;
const SEGMENT_STEP_SECONDS = 0.45;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * 指揮者ゲーム「Baton Sync」の純粋ロジック。
 * バトン(ポインタ)の画面上の位置から横位置=テンポ・縦位置=音量を導き、
 * 刻々と変わる目標の帯に収め続けるとスコアが増え、外れ続けると集中力が尽きて終わる。
 */
export class BatonSyncWorld {
  width = 0;
  height = 0;
  inputX = 0;
  inputY = 0;
  tempo = (TEMPO_MIN + TEMPO_MAX) / 2;
  dynamics = (DYNAMICS_MIN + DYNAMICS_MAX) / 2;
  targetTempo = this.tempo;
  targetDynamics = this.dynamics;
  tempoTolerance = BASE_TEMPO_TOLERANCE;
  dynamicsTolerance = BASE_DYNAMICS_TOLERANCE;
  segmentDuration = BASE_SEGMENT_SECONDS;
  segmentElapsed = 0;
  focus = FOCUS_MAX;
  score = 0;
  inTuneSeconds = 0;
  isInTune = true;
  isOver = false;
  private difficulty = 0;

  onSegmentAdvanced: ((event: SegmentAdvancedEvent) => void) | null = null;

  constructor(width: number, height: number) {
    this.resize(width, height);
    this.reset();
  }

  reset(): void {
    this.inputX = this.width / 2;
    this.inputY = this.height / 2;
    this.difficulty = 0;
    this.tempoTolerance = BASE_TEMPO_TOLERANCE;
    this.dynamicsTolerance = BASE_DYNAMICS_TOLERANCE;
    this.segmentDuration = BASE_SEGMENT_SECONDS;
    this.segmentElapsed = 0;
    this.focus = FOCUS_MAX;
    this.score = 0;
    this.inTuneSeconds = 0;
    this.isInTune = true;
    this.isOver = false;
    this.tempo = this.mapTempo(this.inputX);
    this.dynamics = this.mapDynamics(this.inputY);
    // 最初のフレーズは現在位置と同じ値にして、操作に慣れる時間を作る。
    this.targetTempo = this.tempo;
    this.targetDynamics = this.dynamics;
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const scaleX = this.width > 0 ? width / this.width : 1;
    const scaleY = this.height > 0 ? height / this.height : 1;
    if (this.width > 0 && this.height > 0) {
      this.inputX *= scaleX;
      this.inputY *= scaleY;
    } else {
      this.inputX = width / 2;
      this.inputY = height / 2;
    }
    this.width = width;
    this.height = height;
    this.inputX = clamp(this.inputX, 0, this.width);
    this.inputY = clamp(this.inputY, 0, this.height);
  }

  /** ポインタ(マウス/タッチ)の押下・移動でバトンの位置を直接セットする。 */
  setBatonInput(x: number, y: number): void {
    this.inputX = clamp(x, 0, this.width);
    this.inputY = clamp(y, 0, this.height);
  }

  /** キーボードの矢印キー等で相対的にバトンを動かす。 */
  nudgeBatonInput(dx: number, dy: number): void {
    this.setBatonInput(this.inputX + dx, this.inputY + dy);
  }

  private mapTempo(x: number): number {
    if (this.width <= 0) return (TEMPO_MIN + TEMPO_MAX) / 2;
    return TEMPO_MIN + (x / this.width) * (TEMPO_MAX - TEMPO_MIN);
  }

  private mapDynamics(y: number): number {
    if (this.height <= 0) return (DYNAMICS_MIN + DYNAMICS_MAX) / 2;
    return DYNAMICS_MAX - (y / this.height) * (DYNAMICS_MAX - DYNAMICS_MIN);
  }

  private generateNextTarget(): void {
    const tempoCenter = (TEMPO_MIN + TEMPO_MAX) / 2;
    const dynamicsCenter = (DYNAMICS_MIN + DYNAMICS_MAX) / 2;
    const tempoSpan = (TEMPO_MAX - TEMPO_MIN) / 2 - this.tempoTolerance;
    const dynamicsSpan = (DYNAMICS_MAX - DYNAMICS_MIN) / 2 - this.dynamicsTolerance;
    this.targetTempo = clamp(
      tempoCenter + randRange(-tempoSpan, tempoSpan),
      TEMPO_MIN + this.tempoTolerance,
      TEMPO_MAX - this.tempoTolerance,
    );
    this.targetDynamics = clamp(
      dynamicsCenter + randRange(-dynamicsSpan, dynamicsSpan),
      DYNAMICS_MIN + this.dynamicsTolerance,
      DYNAMICS_MAX - this.dynamicsTolerance,
    );
  }

  private advanceSegment(): void {
    this.difficulty = Math.min(MAX_DIFFICULTY, this.difficulty + 1);
    this.tempoTolerance = Math.max(
      MIN_TEMPO_TOLERANCE,
      BASE_TEMPO_TOLERANCE - this.difficulty * TOLERANCE_STEP_TEMPO,
    );
    this.dynamicsTolerance = Math.max(
      MIN_DYNAMICS_TOLERANCE,
      BASE_DYNAMICS_TOLERANCE - this.difficulty * TOLERANCE_STEP_DYNAMICS,
    );
    this.segmentDuration = Math.max(
      MIN_SEGMENT_SECONDS,
      BASE_SEGMENT_SECONDS - this.difficulty * SEGMENT_STEP_SECONDS,
    );
    this.segmentElapsed = 0;
    this.generateNextTarget();
    this.onSegmentAdvanced?.({
      targetTempo: this.targetTempo,
      targetDynamics: this.targetDynamics,
      difficulty: this.difficulty,
    });
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    const desiredTempo = this.mapTempo(this.inputX);
    const desiredDynamics = this.mapDynamics(this.inputY);
    const followAmount = Math.min(1, FOLLOW_RATE * deltaSeconds);
    this.tempo += (desiredTempo - this.tempo) * followAmount;
    this.dynamics += (desiredDynamics - this.dynamics) * followAmount;

    this.isInTune =
      Math.abs(this.tempo - this.targetTempo) <= this.tempoTolerance &&
      Math.abs(this.dynamics - this.targetDynamics) <= this.dynamicsTolerance;

    if (this.isInTune) {
      this.inTuneSeconds += deltaSeconds;
      this.focus = Math.min(FOCUS_MAX, this.focus + FOCUS_RECOVER_RATE * deltaSeconds);
      const comboMultiplier = Math.min(
        COMBO_MULTIPLIER_CAP,
        1 + this.inTuneSeconds * COMBO_GROWTH_PER_SECOND,
      );
      this.score += SCORE_RATE * comboMultiplier * deltaSeconds;
    } else {
      this.inTuneSeconds = 0;
      this.focus = Math.max(0, this.focus - FOCUS_DRAIN_RATE * deltaSeconds);
    }

    if (this.focus <= 0) {
      this.focus = 0;
      this.isOver = true;
      return;
    }

    this.segmentElapsed += deltaSeconds;
    if (this.segmentElapsed >= this.segmentDuration) {
      this.advanceSegment();
    }
  }
}
