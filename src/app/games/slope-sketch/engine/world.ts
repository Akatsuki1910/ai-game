export interface Hazard {
  bucket: number;
  fromFrac: number;
  toFrac: number;
}

export interface Gem {
  bucket: number;
  heightFrac: number;
  isCollected: boolean;
}

interface BallState {
  yFrac: number;
  velocityYFrac: number;
  isGrounded: boolean;
}

export const VISIBLE_BUCKETS = 32;
export const BALL_SCREEN_BUCKET_OFFSET = VISIBLE_BUCKETS * 0.3;
export const BALL_SCREEN_X_RATIO = BALL_SCREEN_BUCKET_OFFSET / VISIBLE_BUCKETS;
export const CHALK_MAX = 100;

const GROUND_DEFAULT_FRAC = 0.62;
const SAFE_ZONE_END_BUCKET = 26;

const BASE_SCROLL_SPEED = 3; // buckets/秒
const SCROLL_SPEED_RAMP = 0.05; // buckets/秒 を秒ごとに加速
const MAX_SCROLL_SPEED = 8;

const GRAVITY_FRAC_PER_SEC2 = 2.2;
const DEATH_Y_FRAC = 1.05;

const PAINT_COST_PER_BUCKET = 6;
const CHALK_REGEN_PER_SECOND = 10;

const DISTANCE_SCORE_PER_BUCKET = 10;
const GEM_POINTS = 50;
const GEM_HEIGHT_TOLERANCE = 0.1;

const MIN_FEATURE_GAP = 6;
const MAX_FEATURE_GAP = 10;
const SPAWN_LOOKAHEAD_EXTRA = 4;
const GEM_SPAWN_PROBABILITY = 0.65;
const HAZARD_BAND_HEIGHT = 0.18;

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * スコアにつながるピクセル座標変換（描画層が使う純粋関数）。
 * バケット単位の世界座標とスクロール量から、現在の画面幅でのX座標を返す。
 */
export function bucketToScreenX(world: SlopeSketchWorld, bucket: number): number {
  const bucketWidth = world.width / VISIBLE_BUCKETS;
  return (bucket - world.scrollBuckets) * bucketWidth;
}

export class SlopeSketchWorld {
  width = 0;
  height = 0;
  scrollBuckets = 0;
  score = 0;
  chalkRemaining = CHALK_MAX;
  isOver = false;
  ball: BallState = { yFrac: GROUND_DEFAULT_FRAC, velocityYFrac: 0, isGrounded: true };
  hazards: Hazard[] = [];
  gems: Gem[] = [];

  private elapsedSeconds = 0;
  private terrain = new Map<number, number>();
  private nextFeatureBucket = 0;
  private lastPaintBucket: number | null = null;
  private lastPaintHeightFrac: number | null = null;

  constructor(width: number, height: number) {
    this.resize(width, height);
    this.reset();
  }

  reset(): void {
    this.scrollBuckets = 0;
    this.elapsedSeconds = 0;
    this.score = 0;
    this.chalkRemaining = CHALK_MAX;
    this.isOver = false;
    this.ball = { yFrac: GROUND_DEFAULT_FRAC, velocityYFrac: 0, isGrounded: true };
    this.hazards = [];
    this.gems = [];
    this.terrain = new Map();
    for (let bucket = -4; bucket <= SAFE_ZONE_END_BUCKET; bucket++) {
      this.terrain.set(bucket, GROUND_DEFAULT_FRAC);
    }
    this.nextFeatureBucket = SAFE_ZONE_END_BUCKET + randRange(MIN_FEATURE_GAP, MAX_FEATURE_GAP);
    this.lastPaintBucket = null;
    this.lastPaintHeightFrac = null;
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.width = width;
    this.height = height;
  }

  get ballBucket(): number {
    return Math.floor(this.scrollBuckets + BALL_SCREEN_BUCKET_OFFSET);
  }

  get scrollSpeed(): number {
    return Math.min(MAX_SCROLL_SPEED, BASE_SCROLL_SPEED + this.elapsedSeconds * SCROLL_SPEED_RAMP);
  }

  getTerrainHeightAt(bucket: number): number | null {
    return this.terrain.get(bucket) ?? null;
  }

  /** 画面上のポインタ位置（ピクセル）にチョークで地面を描く。ストローク中は毎フレーム呼ぶ。 */
  paint(screenX: number, screenY: number): void {
    if (this.isOver || this.width <= 0 || this.height <= 0) return;

    const bucketWidth = this.width / VISIBLE_BUCKETS;
    const bucket = Math.floor(this.scrollBuckets + screenX / bucketWidth);
    const heightFrac = Math.min(1, Math.max(0, screenY / this.height));

    if (this.lastPaintBucket === null || bucket === this.lastPaintBucket) {
      this.paintBucketIfAffordable(bucket, heightFrac);
    } else {
      const startBucket = this.lastPaintBucket;
      const startHeight = this.lastPaintHeightFrac ?? heightFrac;
      const direction = bucket > startBucket ? 1 : -1;
      const totalSteps = Math.abs(bucket - startBucket);
      for (let step = 1; step <= totalSteps; step++) {
        const targetBucket = startBucket + step * direction;
        const t = step / totalSteps;
        const targetHeight = startHeight + (heightFrac - startHeight) * t;
        if (!this.paintBucketIfAffordable(targetBucket, targetHeight)) break;
      }
    }

    this.lastPaintBucket = bucket;
    this.lastPaintHeightFrac = heightFrac;
  }

  /** ポインタを離した時に呼ぶ。次のストロークが前回の続きとして補間されないようにする。 */
  endStroke(): void {
    this.lastPaintBucket = null;
    this.lastPaintHeightFrac = null;
  }

  private paintBucketIfAffordable(bucket: number, heightFrac: number): boolean {
    if (this.chalkRemaining <= 0) return false;
    this.terrain.set(bucket, heightFrac);
    this.chalkRemaining = Math.max(0, this.chalkRemaining - PAINT_COST_PER_BUCKET);
    return true;
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    this.elapsedSeconds += deltaSeconds;
    this.chalkRemaining = Math.min(
      CHALK_MAX,
      this.chalkRemaining + CHALK_REGEN_PER_SECOND * deltaSeconds,
    );

    const speed = this.scrollSpeed;
    this.scrollBuckets += speed * deltaSeconds;
    this.score += speed * deltaSeconds * DISTANCE_SCORE_PER_BUCKET;

    this.spawnUpcomingFeatures();

    const bucket = this.ballBucket;
    const groundHeight = this.getTerrainHeightAt(bucket);

    if (groundHeight !== null && this.ball.yFrac >= groundHeight) {
      this.ball.yFrac = groundHeight;
      this.ball.velocityYFrac = 0;
      this.ball.isGrounded = true;
    } else {
      this.ball.isGrounded = false;
      this.ball.velocityYFrac += GRAVITY_FRAC_PER_SEC2 * deltaSeconds;
      this.ball.yFrac += this.ball.velocityYFrac * deltaSeconds;
      if (groundHeight !== null && this.ball.yFrac >= groundHeight) {
        this.ball.yFrac = groundHeight;
        this.ball.velocityYFrac = 0;
        this.ball.isGrounded = true;
      }
    }

    for (const hazard of this.hazards) {
      if (
        hazard.bucket === bucket &&
        this.ball.yFrac >= hazard.fromFrac &&
        this.ball.yFrac <= hazard.toFrac
      ) {
        this.isOver = true;
        return;
      }
    }

    for (const gem of this.gems) {
      if (
        !gem.isCollected &&
        gem.bucket === bucket &&
        Math.abs(this.ball.yFrac - gem.heightFrac) <= GEM_HEIGHT_TOLERANCE
      ) {
        gem.isCollected = true;
        this.score += GEM_POINTS;
      }
    }

    if (this.ball.yFrac > DEATH_Y_FRAC) {
      this.isOver = true;
    }
  }

  private spawnUpcomingFeatures(): void {
    const lookaheadBucket = this.scrollBuckets + VISIBLE_BUCKETS + SPAWN_LOOKAHEAD_EXTRA;
    while (this.nextFeatureBucket < lookaheadBucket) {
      const bucket = Math.round(this.nextFeatureBucket);
      if (Math.random() < GEM_SPAWN_PROBABILITY) {
        this.gems.push({ bucket, heightFrac: randRange(0.25, 0.75), isCollected: false });
      } else {
        const fromFrac = randRange(0.3, 0.6);
        this.hazards.push({
          bucket,
          fromFrac,
          toFrac: Math.min(0.95, fromFrac + HAZARD_BAND_HEIGHT),
        });
      }
      this.nextFeatureBucket += randRange(MIN_FEATURE_GAP, MAX_FEATURE_GAP);
    }
  }
}
