export interface ShadowProjection {
  readonly shadowXRatio: number;
  readonly scale: number;
}

export interface TargetShadow {
  readonly shadowXRatio: number;
  readonly scale: number;
}

export interface MatchCompletedEvent {
  combo: number;
  points: number;
}

/** 光源(ランタン)のステージ内比率座標。左右中央・上寄り。 */
export const LIGHT_X_RATIO = 0.5;
export const LIGHT_Y_RATIO = 0.1;
/** 影が映るスクリーン(壁)のY比率座標。 */
export const WALL_Y_RATIO = 0.88;

/** 人形が光源と壁の間を動ける奥行き比率の範囲(0=光源に接する, 1=壁に接する)。 */
export const DEPTH_MIN = 0.18;
export const DEPTH_MAX = 0.88;

/** 影が常にスクリーン内(左右の余白を除く)に収まるようにする余白比率。 */
export const SHADOW_MARGIN_RATIO = 0.08;

export const SCALE_MIN = 1 / DEPTH_MAX;
export const SCALE_MAX = 1 / DEPTH_MIN;

export const SESSION_SECONDS = 90;

const START_TOLERANCE_X = 0.11;
const FLOOR_TOLERANCE_X = 0.05;
const STEP_TOLERANCE_X = 0.007;

const START_TOLERANCE_SCALE = 0.6;
const FLOOR_TOLERANCE_SCALE = 0.24;
const STEP_TOLERANCE_SCALE = 0.032;

const START_HOLD_SECONDS = 1.2;
const FLOOR_HOLD_SECONDS = 0.6;
const STEP_HOLD_SECONDS = 0.045;

const UNMATCHED_DECAY_MULTIPLIER = 1.6;
const BASE_POINTS = 180;
const COMBO_POINTS = 55;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** ポインタの縦位置(比率)を、光源〜壁の間の奥行き比率[DEPTH_MIN, DEPTH_MAX]へ写す。 */
export function depthRatioFromPointerYRatio(pointerYRatio: number): number {
  const t = (pointerYRatio - LIGHT_Y_RATIO) / (WALL_Y_RATIO - LIGHT_Y_RATIO);
  return clamp(t, DEPTH_MIN, DEPTH_MAX);
}

/**
 * 人形が光源から`depthRatio`の奥行きにあるとき、影が壁の外へ出ずに済む
 * 横方向の可動範囲(光源からのオフセット幅)。光源に近いほど拡大率が上がるため
 * 可動範囲は狭くなる(近似三角形の相似比: offset * (1/depthRatio) が壁上の
 * オフセットになるので、壁上オフセットの上限 (0.5 - margin) から逆算する)。
 */
export function maxPuppetOffsetForDepth(depthRatio: number): number {
  return (0.5 - SHADOW_MARGIN_RATIO) * depthRatio;
}

export function clampPuppetXRatio(puppetXRatio: number, depthRatio: number): number {
  const maxOffset = maxPuppetOffsetForDepth(depthRatio);
  return clamp(puppetXRatio, LIGHT_X_RATIO - maxOffset, LIGHT_X_RATIO + maxOffset);
}

/** 点光源からの相似三角形で、人形の位置から壁に映る影の位置と拡大率を求める。 */
export function projectShadow(puppetXRatio: number, depthRatio: number): ShadowProjection {
  const scale = 1 / depthRatio;
  const shadowXRatio = LIGHT_X_RATIO + (puppetXRatio - LIGHT_X_RATIO) * scale;
  return { shadowXRatio, scale };
}

export function generateTarget(): TargetShadow {
  return {
    shadowXRatio: randomBetween(SHADOW_MARGIN_RATIO, 1 - SHADOW_MARGIN_RATIO),
    scale: randomBetween(SCALE_MIN, SCALE_MAX),
  };
}

/**
 * 影絵の人形を光源との距離(奥行き)と左右位置で操り、壁に映る影を
 * お題の位置・大きさへ重ねて一定時間保ち続けるリアルタイム投影パズルの純粋ロジック層。
 * React / pixi.js には一切依存しない。
 */
export class ShadowCastWorld {
  puppetXRatio = LIGHT_X_RATIO;
  depthRatio = (DEPTH_MIN + DEPTH_MAX) / 2;
  target: TargetShadow = { shadowXRatio: LIGHT_X_RATIO, scale: (SCALE_MIN + SCALE_MAX) / 2 };
  toleranceXRatio = START_TOLERANCE_X;
  toleranceScale = START_TOLERANCE_SCALE;
  holdRequiredSeconds = START_HOLD_SECONDS;
  holdSeconds = 0;
  combo = 0;
  score = 0;
  timeRemaining = SESSION_SECONDS;
  isOver = false;

  onMatchCompleted: ((event: MatchCompletedEvent) => void) | null = null;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.puppetXRatio = LIGHT_X_RATIO;
    this.depthRatio = (DEPTH_MIN + DEPTH_MAX) / 2;
    this.combo = 0;
    this.score = 0;
    this.timeRemaining = SESSION_SECONDS;
    this.isOver = false;
    this.holdSeconds = 0;
    this.updateDifficulty();
    this.target = generateTarget();
  }

  /** ドラッグ/タップ中の絶対位置で人形を動かす(比率座標)。 */
  setPointer(xRatio: number, yRatio: number): void {
    this.depthRatio = depthRatioFromPointerYRatio(yRatio);
    this.puppetXRatio = clampPuppetXRatio(xRatio, this.depthRatio);
  }

  /** キーボード操作用に、現在位置からの相対移動で人形を動かす(比率/秒)。 */
  moveBy(dxRatio: number, dyDepthRatio: number): void {
    this.depthRatio = clamp(this.depthRatio + dyDepthRatio, DEPTH_MIN, DEPTH_MAX);
    this.puppetXRatio = clampPuppetXRatio(this.puppetXRatio + dxRatio, this.depthRatio);
  }

  get projected(): ShadowProjection {
    return projectShadow(this.puppetXRatio, this.depthRatio);
  }

  get isMatched(): boolean {
    const { shadowXRatio, scale } = this.projected;
    return (
      Math.abs(shadowXRatio - this.target.shadowXRatio) <= this.toleranceXRatio &&
      Math.abs(scale - this.target.scale) <= this.toleranceScale
    );
  }

  get holdProgress(): number {
    return this.holdRequiredSeconds > 0 ? this.holdSeconds / this.holdRequiredSeconds : 0;
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    this.timeRemaining = Math.max(0, this.timeRemaining - deltaSeconds);
    if (this.timeRemaining <= 0) {
      this.isOver = true;
      return;
    }

    if (this.isMatched) {
      this.holdSeconds = Math.min(this.holdRequiredSeconds, this.holdSeconds + deltaSeconds);
      if (this.holdSeconds >= this.holdRequiredSeconds) {
        this.completeMatch();
      }
    } else {
      this.holdSeconds = Math.max(0, this.holdSeconds - deltaSeconds * UNMATCHED_DECAY_MULTIPLIER);
    }
  }

  private completeMatch(): void {
    const points = BASE_POINTS + this.combo * COMBO_POINTS;
    this.score += points;
    this.onMatchCompleted?.({ combo: this.combo, points });
    this.combo += 1;
    this.holdSeconds = 0;
    this.updateDifficulty();
    this.target = generateTarget();
  }

  private updateDifficulty(): void {
    this.toleranceXRatio = Math.max(
      FLOOR_TOLERANCE_X,
      START_TOLERANCE_X - this.combo * STEP_TOLERANCE_X,
    );
    this.toleranceScale = Math.max(
      FLOOR_TOLERANCE_SCALE,
      START_TOLERANCE_SCALE - this.combo * STEP_TOLERANCE_SCALE,
    );
    this.holdRequiredSeconds = Math.max(
      FLOOR_HOLD_SECONDS,
      START_HOLD_SECONDS - this.combo * STEP_HOLD_SECONDS,
    );
  }
}
