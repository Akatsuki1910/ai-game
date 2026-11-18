export const SHAPE_IDS = ["triangle", "arrow", "ell", "trapezoid", "house", "tee", "step"] as const;

export type ShapeId = (typeof SHAPE_IDS)[number];

export interface Piece {
  id: number;
  shapeId: ShapeId;
  x: number;
  y: number;
  rotationDeg: number;
  isPlaced: boolean;
  radius: number;
}

export interface Slot {
  id: number;
  shapeId: ShapeId;
  x: number;
  y: number;
  targetRotationDeg: number;
  radius: number;
  occupiedBy: number | null;
}

export interface PieceSeatedEvent {
  piece: Piece;
  points: number;
  combo: number;
}

export interface RoundCompletedEvent {
  round: number;
  bonus: number;
}

interface Anchor {
  fx: number;
  fy: number;
}

/** 右側の盤面に並ぶ7つの枠の相対位置（形状indexと対応）。 */
const SLOT_ANCHORS: readonly Anchor[] = [
  { fx: 0.5, fy: 0.22 },
  { fx: 0.7, fy: 0.18 },
  { fx: 0.9, fy: 0.3 },
  { fx: 0.5, fy: 0.54 },
  { fx: 0.74, fy: 0.54 },
  { fx: 0.58, fy: 0.84 },
  { fx: 0.84, fy: 0.82 },
];

/** 左側のトレイに散らばるピースの相対初期位置（形状indexと対応）。 */
const TRAY_ANCHORS: readonly Anchor[] = [
  { fx: 0.08, fy: 0.18 },
  { fx: 0.26, fy: 0.14 },
  { fx: 0.08, fy: 0.4 },
  { fx: 0.28, fy: 0.42 },
  { fx: 0.08, fy: 0.64 },
  { fx: 0.26, fy: 0.68 },
  { fx: 0.14, fy: 0.88 },
];

export const ROTATION_STEP_DEG = 45;
export const PIECE_RADIUS = 34;
export const POSITION_TOLERANCE = 30;
export const BASE_ROUND_SECONDS = 55;
const ROUND_SECONDS_STEP = 4;
const MIN_ROUND_SECONDS = 26;
const BASE_POINTS = 100;
const COMBO_BONUS_PER_EXTRA = 40;
const TIME_BONUS_PER_SECOND = 8;

let nextId = 1;

export function normalizeAngle(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** ラウンドが進むほど制限時間が短くなる（下限あり）。 */
export function roundSeconds(round: number): number {
  return Math.max(MIN_ROUND_SECONDS, BASE_ROUND_SECONDS - (round - 1) * ROUND_SECONDS_STEP);
}

/**
 * ラウンド1は全枠が正立(0度)で、回転なしで合わせられる易しい導入にする。
 * ラウンド2以降は形状indexとラウンド数から決まる向きを要求する。
 */
function targetRotationDeg(round: number, shapeIndex: number): number {
  if (round === 1) return 0;
  return normalizeAngle((shapeIndex + round) * ROTATION_STEP_DEG);
}

/** トレイに出す時点の初期角度。ラウンド1は正立、以降は目標とずらして回転操作を要求する。 */
function trayRotationDeg(round: number, shapeIndex: number): number {
  if (round === 1) return 0;
  return normalizeAngle((shapeIndex + round + 4) * ROTATION_STEP_DEG);
}

export class SilhouetteBoardWorld {
  width = 0;
  height = 0;
  pieces: Piece[] = [];
  slots: Slot[] = [];
  score = 0;
  combo = 0;
  round = 1;
  timeRemaining = roundSeconds(1);
  isOver = false;

  onPieceSeated: ((event: PieceSeatedEvent) => void) | null = null;
  onRoundCompleted: ((event: RoundCompletedEvent) => void) | null = null;

  constructor(width: number, height: number) {
    this.resize(width, height);
    this.reset();
  }

  get placedCount(): number {
    return this.pieces.filter((p) => p.isPlaced).length;
  }

  get totalCount(): number {
    return this.pieces.length;
  }

  reset(): void {
    this.score = 0;
    this.combo = 0;
    this.round = 1;
    this.isOver = false;
    this.timeRemaining = roundSeconds(this.round);
    this.setupRound();
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const scaleX = this.width > 0 ? width / this.width : 1;
    const scaleY = this.height > 0 ? height / this.height : 1;
    if (this.width > 0 && this.height > 0) {
      for (const piece of this.pieces) {
        piece.x *= scaleX;
        piece.y *= scaleY;
      }
      for (const slot of this.slots) {
        slot.x *= scaleX;
        slot.y *= scaleY;
      }
    }
    this.width = width;
    this.height = height;
  }

  findPieceAt(x: number, y: number): Piece | undefined {
    return this.pieces.find((p) => !p.isPlaced && Math.hypot(p.x - x, p.y - y) <= p.radius + 8);
  }

  setPiecePosition(id: number, x: number, y: number): void {
    const piece = this.pieces.find((p) => p.id === id);
    if (!piece || piece.isPlaced) return;
    const margin = piece.radius;
    piece.x = Math.min(Math.max(x, margin), Math.max(margin, this.width - margin));
    piece.y = Math.min(Math.max(y, margin), Math.max(margin, this.height - margin));
  }

  rotatePiece(id: number, deltaDeg: number = ROTATION_STEP_DEG): void {
    const piece = this.pieces.find((p) => p.id === id);
    if (!piece || piece.isPlaced) return;
    piece.rotationDeg = normalizeAngle(piece.rotationDeg + deltaDeg);
  }

  /**
   * 現在位置・角度で枠に合うかを試す。合えば吸着して確定、合わなければ何もせず
   * コンボだけ崩れる（ドラッグ中の位置自体はそのまま残る＝スナップバックしない）。
   */
  tryPlacePiece(id: number): boolean {
    const piece = this.pieces.find((p) => p.id === id);
    if (!piece || piece.isPlaced) return false;

    const slot = this.slots.find((s) => s.shapeId === piece.shapeId && s.occupiedBy === null);
    if (!slot) return false;

    const distance = Math.hypot(piece.x - slot.x, piece.y - slot.y);
    const rotationMatches =
      normalizeAngle(piece.rotationDeg) === normalizeAngle(slot.targetRotationDeg);

    if (distance > POSITION_TOLERANCE || !rotationMatches) {
      this.combo = 0;
      return false;
    }

    piece.x = slot.x;
    piece.y = slot.y;
    piece.rotationDeg = slot.targetRotationDeg;
    piece.isPlaced = true;
    slot.occupiedBy = piece.id;

    this.combo += 1;
    const points = BASE_POINTS + (this.combo - 1) * COMBO_BONUS_PER_EXTRA;
    this.score += points;
    this.onPieceSeated?.({ piece, points, combo: this.combo - 1 });

    if (this.pieces.every((p) => p.isPlaced)) {
      const bonus = Math.round(this.timeRemaining) * TIME_BONUS_PER_SECOND;
      this.score += bonus;
      this.onRoundCompleted?.({ round: this.round, bonus });
      this.round += 1;
      this.timeRemaining = roundSeconds(this.round);
      this.setupRound();
    }

    return true;
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;
    this.timeRemaining = Math.max(0, this.timeRemaining - deltaSeconds);
    if (this.timeRemaining <= 0) {
      this.isOver = true;
    }
  }

  private setupRound(): void {
    this.slots = SHAPE_IDS.map((shapeId, index) => {
      const anchor = SLOT_ANCHORS[index];
      return {
        id: nextId++,
        shapeId,
        x: anchor.fx * this.width,
        y: anchor.fy * this.height,
        targetRotationDeg: targetRotationDeg(this.round, index),
        radius: PIECE_RADIUS,
        occupiedBy: null,
      };
    });

    this.pieces = SHAPE_IDS.map((shapeId, index) => {
      const anchor = TRAY_ANCHORS[index];
      return {
        id: nextId++,
        shapeId,
        x: anchor.fx * this.width,
        y: anchor.fy * this.height,
        rotationDeg: trayRotationDeg(this.round, index),
        isPlaced: false,
        radius: PIECE_RADIUS,
      };
    });
  }
}
