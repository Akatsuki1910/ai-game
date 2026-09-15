export interface CrackPoint {
  readonly xRatio: number;
  readonly yRatio: number;
}

export interface PxPoint {
  readonly x: number;
  readonly y: number;
}

export interface BowlCompletedEvent {
  bowlsCompleted: number;
  points: number;
}

export const GOLD_MAX = 100;
export const ROUND_START_GOLD = GOLD_MAX;

const TOLERANCE_RATIO = 0.045;
const ON_PATH_DRAIN_PER_SEC = 8;
const OFF_PATH_WASTE_PER_SEC = 30;
const FILL_SPEED_PX_PER_SEC = 220;
const REFILL_ON_COMPLETE = 32;
const BASE_POINTS = 150;
const POINTS_PER_REMAINING_GOLD = 3;
const MAX_COMPLEXITY = 5;

const MARGIN_RATIO = 0.12;
const MIN_ENDPOINT_DISTANCE_RATIO = 0.4;
const BASE_DISPLACEMENT_RATIO = 0.22;
const DISPLACEMENT_DECAY = 0.58;

function clampRatio(value: number): number {
  const min = MARGIN_RATIO * 0.4;
  const max = 1 - MARGIN_RATIO * 0.4;
  return Math.min(max, Math.max(min, value));
}

function randomRatioPoint(): CrackPoint {
  return {
    xRatio: MARGIN_RATIO + Math.random() * (1 - MARGIN_RATIO * 2),
    yRatio: MARGIN_RATIO + Math.random() * (1 - MARGIN_RATIO * 2),
  };
}

function pickEndpoints(): [CrackPoint, CrackPoint] {
  const start = randomRatioPoint();
  let end = randomRatioPoint();
  let guard = 0;
  while (
    Math.hypot(end.xRatio - start.xRatio, end.yRatio - start.yRatio) <
      MIN_ENDPOINT_DISTANCE_RATIO &&
    guard < 30
  ) {
    end = randomRatioPoint();
    guard += 1;
  }
  return [start, end];
}

function subdivide(points: readonly CrackPoint[], displacement: number): CrackPoint[] {
  const next: CrackPoint[] = [points[0]];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const midX = (a.xRatio + b.xRatio) / 2;
    const midY = (a.yRatio + b.yRatio) / 2;
    const dx = b.xRatio - a.xRatio;
    const dy = b.yRatio - a.yRatio;
    const length = Math.hypot(dx, dy) || 1;
    const normalX = -dy / length;
    const normalY = dx / length;
    const offset = (Math.random() * 2 - 1) * displacement;
    next.push({
      xRatio: clampRatio(midX + normalX * offset),
      yRatio: clampRatio(midY + normalY * offset),
    });
    next.push(b);
  }
  return next;
}

/** 中点変位法でジグザグに折れ曲がった、器のひびらしい形の折れ線を生成する。 */
export function generateCrackPoints(complexity: number): CrackPoint[] {
  let points: CrackPoint[] = pickEndpoints();
  let displacement = BASE_DISPLACEMENT_RATIO;
  const iterations = Math.max(1, Math.min(MAX_COMPLEXITY, Math.round(complexity)));
  for (let i = 0; i < iterations; i++) {
    points = subdivide(points, displacement);
    displacement *= DISPLACEMENT_DECAY;
  }
  return points;
}

/**
 * 割れた器のひびを、始点から筆先(ポインタ)を離さずになぞって金で継ぐパズル。
 *
 * ひびは比率座標(0〜1)で保持し、リサイズのたびに実ピクセル座標へ変換し直す
 * ことで、画面サイズが変わっても盤面がそのまま追従する(prism-drift と同じ方針)。
 * 進捗は「なぞり終えた地点(filledLengthPx)」を先端(frontier)とし、そこから
 * ポインタが許容半径内にある間だけ先端が進む。ポインタが離れていると、
 * 金粉を無駄にするだけで進捗は進まない。
 */
export class GoldSeamWorld {
  width = 0;
  height = 0;
  crackPoints: CrackPoint[] = [];
  filledLengthPx = 0;
  totalLengthPx = 0;
  gold = GOLD_MAX;
  score = 0;
  bowlsCompleted = 0;
  isOver = false;

  pointerX = 0;
  pointerY = 0;
  isPointerDown = false;

  onBowlCompleted: ((event: BowlCompletedEvent) => void) | null = null;

  private segmentLengthsPx: number[] = [];
  private cumulativeLengthsPx: number[] = [0];

  constructor(width: number, height: number) {
    this.resize(width, height);
    this.reset();
  }

  reset(): void {
    this.gold = GOLD_MAX;
    this.score = 0;
    this.bowlsCompleted = 0;
    this.isOver = false;
    this.isPointerDown = false;
    this.generateNewCrack();
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.width = width;
    this.height = height;
    this.recomputeLengths();
  }

  setPointer(x: number, y: number, isDown: boolean): void {
    this.pointerX = x;
    this.pointerY = y;
    this.isPointerDown = isDown;
  }

  get toleranceRadiusPx(): number {
    return Math.min(this.width, this.height) * TOLERANCE_RATIO;
  }

  get progressRatio(): number {
    return this.totalLengthPx > 0 ? this.filledLengthPx / this.totalLengthPx : 0;
  }

  /** ひび全体を実ピクセル座標の折れ線として返す(描画用)。 */
  getPathPointsPx(): PxPoint[] {
    return this.crackPoints.map((p) => this.toPx(p));
  }

  /** なぞり終えた区間(始点〜先端)を実ピクセル座標の折れ線として返す(金の描画用)。 */
  getFilledPathPointsPx(): PxPoint[] {
    const pxPoints = this.getPathPointsPx();
    const result: PxPoint[] = [];
    for (let i = 0; i < pxPoints.length; i++) {
      if (this.cumulativeLengthsPx[i] > this.filledLengthPx) break;
      result.push(pxPoints[i]);
    }
    result.push(this.pointAtArcLength(this.filledLengthPx));
    return result;
  }

  /** 現在の先端(次になぞるべき地点)の実ピクセル座標。 */
  getFrontierPointPx(): PxPoint {
    return this.pointAtArcLength(this.filledLengthPx);
  }

  pointAtArcLength(arcLengthPx: number): PxPoint {
    const pxPoints = this.getPathPointsPx();
    if (pxPoints.length === 0) return { x: 0, y: 0 };
    if (pxPoints.length === 1 || arcLengthPx <= 0) return pxPoints[0];
    if (arcLengthPx >= this.totalLengthPx) return pxPoints[pxPoints.length - 1];

    for (let i = 0; i < this.segmentLengthsPx.length; i++) {
      const segStart = this.cumulativeLengthsPx[i];
      const segEnd = this.cumulativeLengthsPx[i + 1];
      if (arcLengthPx <= segEnd) {
        const segLength = this.segmentLengthsPx[i] || 1;
        const t = (arcLengthPx - segStart) / segLength;
        const a = pxPoints[i];
        const b = pxPoints[i + 1];
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      }
    }
    return pxPoints[pxPoints.length - 1];
  }

  step(deltaSeconds: number): void {
    if (this.isOver || this.totalLengthPx <= 0) return;

    if (this.isPointerDown) {
      const frontier = this.getFrontierPointPx();
      const distance = Math.hypot(this.pointerX - frontier.x, this.pointerY - frontier.y);
      if (distance <= this.toleranceRadiusPx) {
        this.gold = Math.max(0, this.gold - ON_PATH_DRAIN_PER_SEC * deltaSeconds);
        this.filledLengthPx = Math.min(
          this.totalLengthPx,
          this.filledLengthPx + FILL_SPEED_PX_PER_SEC * deltaSeconds,
        );
      } else {
        this.gold = Math.max(0, this.gold - OFF_PATH_WASTE_PER_SEC * deltaSeconds);
      }
    }

    if (this.filledLengthPx >= this.totalLengthPx) {
      this.completeBowl();
    } else if (this.gold <= 0) {
      this.isOver = true;
    }
  }

  private completeBowl(): void {
    const points = BASE_POINTS + Math.round(this.gold * POINTS_PER_REMAINING_GOLD);
    this.score += points;
    this.bowlsCompleted += 1;
    this.gold = Math.min(GOLD_MAX, this.gold + REFILL_ON_COMPLETE);
    this.onBowlCompleted?.({ bowlsCompleted: this.bowlsCompleted, points });
    this.generateNewCrack();
  }

  private generateNewCrack(): void {
    this.crackPoints = generateCrackPoints(2 + this.bowlsCompleted);
    this.filledLengthPx = 0;
    this.recomputeLengths();
  }

  private toPx(p: CrackPoint): PxPoint {
    return { x: p.xRatio * this.width, y: p.yRatio * this.height };
  }

  private recomputeLengths(): void {
    const pxPoints = this.getPathPointsPx();
    this.segmentLengthsPx = [];
    this.cumulativeLengthsPx = [0];
    for (let i = 1; i < pxPoints.length; i++) {
      const a = pxPoints[i - 1];
      const b = pxPoints[i];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      this.segmentLengthsPx.push(length);
      this.cumulativeLengthsPx.push(
        this.cumulativeLengthsPx[this.cumulativeLengthsPx.length - 1] + length,
      );
    }
    this.totalLengthPx = this.cumulativeLengthsPx[this.cumulativeLengthsPx.length - 1] ?? 0;
    this.filledLengthPx = Math.min(this.filledLengthPx, this.totalLengthPx);
  }
}
