export interface Vec2 {
  x: number;
  y: number;
}

export interface StrokeState {
  readonly points: readonly Vec2[];
  readonly toleranceRadius: number;
  readonly timeLimitSeconds: number;
}

interface StrokeTemplate {
  readonly points: readonly Vec2[];
}

// 筆運びの基本形。実際の漢字の筆順ではなく「横画・縦画・斜め・はね」を単純化した折れ線。
// 乱数で経路を作ると毎回違う位置になりテストが不安定になるため、固定パターンを順番に出す。
const STROKE_TEMPLATES: readonly StrokeTemplate[] = [
  {
    points: [
      { x: 0.2, y: 0.42 },
      { x: 0.5, y: 0.38 },
      { x: 0.8, y: 0.44 },
    ],
  },
  {
    points: [
      { x: 0.5, y: 0.18 },
      { x: 0.47, y: 0.5 },
      { x: 0.53, y: 0.82 },
    ],
  },
  {
    points: [
      { x: 0.24, y: 0.24 },
      { x: 0.5, y: 0.46 },
      { x: 0.76, y: 0.7 },
    ],
  },
  {
    points: [
      { x: 0.3, y: 0.76 },
      { x: 0.5, y: 0.46 },
      { x: 0.64, y: 0.2 },
    ],
  },
];

export const START_LIVES = 3;
export const OFF_PATH_FAIL_SECONDS = 1.2;
export const CLEAN_RATIO_THRESHOLD = 0.75;

const BASE_TOLERANCE_FRACTION = 0.065;
const MIN_TOLERANCE_PX = 16;
const BASE_STROKE_SPEED_PX_PER_SEC = 240;
const SPEED_GROWTH_PER_DIFFICULTY = 60;
const MIN_TIME_LIMIT_SECONDS = 3;
const TIME_LIMIT_BUFFER_SECONDS = 2;
const DRY_RATE_PER_SECOND = 0.12;
const BASE_POINTS = 100;
const SPEED_BONUS_POINTS = 50;
const COMBO_BONUS = 40;
const DIFFICULTY_STEP = 0.12;
const MAX_DIFFICULTY = 2.4;
const CAPTURE_MARGIN_PX = 16;
const MIN_FORWARD_JUMP_PX = 50;
const MAX_FORWARD_JUMP_FRACTION = 0.4;

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function polylineLength(points: readonly Vec2[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1], points[i]);
  return total;
}

function pointAtLength(points: readonly Vec2[], length: number): Vec2 {
  if (points.length === 0) return { x: 0, y: 0 };
  let remaining = Math.max(0, length);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const segmentLength = distance(a, b);
    if (remaining <= segmentLength || i === points.length - 1) {
      const t = segmentLength > 0 ? Math.min(1, remaining / segmentLength) : 0;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    remaining -= segmentLength;
  }
  return points[points.length - 1];
}

interface PolylineProjection {
  lengthAlong: number;
  distance: number;
  point: Vec2;
}

/** 折れ線上で点に最も近い位置を求める。ポインタがガイドからどれだけ外れているかの判定に使う。 */
function projectOntoPolyline(point: Vec2, points: readonly Vec2[]): PolylineProjection {
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestLengthAlong = 0;
  let bestPoint: Vec2 = points[0] ?? point;
  let cumulative = 0;

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const segmentLength = distance(a, b);
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const lengthSquared = abx * abx + aby * aby;
    const t =
      lengthSquared > 0
        ? Math.min(1, Math.max(0, ((point.x - a.x) * abx + (point.y - a.y) * aby) / lengthSquared))
        : 0;
    const projected: Vec2 = { x: a.x + abx * t, y: a.y + aby * t };
    const projectedDistance = distance(point, projected);
    if (projectedDistance < bestDistance) {
      bestDistance = projectedDistance;
      bestLengthAlong = cumulative + segmentLength * t;
      bestPoint = projected;
    }
    cumulative += segmentLength;
  }

  return { lengthAlong: bestLengthAlong, distance: bestDistance, point: bestPoint };
}

function toleranceRadiusFor(width: number, height: number, difficulty: number): number {
  const minDimension = Math.max(1, Math.min(width, height));
  return Math.max(MIN_TOLERANCE_PX, (minDimension * BASE_TOLERANCE_FRACTION) / difficulty);
}

function timeLimitSecondsFor(pathLength: number, difficulty: number): number {
  const speed = BASE_STROKE_SPEED_PX_PER_SEC + SPEED_GROWTH_PER_DIFFICULTY * (difficulty - 1);
  return Math.max(MIN_TIME_LIMIT_SECONDS, pathLength / speed + TIME_LIMIT_BUFFER_SECONDS);
}

function generateStroke(
  width: number,
  height: number,
  difficulty: number,
  templateIndex: number,
): StrokeState {
  const template = STROKE_TEMPLATES[templateIndex % STROKE_TEMPLATES.length];
  const points = template.points.map((p) => ({ x: p.x * width, y: p.y * height }));
  const length = polylineLength(points);
  return {
    points,
    toleranceRadius: toleranceRadiusFor(width, height, difficulty),
    timeLimitSeconds: timeLimitSecondsFor(length, difficulty),
  };
}

export interface StrokeCompletedEvent {
  points: number;
  combo: number;
  isClean: boolean;
}

/**
 * 書道の「なぞり書き」ロジック。ガイドの折れ線を筆（ポインタ）でなぞり、
 * 外れずに終点まで到達すると1画完成する。描画(pixi)やReactには依存しない。
 */
export class SumiTraceWorld {
  width = 0;
  height = 0;
  lives = START_LIVES;
  score = 0;
  combo = 0;
  isOver = false;
  isDrawing = false;
  isPointerOffPath = false;
  progressLength = 0;
  strokeTimer = 0;
  offPathSeconds = 0;
  stroke: StrokeState;

  private strokesCompleted = 0;
  private difficulty = 1;

  onStrokeCompleted: ((event: StrokeCompletedEvent) => void) | null = null;
  onStrokeFailed: (() => void) | null = null;

  constructor(width: number, height: number) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.stroke = generateStroke(this.width, this.height, 1, 0);
    this.reset();
  }

  reset(): void {
    this.lives = START_LIVES;
    this.score = 0;
    this.combo = 0;
    this.isOver = false;
    this.isDrawing = false;
    this.isPointerOffPath = false;
    this.strokesCompleted = 0;
    this.difficulty = 1;
    this.stroke = generateStroke(this.width, this.height, this.difficulty, this.strokesCompleted);
    this.progressLength = 0;
    this.strokeTimer = 0;
    this.offPathSeconds = 0;
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const scaleX = this.width > 0 ? width / this.width : 1;
    const scaleY = this.height > 0 ? height / this.height : 1;
    const previousTotalLength = this.totalLength || 1;
    const progressRatio = this.progressLength / previousTotalLength;
    const scaledPoints = this.stroke.points.map((p) => ({ x: p.x * scaleX, y: p.y * scaleY }));
    const newLength = polylineLength(scaledPoints);
    // 許容範囲や制限時間は「今の画面サイズに対する割合」で決まるため、古い値を比例縮小するのではなく
    // 新しいサイズから作り直す（リサイズ前がダミーの1x1だった場合に比例縮小すると値が破綻するため）。
    this.stroke = {
      points: scaledPoints,
      toleranceRadius: toleranceRadiusFor(width, height, this.difficulty),
      timeLimitSeconds: timeLimitSecondsFor(newLength, this.difficulty),
    };
    this.progressLength = progressRatio * newLength;
    this.width = width;
    this.height = height;
  }

  get frontierPoint(): Vec2 {
    return pointAtLength(this.stroke.points, this.progressLength);
  }

  get totalLength(): number {
    return polylineLength(this.stroke.points);
  }

  get progressRatio(): number {
    const total = this.totalLength;
    return total > 0 ? Math.min(1, this.progressLength / total) : 0;
  }

  /** 開始点から現在の進行位置までの折れ線。描画側が「実際に引けた墨の線」を描くのに使う。 */
  get tracedPoints(): Vec2[] {
    const points = this.stroke.points;
    if (points.length === 0) return [];
    const result: Vec2[] = [points[0]];
    let remaining = this.progressLength;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const segmentLength = distance(a, b);
      if (remaining >= segmentLength) {
        result.push(b);
        remaining -= segmentLength;
      } else {
        const t = segmentLength > 0 ? remaining / segmentLength : 0;
        result.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        break;
      }
    }
    return result;
  }

  /** 筆を下ろす。ガイドの先端（まだなぞっていない位置）付近でなければ掴めない。 */
  startPointer(x: number, y: number): void {
    if (this.isOver || this.isDrawing) return;
    const captureRadius = this.stroke.toleranceRadius + CAPTURE_MARGIN_PX;
    if (distance({ x, y }, this.frontierPoint) <= captureRadius) {
      this.isDrawing = true;
      this.isPointerOffPath = false;
    }
  }

  movePointer(x: number, y: number): void {
    if (!this.isDrawing || this.isOver) return;
    const total = this.totalLength;
    if (total <= 0) return;

    const projection = projectOntoPolyline({ x, y }, this.stroke.points);
    this.isPointerOffPath = projection.distance > this.stroke.toleranceRadius;

    if (projection.lengthAlong > this.progressLength) {
      const maxForwardJump = Math.max(MIN_FORWARD_JUMP_PX, total * MAX_FORWARD_JUMP_FRACTION);
      this.progressLength = Math.min(
        total,
        Math.min(projection.lengthAlong, this.progressLength + maxForwardJump),
      );
    }
  }

  /** 筆を上げる。描き途中なら進行は維持されるが、乾きが進み始める。 */
  endPointer(): void {
    this.isDrawing = false;
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    if (this.isDrawing) {
      this.strokeTimer += deltaSeconds;
      if (this.isPointerOffPath) this.offPathSeconds += deltaSeconds;
    } else if (this.progressLength > 0 && this.progressRatio < 1) {
      // 筆を上げたまま置いておくと、その分だけ墨が乾いて線がかすれる。
      this.progressLength = Math.max(
        0,
        this.progressLength - DRY_RATE_PER_SECOND * this.totalLength * deltaSeconds,
      );
      this.strokeTimer += deltaSeconds;
    }

    if (this.progressRatio >= 1) {
      this.completeStroke();
      return;
    }

    if (
      this.offPathSeconds >= OFF_PATH_FAIL_SECONDS ||
      this.strokeTimer >= this.stroke.timeLimitSeconds
    ) {
      this.failStroke();
    }
  }

  private completeStroke(): void {
    const elapsed = Math.max(this.strokeTimer, 0.001);
    const cleanRatio = Math.max(0, 1 - this.offPathSeconds / elapsed);
    const isClean = cleanRatio >= CLEAN_RATIO_THRESHOLD;

    this.combo = isClean ? this.combo + 1 : 0;

    const accuracyPoints = Math.round(BASE_POINTS * cleanRatio);
    const speedRatio = Math.max(
      0,
      (this.stroke.timeLimitSeconds - this.strokeTimer) / this.stroke.timeLimitSeconds,
    );
    const speedPoints = Math.round(SPEED_BONUS_POINTS * speedRatio);
    const comboBonus = this.combo * COMBO_BONUS;
    const totalPoints = accuracyPoints + speedPoints + comboBonus;
    this.score += totalPoints;

    this.onStrokeCompleted?.({ points: totalPoints, combo: this.combo, isClean });

    this.strokesCompleted++;
    this.difficulty = Math.min(MAX_DIFFICULTY, this.difficulty + DIFFICULTY_STEP);
    this.startNextStroke();
  }

  private failStroke(): void {
    this.lives--;
    this.combo = 0;
    this.onStrokeFailed?.();
    if (this.lives <= 0) {
      this.isOver = true;
      this.isDrawing = false;
      return;
    }
    this.startNextStroke();
  }

  private startNextStroke(): void {
    this.stroke = generateStroke(this.width, this.height, this.difficulty, this.strokesCompleted);
    this.progressLength = 0;
    this.strokeTimer = 0;
    this.offPathSeconds = 0;
    this.isDrawing = false;
    this.isPointerOffPath = false;
  }
}
