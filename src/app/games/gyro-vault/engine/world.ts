export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

export interface WallRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HoleTrap {
  x: number;
  y: number;
  radius: number;
}

export interface Checkpoint {
  x: number;
  y: number;
  radius: number;
}

export interface GoalZone {
  x: number;
  y: number;
  radius: number;
}

interface RatioPoint {
  xRatio: number;
  yRatio: number;
}

interface RatioRect {
  xRatio: number;
  yRatio: number;
  widthRatio: number;
  heightRatio: number;
}

interface RatioCircle {
  xRatio: number;
  yRatio: number;
  radiusRatio: number;
}

interface LayoutTemplate {
  spawn: RatioPoint;
  goal: RatioPoint;
  checkpoint: RatioPoint;
  walls: readonly RatioRect[];
  holes: readonly RatioCircle[];
}

export interface GoalReachedEvent {
  points: number;
  score: number;
  goalCount: number;
}

export interface FallEvent {
  fallCount: number;
  penaltySeconds: number;
}

export const ROUND_SECONDS = 90;

const BALL_RADIUS = 14;
const CHECKPOINT_RADIUS = 18;
const GOAL_RADIUS = 22;
const TILT_ACCEL = 1300; // px/秒²（傾き最大時）
const FRICTION_DAMPING = 2.4; // 摩擦による減速の強さ（指数減衰係数）
const WALL_RESTITUTION = 0.35;
const HOLE_PENALTY_SECONDS = 4;
const GOAL_TIME_BONUS = 8;
const GOAL_BASE_POINTS = 150;
const GOAL_BONUS_PER_ROUND = 20;
const MAX_DIFFICULTY = 2.2;
const DIFFICULTY_STEP = 0.15;
const MAX_SUBSTEP_SECONDS = 1 / 120;

const LAYOUTS: readonly LayoutTemplate[] = [
  {
    spawn: { xRatio: 0.08, yRatio: 0.5 },
    goal: { xRatio: 0.92, yRatio: 0.5 },
    checkpoint: { xRatio: 0.5, yRatio: 0.5 },
    walls: [
      { xRatio: 0.32, yRatio: 0, widthRatio: 0.035, heightRatio: 0.6 },
      { xRatio: 0.62, yRatio: 0.4, widthRatio: 0.035, heightRatio: 0.6 },
    ],
    holes: [
      { xRatio: 0.3, yRatio: 0.85, radiusRatio: 0.045 },
      { xRatio: 0.62, yRatio: 0.18, radiusRatio: 0.045 },
    ],
  },
  {
    spawn: { xRatio: 0.08, yRatio: 0.5 },
    goal: { xRatio: 0.92, yRatio: 0.5 },
    checkpoint: { xRatio: 0.5, yRatio: 0.5 },
    walls: [
      { xRatio: 0.26, yRatio: 0.4, widthRatio: 0.035, heightRatio: 0.6 },
      { xRatio: 0.5, yRatio: 0, widthRatio: 0.035, heightRatio: 0.6 },
      { xRatio: 0.74, yRatio: 0.4, widthRatio: 0.035, heightRatio: 0.6 },
    ],
    holes: [
      { xRatio: 0.26, yRatio: 0.18, radiusRatio: 0.045 },
      { xRatio: 0.5, yRatio: 0.82, radiusRatio: 0.045 },
      { xRatio: 0.74, yRatio: 0.18, radiusRatio: 0.045 },
    ],
  },
  {
    spawn: { xRatio: 0.06, yRatio: 0.5 },
    goal: { xRatio: 0.94, yRatio: 0.5 },
    checkpoint: { xRatio: 0.5, yRatio: 0.9 },
    walls: [
      { xRatio: 0.24, yRatio: 0, widthRatio: 0.035, heightRatio: 0.68 },
      { xRatio: 0.5, yRatio: 0.32, widthRatio: 0.035, heightRatio: 0.68 },
      { xRatio: 0.76, yRatio: 0, widthRatio: 0.035, heightRatio: 0.68 },
    ],
    holes: [
      { xRatio: 0.24, yRatio: 0.85, radiusRatio: 0.04 },
      { xRatio: 0.5, yRatio: 0.16, radiusRatio: 0.04 },
      { xRatio: 0.76, yRatio: 0.85, radiusRatio: 0.04 },
      { xRatio: 0.5, yRatio: 0.55, radiusRatio: 0.05 },
    ],
  },
  {
    spawn: { xRatio: 0.06, yRatio: 0.5 },
    goal: { xRatio: 0.94, yRatio: 0.5 },
    checkpoint: { xRatio: 0.5, yRatio: 0.85 },
    walls: [
      { xRatio: 0.2, yRatio: 0, widthRatio: 0.03, heightRatio: 0.62 },
      { xRatio: 0.4, yRatio: 0.38, widthRatio: 0.03, heightRatio: 0.62 },
      { xRatio: 0.62, yRatio: 0, widthRatio: 0.03, heightRatio: 0.62 },
      { xRatio: 0.82, yRatio: 0.38, widthRatio: 0.03, heightRatio: 0.62 },
    ],
    holes: [
      { xRatio: 0.2, yRatio: 0.85, radiusRatio: 0.04 },
      { xRatio: 0.4, yRatio: 0.15, radiusRatio: 0.04 },
      { xRatio: 0.62, yRatio: 0.85, radiusRatio: 0.04 },
      { xRatio: 0.82, yRatio: 0.15, radiusRatio: 0.04 },
      { xRatio: 0.5, yRatio: 0.5, radiusRatio: 0.05 },
    ],
  },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function clampMagnitude(x: number, y: number, maxLength: number): { x: number; y: number } {
  const length = Math.hypot(x, y);
  if (length <= maxLength || length === 0) return { x, y };
  const scale = maxLength / length;
  return { x: x * scale, y: y * scale };
}

export class GyroVaultWorld {
  width = 0;
  height = 0;
  ball: Ball = { x: 0, y: 0, vx: 0, vy: 0, radius: BALL_RADIUS };
  walls: WallRect[] = [];
  holes: HoleTrap[] = [];
  checkpoint: Checkpoint = { x: 0, y: 0, radius: CHECKPOINT_RADIUS };
  goal: GoalZone = { x: 0, y: 0, radius: GOAL_RADIUS };
  score = 0;
  timeRemaining = ROUND_SECONDS;
  isOver = false;
  layoutIndex = 0;
  goalCount = 0;
  fallCount = 0;
  difficulty = 1;

  onGoalReached: ((event: GoalReachedEvent) => void) | null = null;
  onFall: ((event: FallEvent) => void) | null = null;

  private spawnPoint = { x: 0, y: 0 };
  private lastSafe = { x: 0, y: 0 };

  constructor(width: number, height: number) {
    this.width = Math.max(width, 1);
    this.height = Math.max(height, 1);
    this.reset();
  }

  reset(): void {
    this.score = 0;
    this.timeRemaining = ROUND_SECONDS;
    this.isOver = false;
    this.layoutIndex = 0;
    this.goalCount = 0;
    this.fallCount = 0;
    this.difficulty = 1;
    this.applyLayout(LAYOUTS[this.layoutIndex]);
    this.placeBallAtSpawn();
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const scaleX = this.width > 0 ? width / this.width : 1;
    const scaleY = this.height > 0 ? height / this.height : 1;

    this.ball.x *= scaleX;
    this.ball.y *= scaleY;
    this.ball.vx *= scaleX;
    this.ball.vy *= scaleY;
    this.lastSafe.x *= scaleX;
    this.lastSafe.y *= scaleY;

    this.width = width;
    this.height = height;
    this.applyLayout(LAYOUTS[this.layoutIndex]);
  }

  step(deltaSeconds: number, tilt: { x: number; y: number }): void {
    if (this.isOver) return;

    this.timeRemaining = Math.max(0, this.timeRemaining - deltaSeconds);
    if (this.timeRemaining <= 0) {
      this.isOver = true;
      return;
    }

    const clampedTilt = clampMagnitude(tilt.x, tilt.y, 1);

    // タブ復帰直後などdeltaSecondsが大きい場合、1フレーム分をまとめて動かすと
    // ボールの移動量が壁の厚みを超えてすり抜けてしまう（トンネリング）。
    // 固定幅の副ステップに分割し、各ステップごとに衝突判定をかけ直すことで防ぐ。
    const substeps = Math.max(1, Math.ceil(deltaSeconds / MAX_SUBSTEP_SECONDS));
    const substepDt = deltaSeconds / substeps;

    for (let i = 0; i < substeps; i++) {
      const ball = this.ball;

      ball.vx += clampedTilt.x * TILT_ACCEL * this.difficulty * substepDt;
      ball.vy += clampedTilt.y * TILT_ACCEL * this.difficulty * substepDt;

      const damping = Math.exp(-FRICTION_DAMPING * substepDt);
      ball.vx *= damping;
      ball.vy *= damping;

      ball.x += ball.vx * substepDt;
      ball.y += ball.vy * substepDt;

      this.resolveBounds();
      for (const wall of this.walls) this.resolveWallCollision(wall);

      if (this.checkHoles()) return;
      this.checkCheckpoint();
      // ゴール到達で盤面が丸ごと差し替わるため、残りの副ステップは打ち切る。
      if (this.checkGoal()) return;
    }
  }

  private applyLayout(template: LayoutTemplate): void {
    const { width, height } = this;
    const minSide = Math.min(width, height);

    this.spawnPoint = { x: template.spawn.xRatio * width, y: template.spawn.yRatio * height };
    this.goal = {
      x: template.goal.xRatio * width,
      y: template.goal.yRatio * height,
      radius: GOAL_RADIUS,
    };
    this.checkpoint = {
      x: template.checkpoint.xRatio * width,
      y: template.checkpoint.yRatio * height,
      radius: CHECKPOINT_RADIUS,
    };
    this.walls = template.walls.map((wall) => ({
      x: wall.xRatio * width,
      y: wall.yRatio * height,
      width: wall.widthRatio * width,
      height: wall.heightRatio * height,
    }));
    this.holes = template.holes.map((hole) => ({
      x: hole.xRatio * width,
      y: hole.yRatio * height,
      radius: hole.radiusRatio * minSide,
    }));
  }

  private placeBallAtSpawn(): void {
    this.ball = {
      x: this.spawnPoint.x,
      y: this.spawnPoint.y,
      vx: 0,
      vy: 0,
      radius: BALL_RADIUS,
    };
    this.lastSafe = { x: this.spawnPoint.x, y: this.spawnPoint.y };
  }

  private resolveBounds(): void {
    const ball = this.ball;
    if (ball.x - ball.radius < 0) {
      ball.x = ball.radius;
      ball.vx = Math.abs(ball.vx) * WALL_RESTITUTION;
    } else if (ball.x + ball.radius > this.width) {
      ball.x = this.width - ball.radius;
      ball.vx = -Math.abs(ball.vx) * WALL_RESTITUTION;
    }
    if (ball.y - ball.radius < 0) {
      ball.y = ball.radius;
      ball.vy = Math.abs(ball.vy) * WALL_RESTITUTION;
    } else if (ball.y + ball.radius > this.height) {
      ball.y = this.height - ball.radius;
      ball.vy = -Math.abs(ball.vy) * WALL_RESTITUTION;
    }
  }

  private resolveWallCollision(wall: WallRect): void {
    const ball = this.ball;
    const closestX = clamp(ball.x, wall.x, wall.x + wall.width);
    const closestY = clamp(ball.y, wall.y, wall.y + wall.height);
    const dx = ball.x - closestX;
    const dy = ball.y - closestY;
    const dist = Math.hypot(dx, dy);
    if (dist >= ball.radius) return;

    let nx: number;
    let ny: number;
    if (dist > 1e-6) {
      nx = dx / dist;
      ny = dy / dist;
    } else {
      const centerX = wall.x + wall.width / 2;
      const centerY = wall.y + wall.height / 2;
      const overlapX = wall.width / 2 + ball.radius - Math.abs(ball.x - centerX);
      const overlapY = wall.height / 2 + ball.radius - Math.abs(ball.y - centerY);
      if (overlapX < overlapY) {
        nx = ball.x >= centerX ? 1 : -1;
        ny = 0;
      } else {
        nx = 0;
        ny = ball.y >= centerY ? 1 : -1;
      }
    }

    const penetration = ball.radius - dist;
    ball.x += nx * penetration;
    ball.y += ny * penetration;

    const velocityAlongNormal = ball.vx * nx + ball.vy * ny;
    if (velocityAlongNormal < 0) {
      ball.vx -= (1 + WALL_RESTITUTION) * velocityAlongNormal * nx;
      ball.vy -= (1 + WALL_RESTITUTION) * velocityAlongNormal * ny;
    }
  }

  /** 落下したら true を返す（この後の判定は今フレームぶんスキップする）。 */
  private checkHoles(): boolean {
    const ball = this.ball;
    for (const hole of this.holes) {
      const dist = Math.hypot(ball.x - hole.x, ball.y - hole.y);
      if (dist < hole.radius - ball.radius * 0.3) {
        this.handleFall();
        return true;
      }
    }
    return false;
  }

  private handleFall(): void {
    this.fallCount++;
    this.timeRemaining = Math.max(0, this.timeRemaining - HOLE_PENALTY_SECONDS);
    this.ball.x = this.lastSafe.x;
    this.ball.y = this.lastSafe.y;
    this.ball.vx = 0;
    this.ball.vy = 0;
    this.onFall?.({ fallCount: this.fallCount, penaltySeconds: HOLE_PENALTY_SECONDS });
    if (this.timeRemaining <= 0) this.isOver = true;
  }

  private checkCheckpoint(): void {
    const ball = this.ball;
    const dist = Math.hypot(ball.x - this.checkpoint.x, ball.y - this.checkpoint.y);
    if (dist < this.checkpoint.radius + ball.radius) {
      this.lastSafe = { x: this.checkpoint.x, y: this.checkpoint.y };
    }
  }

  /** ゴールに到達したら true を返す（この後、盤面が次のレイアウトへ差し替わっている）。 */
  private checkGoal(): boolean {
    const ball = this.ball;
    const dist = Math.hypot(ball.x - this.goal.x, ball.y - this.goal.y);
    if (dist >= this.goal.radius + ball.radius * 0.5) return false;

    this.goalCount++;
    const points = GOAL_BASE_POINTS + this.goalCount * GOAL_BONUS_PER_ROUND;
    this.score += points;
    this.timeRemaining += GOAL_TIME_BONUS;
    this.difficulty = Math.min(MAX_DIFFICULTY, this.difficulty + DIFFICULTY_STEP);
    this.onGoalReached?.({ points, score: this.score, goalCount: this.goalCount });

    this.layoutIndex = (this.layoutIndex + 1) % LAYOUTS.length;
    this.applyLayout(LAYOUTS[this.layoutIndex]);
    this.placeBallAtSpawn();
    return true;
  }
}
