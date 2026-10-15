export type ObstacleKind = "rock" | "log";

export interface Obstacle {
  id: number;
  kind: ObstacleKind;
  x: number;
  y: number;
  radius: number;
  /** log専用の左右ドリフト方向。rockは常に0。 */
  driftDir: number;
}

export interface Pearl {
  id: number;
  x: number;
  y: number;
  radius: number;
}

export interface KoiState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
}

export interface ObstacleHitEvent {
  x: number;
  y: number;
  kind: ObstacleKind;
}

export interface PearlCollectedEvent {
  x: number;
  y: number;
  points: number;
  combo: number;
}

const OBSTACLE_COUNT = 6;
const PEARL_COUNT = 4;

const KOI_RADIUS_FRAC = 0.032;
const OBSTACLE_RADIUS_MIN_FRAC = 0.03;
const OBSTACLE_RADIUS_MAX_FRAC = 0.055;
const PEARL_RADIUS_FRAC = 0.02;

const THRUST_ACCEL_FRAC = 2.0;
const DRAG_PER_SECOND = 2.4;
const MAX_SPEED_FRAC = 0.9;

const LOG_DRIFT_SPEED_FRAC = 0.16;

const CURRENT_SPEED_BASE_FRAC = 0.14;
export const CURRENT_SPEED_MAX_FRAC = 0.38;
const CURRENT_SPEED_RAMP_PER_SEC_FRAC = 0.0026;

export const STAMINA_MAX = 100;
const STAMINA_PASSIVE_DRAIN_PER_SEC = 3.2;
export const STAMINA_HIT_PENALTY = 26;
const STAMINA_PEARL_GAIN = 14;
const HIT_INVULNERABLE_SECONDS = 0.7;

const PEARL_BASE_SCORE = 20;
const PEARL_COMBO_BONUS = 8;

/** currentSpeed(0-1に正規化)に掛けて score 用の距離(m相当)に変換する係数。 */
const DISTANCE_SCALE = 22;

let nextId = 1;

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randSign(): number {
  return Math.random() < 0.5 ? -1 : 1;
}

/**
 * 滝を遡る鯉のワールド。プレイヤーは全方向へ自由に動ける鯉を操り、
 * 上から流れてくる岩・流木を避けながら真珠を集め続ける。
 * 流速(currentSpeed)は時間経過で徐々に上がり、それに応じて体力の消費も速くなるため、
 * 何もしなくてもいずれ体力は尽きる(=押し流される)。
 */
export class KoiClimbWorld {
  width = 0;
  height = 0;

  koiRadius = 0;
  obstacleRadiusMin = 0;
  obstacleRadiusMax = 0;
  pearlRadius = 0;

  thrustAccel = 0;
  maxSpeed = 0;
  logDriftSpeed = 0;

  koi: KoiState = { x: 0, y: 0, vx: 0, vy: 0, angle: -Math.PI / 2 };
  obstacles: Obstacle[] = [];
  pearls: Pearl[] = [];

  thrust = { x: 0, y: 0 };

  elapsed = 0;
  distanceClimbed = 0;
  score = 0;
  stamina = STAMINA_MAX;
  combo = 0;
  pearlsCollected = 0;
  isOver = false;

  currentSpeed = 0;
  private pearlPointsAccum = 0;
  private invulnerableTimer = 0;

  onPearlCollected: ((event: PearlCollectedEvent) => void) | null = null;
  onObstacleHit: ((event: ObstacleHitEvent) => void) | null = null;
  onSweptAway: (() => void) | null = null;

  constructor(width: number, height: number) {
    this.resize(width, height);
    this.reset();
  }

  reset(): void {
    this.elapsed = 0;
    this.distanceClimbed = 0;
    this.score = 0;
    this.stamina = STAMINA_MAX;
    this.combo = 0;
    this.pearlsCollected = 0;
    this.isOver = false;
    this.currentSpeed = this.height * CURRENT_SPEED_BASE_FRAC;
    this.pearlPointsAccum = 0;
    this.invulnerableTimer = 0;
    this.thrust = { x: 0, y: 0 };

    this.koi = { x: this.width / 2, y: this.height * 0.82, vx: 0, vy: 0, angle: -Math.PI / 2 };

    this.obstacles = [];
    for (let i = 0; i < OBSTACLE_COUNT; i++) {
      this.obstacles.push(this.spawnObstacle(-randRange(0, this.height)));
    }

    this.pearls = [];
    for (let i = 0; i < PEARL_COUNT; i++) {
      this.pearls.push(this.spawnPearl(-randRange(0, this.height)));
    }
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const scaleX = this.width > 0 ? width / this.width : 1;
    const scaleY = this.height > 0 ? height / this.height : 1;

    if (this.width > 0 && this.height > 0) {
      this.koi.x *= scaleX;
      this.koi.y *= scaleY;
      for (const obstacle of this.obstacles) {
        obstacle.x *= scaleX;
        obstacle.y *= scaleY;
      }
      for (const pearl of this.pearls) {
        pearl.x *= scaleX;
        pearl.y *= scaleY;
      }
    }

    this.width = width;
    this.height = height;

    this.koiRadius = width * KOI_RADIUS_FRAC;
    this.obstacleRadiusMin = width * OBSTACLE_RADIUS_MIN_FRAC;
    this.obstacleRadiusMax = width * OBSTACLE_RADIUS_MAX_FRAC;
    this.pearlRadius = width * PEARL_RADIUS_FRAC;

    this.thrustAccel = width * THRUST_ACCEL_FRAC;
    this.maxSpeed = width * MAX_SPEED_FRAC;
    this.logDriftSpeed = width * LOG_DRIFT_SPEED_FRAC;
  }

  /** ステージ座標の一点へ向かって推進する。ポインタ操作向け。 */
  setThrustTowardStagePoint(x: number, y: number): void {
    const dx = x - this.koi.x;
    const dy = y - this.koi.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) {
      this.thrust = { x: 0, y: 0 };
      return;
    }
    this.thrust = { x: dx / dist, y: dy / dist };
  }

  /** 方向ベクトル（正規化不要）で推進する。キーボード操作向け。 */
  setThrust(dx: number, dy: number): void {
    this.thrust = { x: dx, y: dy };
  }

  private spawnObstacle(y: number, keepId?: number): Obstacle {
    const kind: ObstacleKind = Math.random() < 0.5 ? "rock" : "log";
    const radius = randRange(this.obstacleRadiusMin, this.obstacleRadiusMax);
    const margin = radius * 1.2;
    const span = Math.max(0, this.width - margin * 2);
    return {
      id: keepId ?? nextId++,
      kind,
      x: margin + Math.random() * span,
      y,
      radius,
      driftDir: kind === "log" ? randSign() : 0,
    };
  }

  private spawnPearl(y: number, keepId?: number): Pearl {
    const radius = this.pearlRadius;
    const margin = radius * 1.5;
    const span = Math.max(0, this.width - margin * 2);
    return {
      id: keepId ?? nextId++,
      x: margin + Math.random() * span,
      y,
      radius,
    };
  }

  private respawnObstacleAbove(obstacle: Obstacle): void {
    const next = this.spawnObstacle(
      -randRange(obstacle.radius, this.height * 0.4 + 1),
      obstacle.id,
    );
    obstacle.kind = next.kind;
    obstacle.x = next.x;
    obstacle.y = next.y;
    obstacle.radius = next.radius;
    obstacle.driftDir = next.driftDir;
  }

  private respawnPearlAbove(pearl: Pearl): void {
    const next = this.spawnPearl(-randRange(pearl.radius, this.height * 0.4 + 1), pearl.id);
    pearl.x = next.x;
    pearl.y = next.y;
  }

  private updateKoi(deltaSeconds: number): void {
    const thrustLen = Math.hypot(this.thrust.x, this.thrust.y);
    if (thrustLen > 0.001) {
      const ux = this.thrust.x / thrustLen;
      const uy = this.thrust.y / thrustLen;
      this.koi.vx += ux * this.thrustAccel * deltaSeconds;
      this.koi.vy += uy * this.thrustAccel * deltaSeconds;
      this.koi.angle = Math.atan2(uy, ux);
    }

    const dragFactor = Math.max(0, 1 - DRAG_PER_SECOND * deltaSeconds);
    this.koi.vx *= dragFactor;
    this.koi.vy *= dragFactor;

    const speed = Math.hypot(this.koi.vx, this.koi.vy);
    if (speed > this.maxSpeed && speed > 0) {
      const s = this.maxSpeed / speed;
      this.koi.vx *= s;
      this.koi.vy *= s;
    }

    let nx = this.koi.x + this.koi.vx * deltaSeconds;
    let ny = this.koi.y + this.koi.vy * deltaSeconds;

    if (nx < this.koiRadius) {
      nx = this.koiRadius;
      this.koi.vx = Math.max(0, this.koi.vx);
    } else if (nx > this.width - this.koiRadius) {
      nx = this.width - this.koiRadius;
      this.koi.vx = Math.min(0, this.koi.vx);
    }
    if (ny < this.koiRadius) {
      ny = this.koiRadius;
      this.koi.vy = Math.max(0, this.koi.vy);
    } else if (ny > this.height - this.koiRadius) {
      ny = this.height - this.koiRadius;
      this.koi.vy = Math.min(0, this.koi.vy);
    }

    this.koi.x = nx;
    this.koi.y = ny;
  }

  private updateObstacles(deltaSeconds: number): void {
    if (this.invulnerableTimer > 0) {
      this.invulnerableTimer = Math.max(0, this.invulnerableTimer - deltaSeconds);
    }

    for (const obstacle of this.obstacles) {
      obstacle.y += this.currentSpeed * deltaSeconds;

      if (obstacle.kind === "log") {
        obstacle.x += obstacle.driftDir * this.logDriftSpeed * deltaSeconds;
        const margin = obstacle.radius;
        if (obstacle.x < margin) {
          obstacle.x = margin;
          obstacle.driftDir = 1;
        } else if (obstacle.x > this.width - margin) {
          obstacle.x = this.width - margin;
          obstacle.driftDir = -1;
        }
      }

      if (obstacle.y - obstacle.radius > this.height) {
        this.respawnObstacleAbove(obstacle);
        continue;
      }

      if (this.invulnerableTimer <= 0) {
        const dist = Math.hypot(obstacle.x - this.koi.x, obstacle.y - this.koi.y);
        if (dist < obstacle.radius + this.koiRadius) {
          this.stamina = Math.max(0, this.stamina - STAMINA_HIT_PENALTY);
          this.combo = 0;
          this.invulnerableTimer = HIT_INVULNERABLE_SECONDS;
          this.onObstacleHit?.({ x: obstacle.x, y: obstacle.y, kind: obstacle.kind });
          this.respawnObstacleAbove(obstacle);
        }
      }
    }
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    this.elapsed += deltaSeconds;
    this.currentSpeed = Math.min(
      this.height * CURRENT_SPEED_MAX_FRAC,
      this.height * CURRENT_SPEED_BASE_FRAC +
        this.elapsed * this.height * CURRENT_SPEED_RAMP_PER_SEC_FRAC,
    );

    const speedFrac = this.currentSpeed / this.height;
    this.distanceClimbed += speedFrac * DISTANCE_SCALE * deltaSeconds;

    const drainMultiplier = this.currentSpeed / (this.height * CURRENT_SPEED_BASE_FRAC);
    this.stamina = Math.max(
      0,
      this.stamina - STAMINA_PASSIVE_DRAIN_PER_SEC * drainMultiplier * deltaSeconds,
    );

    this.updateKoi(deltaSeconds);
    this.updateObstacles(deltaSeconds);
    this.updatePearls(deltaSeconds);

    this.score = Math.floor(this.distanceClimbed) + this.pearlPointsAccum;

    if (this.stamina <= 0) {
      this.isOver = true;
      this.onSweptAway?.();
    }
  }

  private updatePearls(deltaSeconds: number): void {
    for (const pearl of this.pearls) {
      pearl.y += this.currentSpeed * deltaSeconds;

      if (pearl.y - pearl.radius > this.height) {
        this.respawnPearlAbove(pearl);
        continue;
      }

      const dist = Math.hypot(pearl.x - this.koi.x, pearl.y - this.koi.y);
      if (dist < pearl.radius + this.koiRadius) {
        this.combo += 1;
        this.pearlsCollected += 1;
        this.stamina = Math.min(STAMINA_MAX, this.stamina + STAMINA_PEARL_GAIN);
        const points = PEARL_BASE_SCORE + (this.combo - 1) * PEARL_COMBO_BONUS;
        this.pearlPointsAccum += points;
        this.onPearlCollected?.({ x: pearl.x, y: pearl.y, points, combo: this.combo });
        this.respawnPearlAbove(pearl);
      }
    }
  }
}
