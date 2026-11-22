export type OarSide = "left" | "right";

export interface Obstacle {
  readonly id: number;
  /** ボートが進む距離(m)。この地点に達すると通過判定(衝突チェック)が行われる。 */
  readonly trackDistance: number;
  /** レーン内の左右位置。0=左端、1=右端。 */
  readonly laneX: number;
  readonly radius: number;
  resolved: boolean;
}

export type StrokeJudgement = "first" | "good" | "bad";

export interface StrokeResolvedEvent {
  side: OarSide;
  judgement: StrokeJudgement;
  combo: number;
  rhythm: number;
}

export interface CollisionEvent {
  livesRemaining: number;
}

export const MAX_LIVES = 3;
export const LANE_MIN_X = 0;
export const LANE_MAX_X = 1;

const BOAT_HALF_WIDTH = 0.045;

const BASE_SPEED = 14;
const SPEED_PER_RHYTHM = 11;

const RHYTHM_GAIN_PER_GOOD = 0.12;
const RHYTHM_LOSS_PER_BAD = 0.22;
const RHYTHM_DECAY_PER_SECOND = 0.045;

const MIN_STROKE_GAP_SECONDS = 0.12;
const BASE_MAX_GAP_SECONDS = 1.1;
const MIN_MAX_GAP_SECONDS = 0.45;
// 「許容される最大の間隔」は進んだ距離に応じてこの割合で縮む。遠くまで進むほど
// テンポを保つのが難しくなる(=難易度上昇)。
const MAX_GAP_SHRINK_PER_METER = 0.0014;

const STEER_PUSH_PER_STROKE = 0.07;

const DODGE_SCORE_BONUS = 20;

const BASE_OBSTACLE_RADIUS = 0.1;
const MAX_OBSTACLE_RADIUS = 0.15;
const OBSTACLE_RADIUS_GROWTH_PER_METER = 0.00015;

const BASE_SPAWN_GAP_METERS = 46;
const MIN_SPAWN_GAP_METERS = 24;
const SPAWN_GAP_SHRINK_PER_METER = 0.035;
// スタート直後は必ず安全地帯にする。これにより「始めてすぐ漕いだ数ストローク」は
// 障害物の乱数配置に左右されず、プレイヤーにも助走の余地を与える。
const FIRST_OBSTACLE_GRACE_METERS = 90;

const SPAWN_LOOKAHEAD_METERS = 120;
const OBSTACLE_LANE_MARGIN = 0.14;

const COLLISION_RHYTHM_PENALTY = 0.5;

let nextObstacleId = 1;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * 左右のオールを交互に押し続けて加速するリアルタイム・レガッタ(漕艇)サバイバル。
 * 「交互に押す」というルール自体は決定的だが、良し悪しの判定は押した瞬間の
 * elapsedSeconds に依存するため、単体テストでは stroke() を呼ぶ時刻を直接制御して検証する。
 * 障害物の出現位置だけが乱数なので、テストでは spawn 時の配置を外から差し替える。
 */
export class StrokeRateWorld {
  lives = MAX_LIVES;
  score = 0;
  combo = 0;
  bestCombo = 0;
  isOver = false;

  distanceTraveled = 0;
  elapsedSeconds = 0;
  rhythm = 0;
  boatX = 0.5;

  lastStrokeSide: OarSide | null = null;
  lastStrokeTime: number | null = null;

  obstacles: Obstacle[] = [];

  onStrokeResolved: ((event: StrokeResolvedEvent) => void) | null = null;
  onCollision: ((event: CollisionEvent) => void) | null = null;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.lives = MAX_LIVES;
    this.score = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.isOver = false;
    this.distanceTraveled = 0;
    this.elapsedSeconds = 0;
    this.rhythm = 0;
    this.boatX = 0.5;
    this.lastStrokeSide = null;
    this.lastStrokeTime = null;
    this.obstacles = [];
    this.fillObstaclesAhead();
  }

  get boatSpeed(): number {
    return BASE_SPEED + this.rhythm * SPEED_PER_RHYTHM;
  }

  private maxGapSecondsAt(distance: number): number {
    return Math.max(
      MIN_MAX_GAP_SECONDS,
      BASE_MAX_GAP_SECONDS - distance * MAX_GAP_SHRINK_PER_METER,
    );
  }

  private spawnGapMetersAt(distance: number): number {
    return Math.max(
      MIN_SPAWN_GAP_METERS,
      BASE_SPAWN_GAP_METERS - distance * SPAWN_GAP_SHRINK_PER_METER,
    );
  }

  private obstacleRadiusAt(distance: number): number {
    return Math.min(
      MAX_OBSTACLE_RADIUS,
      BASE_OBSTACLE_RADIUS + distance * OBSTACLE_RADIUS_GROWTH_PER_METER,
    );
  }

  private spawnObstacleAhead(afterTrackDistance: number): Obstacle {
    const gap = this.spawnGapMetersAt(afterTrackDistance) * randRange(0.75, 1.25);
    return {
      id: nextObstacleId++,
      trackDistance: afterTrackDistance + gap,
      laneX: randRange(OBSTACLE_LANE_MARGIN, 1 - OBSTACLE_LANE_MARGIN),
      radius: this.obstacleRadiusAt(afterTrackDistance),
      resolved: false,
    };
  }

  private fillObstaclesAhead(): void {
    let lastDistance =
      this.obstacles.length > 0
        ? Math.max(...this.obstacles.map((o) => o.trackDistance))
        : this.distanceTraveled + FIRST_OBSTACLE_GRACE_METERS;
    const horizon = this.distanceTraveled + SPAWN_LOOKAHEAD_METERS;
    while (lastDistance < horizon) {
      const obstacle = this.spawnObstacleAhead(lastDistance);
      this.obstacles.push(obstacle);
      lastDistance = obstacle.trackDistance;
    }
  }

  /** オールを漕ぐ。交互でないか、間隔が窓から外れると「bad」判定になる。 */
  stroke(side: OarSide): void {
    if (this.isOver) return;

    let judgement: StrokeJudgement = "first";
    if (this.lastStrokeSide !== null && this.lastStrokeTime !== null) {
      const gap = this.elapsedSeconds - this.lastStrokeTime;
      const isAlternating = side !== this.lastStrokeSide;
      const maxGap = this.maxGapSecondsAt(this.distanceTraveled);
      const isGoodTiming = gap >= MIN_STROKE_GAP_SECONDS && gap <= maxGap;
      judgement = isAlternating && isGoodTiming ? "good" : "bad";
    }

    if (judgement === "good") {
      this.combo += 1;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      this.rhythm = clamp(this.rhythm + RHYTHM_GAIN_PER_GOOD, 0, 1);
    } else if (judgement === "bad") {
      this.combo = 0;
      this.rhythm = clamp(this.rhythm - RHYTHM_LOSS_PER_BAD, 0, 1);
    }

    const steerDirection = side === "left" ? 1 : -1;
    this.boatX = clamp(this.boatX + steerDirection * STEER_PUSH_PER_STROKE, LANE_MIN_X, LANE_MAX_X);

    this.lastStrokeSide = side;
    this.lastStrokeTime = this.elapsedSeconds;

    this.onStrokeResolved?.({ side, judgement, combo: this.combo, rhythm: this.rhythm });
  }

  step(deltaSeconds: number): void {
    if (this.isOver || deltaSeconds <= 0) return;
    this.elapsedSeconds += deltaSeconds;

    this.rhythm = clamp(this.rhythm - RHYTHM_DECAY_PER_SECOND * deltaSeconds, 0, 1);
    this.distanceTraveled += this.boatSpeed * deltaSeconds;
    this.score = Math.floor(this.distanceTraveled);

    for (const obstacle of this.obstacles) {
      if (obstacle.resolved) continue;
      if (obstacle.trackDistance > this.distanceTraveled) continue;

      obstacle.resolved = true;
      const hit = Math.abs(this.boatX - obstacle.laneX) < obstacle.radius + BOAT_HALF_WIDTH;
      if (hit) {
        this.combo = 0;
        this.rhythm = clamp(this.rhythm * (1 - COLLISION_RHYTHM_PENALTY), 0, 1);
        this.lives -= 1;
        if (this.lives <= 0) {
          this.lives = 0;
          this.isOver = true;
        }
        this.onCollision?.({ livesRemaining: this.lives });
      } else {
        this.score += DODGE_SCORE_BONUS;
      }
    }

    this.obstacles = this.obstacles.filter(
      (obstacle) => !obstacle.resolved || obstacle.trackDistance > this.distanceTraveled - 5,
    );
    this.fillObstaclesAhead();
  }

  /** 描画用。障害物のボートからの残り距離(m)。負値は通過済み。 */
  distanceAhead(obstacle: Obstacle): number {
    return obstacle.trackDistance - this.distanceTraveled;
  }
}
