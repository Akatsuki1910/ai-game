export interface Paddle {
  x: number;
  y: number;
  radius: number;
}

export interface Shuttle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

export interface HitEvent {
  rally: number;
  isNewBest: boolean;
}

export interface MissEvent {
  livesRemaining: number;
}

const GRAVITY = 560; // px/s^2
const MAX_FALL_SPEED = 520; // px/s。羽根の抗力で落下速度に上限を設ける。
const MAX_DRIFT_SPEED = 420; // px/s
const SHUTTLE_RADIUS = 13;
const PADDLE_RADIUS = 46;
export const START_LIVES = 3;
const BASE_BOUNCE_SPEED = 300; // px/s。静止したパドルでも最低限打ち返せる速さ。
const MAX_BOUNCE_BONUS = 320; // px/s。パドルを振る速さで最大これだけ上乗せされる。
const PADDLE_POWER_FACTOR = 0.9;
const SPIN_CARRY = 0.3; // 打ち返し後に残す元の横速度の割合。
const SPIN_FACTOR = 0.45; // パドルの横振りが羽根に伝わる割合。
const WALL_RESTITUTION = 0.6;
const WIND_FREQUENCY = 0.9; // rad/s
const WIND_BASE = 6; // px/s^2。ラリー0でもわずかに揺れる風。
const WIND_PER_RALLY = 5; // px/s^2。ラリーが伸びるほど風が強まる。
const WIND_MAX = 140; // px/s^2
const MAX_PADDLE_TRACK_SPEED = 2600; // px/s。瞬間移動（リサイズ等）を打撃力に換算しない上限。

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export class HaneRallyWorld {
  width = 0;
  height = 0;
  paddle: Paddle;
  shuttle: Shuttle;
  score = 0;
  rally = 0;
  bestRally = 0;
  lives = START_LIVES;
  isOver = false;
  elapsedSeconds = 0;

  onHit: ((event: HitEvent) => void) | null = null;
  onMiss: ((event: MissEvent) => void) | null = null;

  private previousPaddleX = 0;
  private previousPaddleY = 0;

  constructor(width: number, height: number) {
    this.paddle = { x: 0, y: 0, radius: PADDLE_RADIUS };
    this.shuttle = { x: 0, y: 0, vx: 0, vy: 0, radius: SHUTTLE_RADIUS };
    this.resize(width, height);
    this.reset();
  }

  reset(): void {
    this.score = 0;
    this.rally = 0;
    this.bestRally = 0;
    this.lives = START_LIVES;
    this.isOver = false;
    this.elapsedSeconds = 0;
    this.paddle = { x: this.width / 2, y: this.height * 0.82, radius: PADDLE_RADIUS };
    this.previousPaddleX = this.paddle.x;
    this.previousPaddleY = this.paddle.y;
    this.shuttle = this.spawnShuttle();
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const scaleX = this.width > 0 ? width / this.width : 1;
    const scaleY = this.height > 0 ? height / this.height : 1;
    if (this.width > 0 && this.height > 0) {
      this.paddle.x *= scaleX;
      this.paddle.y *= scaleY;
      this.shuttle.x *= scaleX;
      this.shuttle.y *= scaleY;
    }
    this.width = width;
    this.height = height;
    this.paddle.x = clamp(this.paddle.x, this.paddle.radius, this.width - this.paddle.radius);
    this.paddle.y = clamp(this.paddle.y, this.paddle.radius, this.height - this.paddle.radius);
  }

  setPaddlePosition(x: number, y: number): void {
    this.paddle.x = clamp(x, this.paddle.radius, this.width - this.paddle.radius);
    this.paddle.y = clamp(y, this.paddle.radius, this.height - this.paddle.radius);
  }

  movePaddleBy(dx: number, dy: number): void {
    this.setPaddlePosition(this.paddle.x + dx, this.paddle.y + dy);
  }

  /** ラリー数から決まる現在の風の強さ(振幅)。HUDの風表示と内部物理の両方から参照する。 */
  get windAmplitude(): number {
    return Math.min(WIND_MAX, WIND_BASE + this.rally * WIND_PER_RALLY);
  }

  private spawnShuttle(): Shuttle {
    return {
      x: this.width / 2,
      y: this.height * 0.12,
      vx: 0,
      vy: 0,
      radius: SHUTTLE_RADIUS,
    };
  }

  private windForceAt(elapsedSeconds: number): number {
    return Math.sin(elapsedSeconds * WIND_FREQUENCY) * this.windAmplitude;
  }

  step(deltaSeconds: number): void {
    if (this.isOver || deltaSeconds <= 0) return;
    this.elapsedSeconds += deltaSeconds;

    const paddleVx = clamp(
      (this.paddle.x - this.previousPaddleX) / deltaSeconds,
      -MAX_PADDLE_TRACK_SPEED,
      MAX_PADDLE_TRACK_SPEED,
    );
    const paddleVy = clamp(
      (this.paddle.y - this.previousPaddleY) / deltaSeconds,
      -MAX_PADDLE_TRACK_SPEED,
      MAX_PADDLE_TRACK_SPEED,
    );
    this.previousPaddleX = this.paddle.x;
    this.previousPaddleY = this.paddle.y;

    const { shuttle } = this;
    shuttle.vy = Math.min(shuttle.vy + GRAVITY * deltaSeconds, MAX_FALL_SPEED);
    shuttle.vx = clamp(
      shuttle.vx + this.windForceAt(this.elapsedSeconds) * deltaSeconds,
      -MAX_DRIFT_SPEED,
      MAX_DRIFT_SPEED,
    );
    shuttle.x += shuttle.vx * deltaSeconds;
    shuttle.y += shuttle.vy * deltaSeconds;

    if (shuttle.x < shuttle.radius) {
      shuttle.x = shuttle.radius;
      shuttle.vx = Math.abs(shuttle.vx) * WALL_RESTITUTION;
    } else if (shuttle.x > this.width - shuttle.radius) {
      shuttle.x = this.width - shuttle.radius;
      shuttle.vx = -Math.abs(shuttle.vx) * WALL_RESTITUTION;
    }

    const dist = Math.hypot(shuttle.x - this.paddle.x, shuttle.y - this.paddle.y);
    const isApproachingPaddle = shuttle.vy > paddleVy;
    if (dist <= shuttle.radius + this.paddle.radius && isApproachingPaddle) {
      this.handleHit(paddleVx, paddleVy);
      return;
    }

    if (shuttle.y - shuttle.radius > this.height) {
      this.handleMiss();
    }
  }

  private handleHit(paddleVx: number, paddleVy: number): void {
    const { shuttle, paddle } = this;
    const paddleSpeed = Math.hypot(paddleVx, paddleVy);
    const bounceSpeed =
      BASE_BOUNCE_SPEED + Math.min(paddleSpeed * PADDLE_POWER_FACTOR, MAX_BOUNCE_BONUS);

    shuttle.vy = -bounceSpeed;
    shuttle.vx = clamp(
      shuttle.vx * SPIN_CARRY + paddleVx * SPIN_FACTOR,
      -MAX_DRIFT_SPEED,
      MAX_DRIFT_SPEED,
    );
    shuttle.y = paddle.y - paddle.radius - shuttle.radius - 1;

    this.rally += 1;
    this.score += 1;
    const isNewBest = this.rally > this.bestRally;
    if (isNewBest) this.bestRally = this.rally;
    this.onHit?.({ rally: this.rally, isNewBest });
  }

  private handleMiss(): void {
    this.rally = 0;
    this.lives -= 1;
    this.onMiss?.({ livesRemaining: this.lives });
    if (this.lives <= 0) {
      this.isOver = true;
      return;
    }
    this.shuttle = this.spawnShuttle();
  }
}
