export interface CatchEvent {
  combo: number;
  points: number;
}

export interface MissEvent {
  livesRemaining: number;
}

const GRAVITY = 1500; // px/秒^2
const VELOCITY_DAMPING = 0.999; // 微小な空気抵抗
const CUP_RADIUS = 20;
const BALL_RADIUS = 13;
const MOUTH_OFFSET = 32; // カップの受け口はカップ中心よりこの分だけ上
const CUP_TRANSFER = 0.7; // カップの動きが紐を通じて玉の速度へ伝わる割合
const ROPE_RESTITUTION = 0.15; // 紐が張ったときに残す反発
const BASE_CATCH_RADIUS = 30;
const MIN_CATCH_RADIUS = 15;
const CATCH_RADIUS_SHRINK_PER_COMBO = 0.9;
const HOLD_SECONDS = 0.22;
const BASE_LAUNCH_SPEED = 620;
const LAUNCH_SPEED_GROWTH_PER_COMBO = 14;
const MAX_LAUNCH_SPEED = 980;
const MAX_BALL_SPEED = 1400; // カップを激しく振り回しても物理が破綻しないための上限
const LAUNCH_SIDEWAYS_JITTER = 0.5; // ラジアン
const FLOOR_MARGIN = 18;
const START_LIVES = 3;
const BASE_POINTS = 10;
const COMBO_POINTS_STEP = 4;

interface Cup {
  x: number;
  y: number;
}

interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export class KendamaWorld {
  width = 0;
  height = 0;
  cup: Cup = { x: 0, y: 0 };
  ball: Ball = { x: 0, y: 0, vx: 0, vy: 0 };
  ropeLength = 0;
  isHeld = false;
  combo = 0;
  bestCombo = 0;
  score = 0;
  lives = START_LIVES;
  isOver = false;
  catchRadius = BASE_CATCH_RADIUS;

  onCatch: ((event: CatchEvent) => void) | null = null;
  onMiss: ((event: MissEvent) => void) | null = null;

  private heldTimer = 0;
  private launchSpeed = BASE_LAUNCH_SPEED;
  private prevCupX = 0;
  private prevCupY = 0;

  constructor(width: number, height: number) {
    this.resize(width, height);
    this.reset();
  }

  reset(): void {
    this.combo = 0;
    this.bestCombo = 0;
    this.score = 0;
    this.lives = START_LIVES;
    this.isOver = false;
    this.catchRadius = BASE_CATCH_RADIUS;
    this.launchSpeed = BASE_LAUNCH_SPEED;
    this.heldTimer = 0;
    this.isHeld = false;
    this.ropeLength = this.computeRopeLength();
    this.cup = { x: this.width / 2, y: this.height * 0.72 };
    this.prevCupX = this.cup.x;
    this.prevCupY = this.cup.y;
    // 最初の一投だけは真上へ打ち上げる（何も操作しなくても手元へ戻ってくる、
    // けん玉の「もしかめ」の構えに相当する）。ブレは以降のキャッチ・ミス後の再打ち上げから加わる。
    this.launchBall(false);
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const scaleX = this.width > 0 ? width / this.width : 1;
    const scaleY = this.height > 0 ? height / this.height : 1;
    if (this.width > 0 && this.height > 0) {
      this.cup.x *= scaleX;
      this.cup.y *= scaleY;
      this.ball.x *= scaleX;
      this.ball.y *= scaleY;
      this.prevCupX *= scaleX;
      this.prevCupY *= scaleY;
    }
    this.width = width;
    this.height = height;
    this.ropeLength = this.computeRopeLength();
    this.clampCup();
  }

  private computeRopeLength(): number {
    return Math.min(260, Math.max(120, this.height * 0.32));
  }

  private clampCup(): void {
    const minY = this.height * 0.35;
    const maxY = this.height - FLOOR_MARGIN - CUP_RADIUS - 4;
    this.cup.x = Math.min(
      Math.max(this.cup.x, CUP_RADIUS),
      Math.max(CUP_RADIUS, this.width - CUP_RADIUS),
    );
    this.cup.y = Math.min(Math.max(this.cup.y, minY), Math.max(minY, maxY));
  }

  setCupPosition(x: number, y: number): void {
    this.cup.x = x;
    this.cup.y = y;
    this.clampCup();
  }

  moveCupBy(dx: number, dy: number): void {
    this.setCupPosition(this.cup.x + dx, this.cup.y + dy);
  }

  private mouthPosition(): { x: number; y: number } {
    return { x: this.cup.x, y: this.cup.y - MOUTH_OFFSET };
  }

  private launchBall(withJitter = true): void {
    const mouth = this.mouthPosition();
    const jitter = withJitter
      ? randRange(-LAUNCH_SIDEWAYS_JITTER, LAUNCH_SIDEWAYS_JITTER) * 0.3
      : 0;
    const angle = -Math.PI / 2 + jitter;
    this.ball.x = mouth.x;
    this.ball.y = mouth.y;
    this.ball.vx = Math.cos(angle) * this.launchSpeed;
    this.ball.vy = Math.sin(angle) * this.launchSpeed;
  }

  step(deltaSeconds: number): void {
    if (this.isOver || deltaSeconds <= 0) return;

    const cupVx = (this.cup.x - this.prevCupX) / deltaSeconds;
    const cupVy = (this.cup.y - this.prevCupY) / deltaSeconds;
    this.prevCupX = this.cup.x;
    this.prevCupY = this.cup.y;

    if (this.isHeld) {
      const mouth = this.mouthPosition();
      this.ball.x = mouth.x;
      this.ball.y = mouth.y;
      this.ball.vx = 0;
      this.ball.vy = 0;
      this.heldTimer -= deltaSeconds;
      if (this.heldTimer <= 0) {
        this.isHeld = false;
        this.launchBall();
      }
      return;
    }

    this.ball.vy += GRAVITY * deltaSeconds;
    this.ball.vx *= VELOCITY_DAMPING;
    this.ball.vy *= VELOCITY_DAMPING;
    this.ball.x += this.ball.vx * deltaSeconds;
    this.ball.y += this.ball.vy * deltaSeconds;

    const dx = this.ball.x - this.cup.x;
    const dy = this.ball.y - this.cup.y;
    const distance = Math.hypot(dx, dy);
    if (distance > this.ropeLength && distance > 1e-6) {
      const nx = dx / distance;
      const ny = dy / distance;
      this.ball.x = this.cup.x + nx * this.ropeLength;
      this.ball.y = this.cup.y + ny * this.ropeLength;

      const radialVelocity = this.ball.vx * nx + this.ball.vy * ny;
      if (radialVelocity > 0) {
        this.ball.vx -= radialVelocity * nx * (1 + ROPE_RESTITUTION);
        this.ball.vy -= radialVelocity * ny * (1 + ROPE_RESTITUTION);
      }
      this.ball.vx += cupVx * CUP_TRANSFER;
      this.ball.vy += cupVy * CUP_TRANSFER;

      const speed = Math.hypot(this.ball.vx, this.ball.vy);
      if (speed > MAX_BALL_SPEED) {
        this.ball.vx = (this.ball.vx / speed) * MAX_BALL_SPEED;
        this.ball.vy = (this.ball.vy / speed) * MAX_BALL_SPEED;
      }
    }

    const mouth = this.mouthPosition();
    const distanceToMouth = Math.hypot(this.ball.x - mouth.x, this.ball.y - mouth.y);
    if (distanceToMouth <= this.catchRadius && this.ball.vy > 0) {
      this.handleCatch();
      return;
    }

    if (this.ball.y + BALL_RADIUS >= this.height - FLOOR_MARGIN) {
      this.handleMiss();
    }
  }

  private handleCatch(): void {
    this.combo += 1;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    const points = BASE_POINTS + (this.combo - 1) * COMBO_POINTS_STEP;
    this.score += points;
    this.catchRadius = Math.max(
      MIN_CATCH_RADIUS,
      BASE_CATCH_RADIUS - this.combo * CATCH_RADIUS_SHRINK_PER_COMBO,
    );
    this.launchSpeed = Math.min(
      MAX_LAUNCH_SPEED,
      BASE_LAUNCH_SPEED + this.combo * LAUNCH_SPEED_GROWTH_PER_COMBO,
    );
    this.isHeld = true;
    this.heldTimer = HOLD_SECONDS;
    this.onCatch?.({ combo: this.combo, points });
  }

  private handleMiss(): void {
    this.combo = 0;
    this.catchRadius = BASE_CATCH_RADIUS;
    this.launchSpeed = BASE_LAUNCH_SPEED;
    this.lives -= 1;
    this.onMiss?.({ livesRemaining: this.lives });
    if (this.lives <= 0) {
      this.lives = 0;
      this.isOver = true;
      return;
    }
    this.launchBall();
  }
}

export const KENDAMA_START_LIVES = START_LIVES;
