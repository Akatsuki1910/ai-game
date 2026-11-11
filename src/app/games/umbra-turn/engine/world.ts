export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Point2D {
  x: number;
  z: number;
}

export interface Rotation {
  yaw: number;
  pitch: number;
}

export interface RoundLockedEvent {
  round: number;
  score: number;
}

export interface RoundFailedEvent {
  round: number;
  livesRemaining: number;
}

export interface GameOverEvent {
  round: number;
  score: number;
}

const INITIAL_LIVES = 3;

const ROUND_TIME_START_SECONDS = 14;
const ROUND_TIME_MIN_SECONDS = 7;
const ROUND_TIME_DECAY_PER_ROUND = 0.4;

const MATCH_THRESHOLD_START = 0.82;
const MATCH_THRESHOLD_MAX = 0.93;
const MATCH_THRESHOLD_GROWTH_PER_ROUND = 0.01;

const HOLD_DURATION_START_SECONDS = 0.5;
const HOLD_DURATION_MAX_SECONDS = 0.9;
const HOLD_DURATION_GROWTH_PER_ROUND = 0.02;
/** 閾値を下回った間、集中(hold)ゲージが毎秒この倍率で減っていく。多少のブレは許容するが、外し続けると0に戻る。 */
const HOLD_DECAY_RATE_PER_SECOND = 1.4;

const SCORE_PER_ROUND_BASE = 100;
const SCORE_PER_ROUND_GROWTH_PER_ROUND = 15;

/** ピッチ(X軸回転)の可動範囲。90度に近づくと投影がほぼ線状に縮退してしまうため余裕を持って制限する。 */
export const PITCH_LIMIT_RADIANS = (75 * Math.PI) / 180;
/** お題の姿勢は可動範囲の中でも縮退しにくい範囲からだけ選ぶ。 */
const TARGET_PITCH_RANGE_RADIANS = PITCH_LIMIT_RADIANS * 0.8;

/**
 * 非対称な双錐(bipyramid)の頂点群。上下の高さと赤道上の4点の距離をすべて異なる値にすることで、
 * ヨー/ピッチどちらを変えても輪郭(シルエット)の形が変化するようにしている(回転対称だと
 * ヨーを変えても見た目が変わらず、パズルとして成立しない)。
 */
export const CRYSTAL_POINTS: readonly Vec3[] = [
  { x: 0, y: 1.35, z: 0 },
  { x: 0, y: -0.85, z: 0 },
  { x: 1.1, y: 0, z: 0 },
  { x: 0, y: 0, z: 0.75 },
  { x: -0.95, y: 0, z: 0.15 },
  { x: -0.25, y: 0, z: -1.05 },
];

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** -π〜π に正規化する。 */
export function wrapAngle(angle: number): number {
  let wrapped = angle % (Math.PI * 2);
  if (wrapped > Math.PI) wrapped -= Math.PI * 2;
  if (wrapped < -Math.PI) wrapped += Math.PI * 2;
  return wrapped;
}

/** Y軸でyaw、続けてX軸でpitch回転させた点を返す。 */
export function rotatePoint(point: Vec3, yaw: number, pitch: number): Vec3 {
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const x1 = point.x * cosYaw + point.z * sinYaw;
  const z1 = -point.x * sinYaw + point.z * cosYaw;
  const y1 = point.y;

  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  const y2 = y1 * cosPitch - z1 * sinPitch;
  const z2 = y1 * sinPitch + z1 * cosPitch;

  return { x: x1, y: y2, z: z2 };
}

/** 指定した姿勢で光を真上から当てたときの、地面に落ちる投影点(x,z)の集合を返す。 */
export function projectPoints(yaw: number, pitch: number): Point2D[] {
  return CRYSTAL_POINTS.map((point) => {
    const rotated = rotatePoint(point, yaw, pitch);
    return { x: rotated.x, z: rotated.z };
  });
}

function cross(origin: Point2D, a: Point2D, b: Point2D): number {
  return (a.x - origin.x) * (b.z - origin.z) - (a.z - origin.z) * (b.x - origin.x);
}

/**
 * Andrew's monotone chain法による2D凸包。重複点は除去する。
 * 戻り値は反時計回り(CCW)で正規化される。
 */
export function convexHull(points: readonly Point2D[]): Point2D[] {
  const unique: Point2D[] = [];
  for (const point of points) {
    if (!unique.some((existing) => existing.x === point.x && existing.z === point.z)) {
      unique.push(point);
    }
  }
  if (unique.length < 3) return unique;

  const sorted = [...unique].sort((a, b) => (a.x === b.x ? a.z - b.z : a.x - b.x));

  const buildHalf = (sequence: Point2D[]): Point2D[] => {
    const half: Point2D[] = [];
    for (const point of sequence) {
      while (half.length >= 2 && cross(half[half.length - 2], half[half.length - 1], point) <= 0) {
        half.pop();
      }
      half.push(point);
    }
    return half;
  };

  const lower = buildHalf(sorted);
  const upper = buildHalf([...sorted].reverse());
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];

  if (signedArea(hull) < 0) hull.reverse();
  return hull;
}

function signedArea(polygon: readonly Point2D[]): number {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const current = polygon[i];
    const next = polygon[(i + 1) % polygon.length];
    sum += current.x * next.z - next.x * current.z;
  }
  return sum / 2;
}

/** シューレース(靴紐)公式による多角形の面積。 */
export function polygonArea(polygon: readonly Point2D[]): number {
  if (polygon.length < 3) return 0;
  return Math.abs(signedArea(polygon));
}

/**
 * Sutherland-Hodgmanアルゴリズムによる凸多角形同士の交差領域。
 * clip は反時計回り(CCW)である必要がある(convexHullの戻り値はその前提を満たす)。
 */
export function clipConvexPolygon(
  subject: readonly Point2D[],
  clip: readonly Point2D[],
): Point2D[] {
  if (subject.length < 3 || clip.length < 3) return [];

  let output: Point2D[] = [...subject];

  for (let i = 0; i < clip.length; i++) {
    if (output.length === 0) break;
    const clipA = clip[i];
    const clipB = clip[(i + 1) % clip.length];
    const input = output;
    output = [];

    for (let j = 0; j < input.length; j++) {
      const current = input[j];
      const previous = input[(j - 1 + input.length) % input.length];
      const currentInside = cross(clipA, clipB, current) >= 0;
      const previousInside = cross(clipA, clipB, previous) >= 0;

      if (currentInside) {
        if (!previousInside) {
          output.push(intersectEdge(previous, current, clipA, clipB));
        }
        output.push(current);
      } else if (previousInside) {
        output.push(intersectEdge(previous, current, clipA, clipB));
      }
    }
  }

  return output;
}

function intersectEdge(a: Point2D, b: Point2D, clipA: Point2D, clipB: Point2D): Point2D {
  const a1 = clipB.z - clipA.z;
  const b1 = clipA.x - clipB.x;
  const c1 = a1 * clipA.x + b1 * clipA.z;

  const a2 = b.z - a.z;
  const b2 = a.x - b.x;
  const c2 = a2 * a.x + b2 * a.z;

  const determinant = a1 * b2 - a2 * b1;
  if (Math.abs(determinant) < 1e-9) return a;

  return {
    x: (b1 * c2 - b2 * c1) / -determinant,
    z: (a1 * c2 - a2 * c1) / determinant,
  };
}

/** 2つの凸多角形のIoU(Intersection over Union)。0〜1。 */
export function computeIoU(a: readonly Point2D[], b: readonly Point2D[]): number {
  const areaA = polygonArea(a);
  const areaB = polygonArea(b);
  if (areaA <= 0 || areaB <= 0) return 0;

  const intersection = clipConvexPolygon(a, b);
  const areaIntersection = polygonArea(intersection);
  const union = areaA + areaB - areaIntersection;
  if (union <= 0) return 0;

  return clamp(areaIntersection / union, 0, 1);
}

/** 指定した姿勢のシルエット(凸包)を返す。 */
export function silhouetteForRotation(rotation: Rotation): Point2D[] {
  return convexHull(projectPoints(rotation.yaw, rotation.pitch));
}

/**
 * 床に落ちる影の輪郭を、回転させて目標の型にぴったり重ね続ける
 * リアルタイム3Dシルエットパズルの純粋ロジック層。React / three.js には一切依存しない。
 */
export class UmbraTurnWorld {
  yaw = 0;
  pitch = 0;
  targetYaw = 0;
  targetPitch = 0;

  round = 1;
  score = 0;
  lives = INITIAL_LIVES;
  timeRemaining = ROUND_TIME_START_SECONDS;
  holdProgress = 0;
  holdDuration = HOLD_DURATION_START_SECONDS;
  matchThreshold = MATCH_THRESHOLD_START;
  matchQuality = 0;
  isOver = false;

  onRoundLocked: ((event: RoundLockedEvent) => void) | null = null;
  onRoundFailed: ((event: RoundFailedEvent) => void) | null = null;
  onGameOver: ((event: GameOverEvent) => void) | null = null;

  private readonly randomFn: () => number;

  constructor(randomFn: () => number = Math.random) {
    this.randomFn = randomFn;
    this.reset();
  }

  reset(): void {
    this.score = 0;
    this.lives = INITIAL_LIVES;
    this.isOver = false;
    this.startRound(1);
  }

  /** ドラッグ量/キー入力量からの連続的な回転入力。ピッチは可動範囲でクランプする。 */
  rotateBy(deltaYaw: number, deltaPitch: number): void {
    if (this.isOver) return;
    this.yaw = wrapAngle(this.yaw + deltaYaw);
    this.pitch = clamp(this.pitch + deltaPitch, -PITCH_LIMIT_RADIANS, PITCH_LIMIT_RADIANS);
  }

  getLiveSilhouette(): Point2D[] {
    return silhouetteForRotation({ yaw: this.yaw, pitch: this.pitch });
  }

  getTargetSilhouette(): Point2D[] {
    return silhouetteForRotation({ yaw: this.targetYaw, pitch: this.targetPitch });
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    this.matchQuality = computeIoU(this.getLiveSilhouette(), this.getTargetSilhouette());

    if (this.matchQuality >= this.matchThreshold) {
      this.holdProgress = Math.min(this.holdDuration, this.holdProgress + deltaSeconds);
    } else {
      this.holdProgress = Math.max(
        0,
        this.holdProgress - deltaSeconds * HOLD_DECAY_RATE_PER_SECOND,
      );
    }

    if (this.holdProgress >= this.holdDuration) {
      this.lockRound();
      return;
    }

    this.timeRemaining -= deltaSeconds;
    if (this.timeRemaining <= 0) {
      this.failRound();
    }
  }

  private lockRound(): void {
    const points = SCORE_PER_ROUND_BASE + (this.round - 1) * SCORE_PER_ROUND_GROWTH_PER_ROUND;
    this.score += points;
    this.onRoundLocked?.({ round: this.round, score: this.score });
    this.startRound(this.round + 1);
  }

  private failRound(): void {
    this.lives -= 1;
    this.onRoundFailed?.({ round: this.round, livesRemaining: this.lives });
    if (this.lives <= 0) {
      this.isOver = true;
      this.onGameOver?.({ round: this.round, score: this.score });
      return;
    }
    this.startRound(this.round + 1);
  }

  private startRound(round: number): void {
    this.round = round;
    this.timeRemaining = Math.max(
      ROUND_TIME_MIN_SECONDS,
      ROUND_TIME_START_SECONDS - (round - 1) * ROUND_TIME_DECAY_PER_ROUND,
    );
    this.matchThreshold = Math.min(
      MATCH_THRESHOLD_MAX,
      MATCH_THRESHOLD_START + (round - 1) * MATCH_THRESHOLD_GROWTH_PER_ROUND,
    );
    this.holdDuration = Math.min(
      HOLD_DURATION_MAX_SECONDS,
      HOLD_DURATION_START_SECONDS + (round - 1) * HOLD_DURATION_GROWTH_PER_ROUND,
    );
    this.holdProgress = 0;
    this.matchQuality = 0;

    const target = this.generateTargetRotation();
    this.targetYaw = target.yaw;
    this.targetPitch = target.pitch;
    // お題と正反対寄りの姿勢から始めることで、毎ラウンド必ず回転させる必要が生まれる。
    this.yaw = wrapAngle(this.targetYaw + Math.PI);
    this.pitch = 0;
  }

  private generateTargetRotation(): Rotation {
    const yaw = (this.randomFn() * 2 - 1) * Math.PI;
    const pitch = (this.randomFn() * 2 - 1) * TARGET_PITCH_RANGE_RADIANS;
    return { yaw, pitch };
  }
}
