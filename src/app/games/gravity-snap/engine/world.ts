export const DIRECTION_VECTORS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
} as const;

export type Direction = keyof typeof DIRECTION_VECTORS;

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

export interface Orb {
  x: number;
  y: number;
  radius: number;
}

export interface Hazard {
  id: number;
  x: number;
  y: number;
  radius: number;
}

export interface OrbCollectedEvent {
  x: number;
  y: number;
  score: number;
}

const BALL_RADIUS = 16;
const ORB_RADIUS = 13;
const HAZARD_RADIUS = 20;
const BASE_ACCEL = 900; // px/s^2
const ACCEL_RAMP_PER_SECOND = 10; // px/s^2、生存秒数ごとに加算
const MAX_ACCEL_BONUS = 600;
const FRICTION_PER_SECOND = 1.6; // 速度の指数減衰レート
const WALL_RESTITUTION = 0.32;
const INVINCIBILITY_SECONDS = 0.8;
export const START_LIVES = 3;
const ORBS_PER_HAZARD = 3;
const MAX_HAZARDS = 6;
const MIN_ORB_DISTANCE_RATIO = 0.28; // min(width,height) に対する比率
const EDGE_SPAWN_MARGIN_RATIO = 0.08;

let nextHazardId = 1;

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

interface AvoidPoint {
  x: number;
  y: number;
  minDistance: number;
}

/**
 * ボールは常に4方向のいずれかの壁へ引かれ続けるため、的・ハザードは
 * 盤面の「壁際」にだけ出現させる（内部の浮島には出現しない）。
 * これにより「四辺を順になぞる」決定的な操作だけで、出現位置を見なくても
 * 必ずどの的・ハザードにも到達できる（ストーリーテストでの検証を参照）。
 */
function randomEdgePoint(radius: number, width: number, height: number): { x: number; y: number } {
  const marginX = Math.max(radius, width * EDGE_SPAWN_MARGIN_RATIO + radius);
  const marginY = Math.max(radius, height * EDGE_SPAWN_MARGIN_RATIO + radius);
  const edge = Math.floor(Math.random() * 4);
  switch (edge) {
    case 0: // up wall
      return { x: randRange(marginX, Math.max(marginX, width - marginX)), y: radius };
    case 1: // down wall
      return { x: randRange(marginX, Math.max(marginX, width - marginX)), y: height - radius };
    case 2: // left wall
      return { x: radius, y: randRange(marginY, Math.max(marginY, height - marginY)) };
    default: // right wall
      return { x: width - radius, y: randRange(marginY, Math.max(marginY, height - marginY)) };
  }
}

function spawnOnEdgeAvoiding(
  radius: number,
  width: number,
  height: number,
  avoid: readonly AvoidPoint[],
): { x: number; y: number } {
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = randomEdgePoint(radius, width, height);
    const isFarEnough = avoid.every(
      (point) => Math.hypot(candidate.x - point.x, candidate.y - point.y) >= point.minDistance,
    );
    if (isFarEnough) return candidate;
  }
  return randomEdgePoint(radius, width, height);
}

/**
 * 盤面中心からの相対位置がどの方向寄りかを4分割（対角線区切り）で判定する。
 * タップ/クリックした場所から「その方向へ重力を切り替える」操作に使う。
 */
export function directionFromPoint(
  x: number,
  y: number,
  centerX: number,
  centerY: number,
): Direction {
  const dx = x - centerX;
  const dy = y - centerY;
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? "right" : "left";
  }
  return dy > 0 ? "down" : "up";
}

/**
 * 重力スナップ（Gravity Snap）の盤面ロジック。
 * 4方向のいずれかに常時引かれるボールを、方向の切替だけで操って的を追い続ける。
 */
export class GravitySnapWorld {
  width = 0;
  height = 0;
  ball: Ball = { x: 0, y: 0, vx: 0, vy: 0, radius: BALL_RADIUS };
  direction: Direction = "down";
  orb: Orb = { x: 0, y: 0, radius: ORB_RADIUS };
  hazards: Hazard[] = [];
  score = 0;
  lives = START_LIVES;
  isOver = false;
  elapsedSeconds = 0;
  invincibleRemaining = 0;

  onOrbCollected: ((event: OrbCollectedEvent) => void) | null = null;
  onHazardHit: (() => void) | null = null;

  constructor(width: number, height: number) {
    this.resize(width, height);
    this.reset();
  }

  reset(): void {
    this.score = 0;
    this.lives = START_LIVES;
    this.isOver = false;
    this.elapsedSeconds = 0;
    this.invincibleRemaining = 0;
    this.direction = "down";
    this.ball = { x: this.width / 2, y: this.height / 2, vx: 0, vy: 0, radius: BALL_RADIUS };
    this.hazards = [];
    this.orb = this.spawnOrbPosition();
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;

    // コンポーネント初回マウント時は `new GravitySnapWorld(1, 1)` のような
    // 仮サイズで組み立てられ、直後に実サイズへ resize() される。この仮サイズは
    // 的・ハザードの絶対座素(壁際からの半径オフセット)を求めるには小さすぎ、
    // そこから実サイズへ比率で引き伸ばすと画面外へ飛んでしまう。
    // 実サイズと呼べないほど小さい状態からの遷移は、引き伸ばさずに作り直す。
    const hadRealSize = this.width > BALL_RADIUS * 2 && this.height > BALL_RADIUS * 2;
    if (!hadRealSize) {
      this.width = width;
      this.height = height;
      this.ball.x = this.width / 2;
      this.ball.y = this.height / 2;
      this.orb = this.spawnOrbPosition();
      return;
    }

    const scaleX = width / this.width;
    const scaleY = height / this.height;
    this.ball.x *= scaleX;
    this.ball.y *= scaleY;
    this.orb.x *= scaleX;
    this.orb.y *= scaleY;
    for (const hazard of this.hazards) {
      hazard.x *= scaleX;
      hazard.y *= scaleY;
    }
    this.width = width;
    this.height = height;
    this.clampBallToBounds();
  }

  setDirection(direction: Direction): void {
    this.direction = direction;
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    this.elapsedSeconds += deltaSeconds;
    this.invincibleRemaining = Math.max(0, this.invincibleRemaining - deltaSeconds);

    const accel = this.currentAccel();
    const gravity = DIRECTION_VECTORS[this.direction];
    this.ball.vx += gravity.x * accel * deltaSeconds;
    this.ball.vy += gravity.y * accel * deltaSeconds;

    const damping = Math.exp(-FRICTION_PER_SECOND * deltaSeconds);
    this.ball.vx *= damping;
    this.ball.vy *= damping;

    this.ball.x += this.ball.vx * deltaSeconds;
    this.ball.y += this.ball.vy * deltaSeconds;

    this.resolveWallCollisions();
    this.resolveOrbCollection();
    this.resolveHazardCollisions();
  }

  private currentAccel(): number {
    const bonus = Math.min(MAX_ACCEL_BONUS, this.elapsedSeconds * ACCEL_RAMP_PER_SECOND);
    return BASE_ACCEL + bonus;
  }

  private clampBallToBounds(): void {
    this.ball.x = Math.min(Math.max(this.ball.x, this.ball.radius), this.width - this.ball.radius);
    this.ball.y = Math.min(Math.max(this.ball.y, this.ball.radius), this.height - this.ball.radius);
  }

  private resolveWallCollisions(): void {
    if (this.ball.x < this.ball.radius) {
      this.ball.x = this.ball.radius;
      this.ball.vx = Math.abs(this.ball.vx) * WALL_RESTITUTION;
    } else if (this.ball.x > this.width - this.ball.radius) {
      this.ball.x = this.width - this.ball.radius;
      this.ball.vx = -Math.abs(this.ball.vx) * WALL_RESTITUTION;
    }

    if (this.ball.y < this.ball.radius) {
      this.ball.y = this.ball.radius;
      this.ball.vy = Math.abs(this.ball.vy) * WALL_RESTITUTION;
    } else if (this.ball.y > this.height - this.ball.radius) {
      this.ball.y = this.height - this.ball.radius;
      this.ball.vy = -Math.abs(this.ball.vy) * WALL_RESTITUTION;
    }
  }

  private resolveOrbCollection(): void {
    const distance = Math.hypot(this.ball.x - this.orb.x, this.ball.y - this.orb.y);
    if (distance > this.ball.radius + this.orb.radius) return;

    this.score += 1;
    this.onOrbCollected?.({ x: this.orb.x, y: this.orb.y, score: this.score });
    this.orb = this.spawnOrbPosition();
    if (this.score % ORBS_PER_HAZARD === 0 && this.hazards.length < MAX_HAZARDS) {
      this.hazards.push(this.spawnHazardPosition());
    }
  }

  private resolveHazardCollisions(): void {
    if (this.invincibleRemaining > 0) return;

    for (const hazard of this.hazards) {
      const distance = Math.hypot(this.ball.x - hazard.x, this.ball.y - hazard.y);
      if (distance > this.ball.radius + hazard.radius) continue;

      this.lives -= 1;
      this.invincibleRemaining = INVINCIBILITY_SECONDS;
      this.ball.vx *= -0.6;
      this.ball.vy *= -0.6;
      this.onHazardHit?.();
      if (this.lives <= 0) {
        this.lives = 0;
        this.isOver = true;
      }
      break;
    }
  }

  private spawnOrbPosition(): Orb {
    const minDistance = Math.min(this.width, this.height) * MIN_ORB_DISTANCE_RATIO;
    const point = spawnOnEdgeAvoiding(ORB_RADIUS, this.width, this.height, [
      { x: this.ball.x, y: this.ball.y, minDistance },
    ]);
    return { x: point.x, y: point.y, radius: ORB_RADIUS };
  }

  private spawnHazardPosition(): Hazard {
    const point = spawnOnEdgeAvoiding(HAZARD_RADIUS, this.width, this.height, [
      { x: this.ball.x, y: this.ball.y, minDistance: HAZARD_RADIUS * 4 },
      { x: this.orb.x, y: this.orb.y, minDistance: HAZARD_RADIUS * 3 },
      ...this.hazards.map((hazard) => ({
        x: hazard.x,
        y: hazard.y,
        minDistance: HAZARD_RADIUS * 3,
      })),
    ]);
    return { id: nextHazardId++, x: point.x, y: point.y, radius: HAZARD_RADIUS };
  }
}
