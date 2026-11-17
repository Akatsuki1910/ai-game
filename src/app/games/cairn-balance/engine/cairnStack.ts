export interface ShapePoint {
  x: number;
  y: number;
}

export interface StoneShape {
  halfWidth: number;
  height: number;
  /** 石自体の重心が幾何中心からどれだけ水平にズレているか（石の歪み）。 */
  comOffset: number;
}

export interface Stone extends StoneShape {
  id: number;
  /** 描画用の不定形な輪郭（[-1,1]付近に正規化した頂点）。 */
  shapePoints: ShapePoint[];
}

export interface PlacedStone extends Stone {
  rotation: number;
  centerX: number;
  centerY: number;
  /** この石の上面の支持半幅（次の石が乗れる範囲）。 */
  topHalfWidth: number;
}

export interface SupportSurface {
  centerX: number;
  halfWidth: number;
}

export interface DropEvaluation {
  isStable: boolean;
  comX: number;
  support: SupportSurface;
  nextSupport: SupportSurface;
}

export interface StonePlacedEvent {
  stone: PlacedStone;
  height: number;
}

export interface ToppleEvent {
  stone: Stone;
  centerX: number;
  centerY: number;
  rotation: number;
  comX: number;
  direction: 1 | -1;
}

const MIN_SUPPORT_HALF_WIDTH = 6;
export const BASE_SUPPORT_HALF_WIDTH = 92;
export const MAX_ROTATION = (42 * Math.PI) / 180;

const STONE_HEIGHT_MIN = 34;
const STONE_HEIGHT_MAX = 52;
const STONE_HALFWIDTH_MAX_START = 70;
const STONE_HALFWIDTH_MAX_FLOOR = 30;
const STONE_HALFWIDTH_MIN_MARGIN = 22;
const STONE_HALFWIDTH_MIN_FLOOR = 24;
const STONE_HALFWIDTH_SHRINK_PER_STONE = 2.2;
const COM_OFFSET_RATIO = 0.4;

const WIND_BASE_AMPLITUDE = 4;
const WIND_AMPLITUDE_PER_STONE = 1.6;
const WIND_MAX_AMPLITUDE = 34;
const WIND_BASE_FREQUENCY = 0.5;
const WIND_FREQUENCY_PER_STONE = 0.015;
const WIND_MAX_FREQUENCY = 1.6;

const GROUND_Y_RATIO = 0.84;
const SHAPE_POINT_COUNT = 9;

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function generateShapePoints(): ShapePoint[] {
  const points: ShapePoint[] = [];
  for (let i = 0; i < SHAPE_POINT_COUNT; i++) {
    const angle = (i / SHAPE_POINT_COUNT) * Math.PI * 2;
    const jitter = randRange(0.78, 1.08);
    points.push({ x: Math.cos(angle) * jitter, y: Math.sin(angle) * jitter });
  }
  return points;
}

export function clampRotation(rotation: number): number {
  return Math.min(MAX_ROTATION, Math.max(-MAX_ROTATION, rotation));
}

/** 回転させると、石自身の歪みと高さの分だけ重心が水平にずれる。 */
export function effectiveComOffset(stone: StoneShape, rotation: number): number {
  return stone.comOffset * Math.cos(rotation) + (stone.height / 2) * Math.sin(rotation);
}

/** 傾けるほど接地面（次の石が乗れる幅）は狭くなる。 */
export function effectiveTopHalfWidth(stone: StoneShape, rotation: number): number {
  return Math.max(MIN_SUPPORT_HALF_WIDTH, stone.halfWidth * Math.cos(rotation));
}

/**
 * 石を置いたときに安定するかどうかを判定する純粋関数。
 * 重心（石の歪み + 回転 + 風のオフセット）が支持面の範囲内に収まっていれば安定。
 */
export function evaluateDrop(
  support: SupportSurface,
  stone: StoneShape,
  centerX: number,
  rotation: number,
  windOffset: number,
): DropEvaluation {
  const comX = centerX + effectiveComOffset(stone, rotation) + windOffset;
  const isStable = Math.abs(comX - support.centerX) <= support.halfWidth;
  return {
    isStable,
    comX,
    support,
    nextSupport: { centerX, halfWidth: effectiveTopHalfWidth(stone, rotation) },
  };
}

let nextStoneId = 1;

export class CairnBalanceWorld {
  width = 0;
  height = 0;
  placedStones: PlacedStone[] = [];
  pendingStone: Stone = {
    id: 0,
    halfWidth: STONE_HALFWIDTH_MAX_START,
    height: STONE_HEIGHT_MIN,
    comOffset: 0,
    shapePoints: [],
  };
  pendingCenterX = 0;
  pendingRotation = 0;
  windPhase = 0;
  isOver = false;
  toppleResult: ToppleEvent | null = null;

  onStonePlaced: ((event: StonePlacedEvent) => void) | null = null;
  onToppled: ((event: ToppleEvent) => void) | null = null;

  constructor(width: number, height: number) {
    this.resize(width, height);
    this.reset();
  }

  get score(): number {
    return this.placedStones.length;
  }

  reset(): void {
    this.placedStones = [];
    this.isOver = false;
    this.toppleResult = null;
    this.windPhase = 0;
    this.pendingRotation = 0;
    this.pendingStone = this.generateStone();
    this.pendingCenterX = this.width / 2;
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    if (this.width > 0) {
      const deltaX = width / 2 - this.width / 2;
      for (const stone of this.placedStones) stone.centerX += deltaX;
      this.pendingCenterX += deltaX;
    }
    this.width = width;
    this.height = height;
    this.relayoutStack();
  }

  groundY(): number {
    return this.height * GROUND_Y_RATIO;
  }

  /** 現在の最上段（なければ地面）の支持面。 */
  currentSupport(): SupportSurface {
    const top = this.placedStones[this.placedStones.length - 1];
    if (!top) return { centerX: this.width / 2, halfWidth: BASE_SUPPORT_HALF_WIDTH };
    return { centerX: top.centerX, halfWidth: top.topHalfWidth };
  }

  windAmplitude(): number {
    return Math.min(
      WIND_MAX_AMPLITUDE,
      WIND_BASE_AMPLITUDE + this.placedStones.length * WIND_AMPLITUDE_PER_STONE,
    );
  }

  windFrequency(): number {
    return Math.min(
      WIND_MAX_FREQUENCY,
      WIND_BASE_FREQUENCY + this.placedStones.length * WIND_FREQUENCY_PER_STONE,
    );
  }

  currentWindOffset(): number {
    return Math.sin(this.windPhase) * this.windAmplitude();
  }

  /** 今落としたら安定するかどうかを、実際には落とさずに確認する（HUD表示用）。 */
  previewStability(): DropEvaluation {
    return evaluateDrop(
      this.currentSupport(),
      this.pendingStone,
      this.pendingCenterX,
      this.pendingRotation,
      this.currentWindOffset(),
    );
  }

  pendingCenterY(): number {
    return this.nextStoneCenterY(this.pendingStone.height);
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;
    this.windPhase += deltaSeconds * this.windFrequency() * Math.PI * 2;
  }

  movePendingTo(x: number): void {
    if (this.isOver) return;
    const margin = this.pendingStone.halfWidth;
    this.pendingCenterX = Math.min(Math.max(x, margin), this.width - margin);
  }

  movePendingBy(deltaX: number): void {
    this.movePendingTo(this.pendingCenterX + deltaX);
  }

  rotatePendingBy(deltaRotation: number): void {
    if (this.isOver) return;
    this.pendingRotation = clampRotation(this.pendingRotation + deltaRotation);
  }

  dropPending(): DropEvaluation | null {
    if (this.isOver) return null;

    const support = this.currentSupport();
    const windOffset = this.currentWindOffset();
    const evaluation = evaluateDrop(
      support,
      this.pendingStone,
      this.pendingCenterX,
      this.pendingRotation,
      windOffset,
    );
    const centerY = this.nextStoneCenterY(this.pendingStone.height);

    if (!evaluation.isStable) {
      this.isOver = true;
      this.toppleResult = {
        stone: this.pendingStone,
        centerX: this.pendingCenterX,
        centerY,
        rotation: this.pendingRotation,
        comX: evaluation.comX,
        direction: evaluation.comX > support.centerX ? 1 : -1,
      };
      this.onToppled?.(this.toppleResult);
      return evaluation;
    }

    const placed: PlacedStone = {
      ...this.pendingStone,
      rotation: this.pendingRotation,
      centerX: this.pendingCenterX,
      centerY,
      topHalfWidth: evaluation.nextSupport.halfWidth,
    };
    this.placedStones.push(placed);
    this.onStonePlaced?.({ stone: placed, height: this.placedStones.length });

    this.pendingRotation = 0;
    this.pendingCenterX = placed.centerX;
    this.pendingStone = this.generateStone();
    return evaluation;
  }

  private nextStoneCenterY(stoneHeight: number): number {
    const stackedHeight = this.placedStones.reduce((sum, s) => sum + s.height, 0);
    return this.groundY() - stackedHeight - stoneHeight / 2;
  }

  private relayoutStack(): void {
    let cumulativeBefore = 0;
    for (const stone of this.placedStones) {
      stone.centerY = this.groundY() - cumulativeBefore - stone.height / 2;
      cumulativeBefore += stone.height;
    }
  }

  private generateStone(): Stone {
    const n = this.placedStones.length;
    const halfWidthMax = Math.max(
      STONE_HALFWIDTH_MAX_FLOOR,
      STONE_HALFWIDTH_MAX_START - n * STONE_HALFWIDTH_SHRINK_PER_STONE,
    );
    const halfWidthMin = Math.max(
      STONE_HALFWIDTH_MIN_FLOOR,
      halfWidthMax - STONE_HALFWIDTH_MIN_MARGIN,
    );
    const halfWidth = randRange(halfWidthMin, halfWidthMax);
    const height = randRange(STONE_HEIGHT_MIN, STONE_HEIGHT_MAX);
    const comOffset = randRange(-halfWidth * COM_OFFSET_RATIO, halfWidth * COM_OFFSET_RATIO);
    return {
      id: nextStoneId++,
      halfWidth,
      height,
      comOffset,
      shapePoints: generateShapePoints(),
    };
  }
}
