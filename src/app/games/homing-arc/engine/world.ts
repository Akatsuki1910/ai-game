export interface Vec2 {
  x: number;
  y: number;
}

export interface Obstacle {
  id: number;
  x: number;
  y: number;
  radius: number;
}

export type ThrowOutcome = "caught" | "missed" | "obstacle";

export interface ThrowResolvedEvent {
  outcome: ThrowOutcome;
  points: number;
  combo: number;
  livesRemaining: number;
}

export interface ActiveThrow {
  readonly p0: Vec2;
  readonly p1: Vec2;
  readonly p2: Vec2;
  readonly p3: Vec2;
  readonly duration: number;
  readonly elapsed: number;
  readonly windowStartSeconds: number;
  readonly windowEndSeconds: number;
}

export const MAX_LIVES = 3;
export const AIM_MIN_ANGLE = -Math.PI * 0.94;
export const AIM_MAX_ANGLE = -Math.PI * 0.06;

const DEFAULT_AIM_ANGLE = -Math.PI / 2;
const DEFAULT_AIM_POWER = 0.6;
const MIN_POWER = 0.15;

const BASE_FLIGHT_DURATION = 1.55;
const DURATION_PER_POWER = 0.9;

const CATCH_WINDOW_START_RATIO = 0.85;
const BASE_CATCH_WINDOW_SECONDS = 0.55;
const MIN_CATCH_WINDOW_SECONDS = 0.22;
const CATCH_WINDOW_SHRINK_PER_COMBO = 0.02;

const BASE_POINTS = 100;
const COMBO_BONUS = 15;

const OBSTACLE_RADIUS = 20;
const BOOMERANG_RADIUS = 12;
const BASE_OBSTACLE_COUNT = 1;
const MAX_OBSTACLES = 5;
const OBSTACLES_PER_COMBO_STEP = 2;
const OBSTACLE_SPAWN_ATTEMPTS = 24;
const OBSTACLE_X_MIN_RATIO = 0.15;
const OBSTACLE_X_MAX_RATIO = 0.85;
// 障害物はアンカーから離れた上方だけに配置する。こうすることで、弱いまっすぐ上への
// 投げ（パワーが低いほど弧の頂点がアンカー寄りに収まる）は幾何学的に必ず安全な
// 「確実な避け方」として成立する。テストのためだけでなく、プレイヤーにも
// リスクを避ける手段を用意する狙い。
const OBSTACLE_Y_MIN_RATIO = 0.12;
const OBSTACLE_Y_MAX_RATIO = 0.38;

let nextObstacleId = 1;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** 立方ベジェ曲線上の位置を求める。P0/P3 を同じ点にすると「行って戻る」弧になる。 */
export function cubicBezierPoint(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

interface ThrowState {
  p0: Vec2;
  p1: Vec2;
  p2: Vec2;
  p3: Vec2;
  duration: number;
  elapsed: number;
  windowStartSeconds: number;
  windowEndSeconds: number;
}

/**
 * ブーメランを投げて戻ってくるタイミングでキャッチし続けるサバイバル。
 * 飛行経路は立方ベジェ曲線（始点=終点=アンカー）で表し、決定的に計算できるため
 * 単体テストでは Math.random() を使う障害物配置だけを外から差し替えて検証する。
 */
export class HomingArcWorld {
  width = 0;
  height = 0;

  lives = MAX_LIVES;
  score = 0;
  combo = 0;
  bestCombo = 0;
  isOver = false;

  phase: "aiming" | "flying" = "aiming";
  aimAngle = DEFAULT_AIM_ANGLE;
  aimPower = DEFAULT_AIM_POWER;

  obstacles: Obstacle[] = [];

  onThrowResolved: ((event: ThrowResolvedEvent) => void) | null = null;

  private throwState: ThrowState | null = null;

  constructor(width: number, height: number) {
    this.resize(width, height);
    this.reset();
  }

  reset(): void {
    this.lives = MAX_LIVES;
    this.score = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.isOver = false;
    this.phase = "aiming";
    this.aimAngle = DEFAULT_AIM_ANGLE;
    this.aimPower = DEFAULT_AIM_POWER;
    this.throwState = null;
    this.obstacles = this.spawnObstacles(this.obstacleCountForCombo(0));
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const scaleX = this.width > 0 ? width / this.width : 1;
    const scaleY = this.height > 0 ? height / this.height : 1;
    if (this.width > 0 && this.height > 0) {
      for (const obstacle of this.obstacles) {
        obstacle.x *= scaleX;
        obstacle.y *= scaleY;
      }
      if (this.throwState) {
        for (const point of [
          this.throwState.p0,
          this.throwState.p1,
          this.throwState.p2,
          this.throwState.p3,
        ]) {
          point.x *= scaleX;
          point.y *= scaleY;
        }
      }
    }
    this.width = width;
    this.height = height;
  }

  get anchor(): Vec2 {
    return { x: this.width / 2, y: this.height * 0.86 };
  }

  /** アンカーからの距離・障害物散らばりの基準スケール。縦長/横長どちらでも扱いやすいよう短辺基準にする。 */
  private get travelScale(): number {
    return Math.min(this.width, this.height);
  }

  private currentCatchWindowSeconds(): number {
    return Math.max(
      MIN_CATCH_WINDOW_SECONDS,
      BASE_CATCH_WINDOW_SECONDS - this.combo * CATCH_WINDOW_SHRINK_PER_COMBO,
    );
  }

  private obstacleCountForCombo(combo: number): number {
    return Math.min(
      MAX_OBSTACLES,
      BASE_OBSTACLE_COUNT + Math.floor(combo / OBSTACLES_PER_COMBO_STEP),
    );
  }

  private spawnObstacles(count: number): Obstacle[] {
    if (this.width <= 0 || this.height <= 0) return [];
    const anchor = this.anchor;
    const minDistance = this.travelScale * 0.22;
    const obstacles: Obstacle[] = [];

    for (let i = 0; i < count; i++) {
      let placed: Obstacle | null = null;
      for (let attempt = 0; attempt < OBSTACLE_SPAWN_ATTEMPTS && !placed; attempt++) {
        const candidate: Obstacle = {
          id: nextObstacleId++,
          x: randRange(this.width * OBSTACLE_X_MIN_RATIO, this.width * OBSTACLE_X_MAX_RATIO),
          y: randRange(this.height * OBSTACLE_Y_MIN_RATIO, this.height * OBSTACLE_Y_MAX_RATIO),
          radius: OBSTACLE_RADIUS,
        };
        const distFromAnchor = Math.hypot(candidate.x - anchor.x, candidate.y - anchor.y);
        const overlapsOther = obstacles.some(
          (existing) =>
            Math.hypot(existing.x - candidate.x, existing.y - candidate.y) <
            (existing.radius + candidate.radius) * 1.6,
        );
        if (distFromAnchor >= minDistance && !overlapsOther) placed = candidate;
      }
      obstacles.push(
        placed ?? {
          id: nextObstacleId++,
          x: randRange(this.width * OBSTACLE_X_MIN_RATIO, this.width * OBSTACLE_X_MAX_RATIO),
          y: randRange(this.height * OBSTACLE_Y_MIN_RATIO, this.height * OBSTACLE_Y_MAX_RATIO),
          radius: OBSTACLE_RADIUS,
        },
      );
    }
    return obstacles;
  }

  rotateAim(deltaRadians: number): void {
    if (this.isOver || this.phase !== "aiming") return;
    this.aimAngle = clamp(this.aimAngle + deltaRadians, AIM_MIN_ANGLE, AIM_MAX_ANGLE);
  }

  adjustPower(deltaPower: number): void {
    if (this.isOver || this.phase !== "aiming") return;
    this.aimPower = clamp(this.aimPower + deltaPower, MIN_POWER, 1);
  }

  /** ドラッグ量（引っ張った向き）から狙いを更新する。dx/dy はアンカーから引っ張った分を渡す。 */
  setAimFromDrag(dx: number, dy: number): void {
    if (this.isOver || this.phase !== "aiming") return;
    const distance = Math.hypot(dx, dy);
    if (distance < 1e-3) return;
    const throwAngle = Math.atan2(-dy, -dx);
    this.aimAngle = clamp(throwAngle, AIM_MIN_ANGLE, AIM_MAX_ANGLE);
    const maxDragDistance = Math.max(this.travelScale * 0.35, 1);
    this.aimPower = clamp(distance / maxDragDistance, MIN_POWER, 1);
  }

  releaseThrow(): void {
    if (this.isOver || this.phase !== "aiming") return;
    const anchor = this.anchor;
    const angle = this.aimAngle;
    const power = this.aimPower;
    const dir = { x: Math.cos(angle), y: Math.sin(angle) };
    const perp = { x: -dir.y, y: dir.x };
    const travel = this.travelScale;
    const maxDist = travel * (0.32 + power * 0.5);
    const curveOffset = travel * 0.12;

    const p0 = { x: anchor.x, y: anchor.y };
    const p1 = {
      x: anchor.x + dir.x * maxDist * 0.5 + perp.x * curveOffset,
      y: anchor.y + dir.y * maxDist * 0.5 + perp.y * curveOffset,
    };
    const p2 = {
      x: anchor.x + dir.x * maxDist * 0.92 - perp.x * curveOffset,
      y: anchor.y + dir.y * maxDist * 0.92 - perp.y * curveOffset,
    };
    const p3 = { x: anchor.x, y: anchor.y };
    const duration = BASE_FLIGHT_DURATION + power * DURATION_PER_POWER;
    const windowStartSeconds = duration * CATCH_WINDOW_START_RATIO;
    const windowEndSeconds = windowStartSeconds + this.currentCatchWindowSeconds();

    this.throwState = {
      p0,
      p1,
      p2,
      p3,
      duration,
      elapsed: 0,
      windowStartSeconds,
      windowEndSeconds,
    };
    this.phase = "flying";
  }

  get activeThrow(): ActiveThrow | null {
    return this.throwState;
  }

  get isInCatchWindow(): boolean {
    if (!this.throwState) return false;
    const { elapsed, windowStartSeconds, windowEndSeconds } = this.throwState;
    return elapsed >= windowStartSeconds && elapsed <= windowEndSeconds;
  }

  get currentBoomerangPosition(): Vec2 | null {
    if (!this.throwState) return null;
    const t = clamp(this.throwState.elapsed / this.throwState.duration, 0, 1);
    return cubicBezierPoint(
      this.throwState.p0,
      this.throwState.p1,
      this.throwState.p2,
      this.throwState.p3,
      t,
    );
  }

  attemptCatch(): void {
    if (this.isOver || this.phase !== "flying" || !this.throwState) return;
    if (this.isInCatchWindow) this.resolve("caught");
  }

  step(deltaSeconds: number): void {
    if (this.isOver || deltaSeconds <= 0) return;
    if (this.phase !== "flying" || !this.throwState) return;

    this.throwState.elapsed += deltaSeconds;
    const { elapsed, duration, windowEndSeconds } = this.throwState;
    const t = clamp(elapsed / duration, 0, 1);

    if (t < 1) {
      const position = cubicBezierPoint(
        this.throwState.p0,
        this.throwState.p1,
        this.throwState.p2,
        this.throwState.p3,
        t,
      );
      const hitObstacle = this.obstacles.find(
        (obstacle) =>
          Math.hypot(position.x - obstacle.x, position.y - obstacle.y) <=
          obstacle.radius + BOOMERANG_RADIUS,
      );
      if (hitObstacle) {
        this.resolve("obstacle");
        return;
      }
    }

    if (elapsed > windowEndSeconds) {
      this.resolve("missed");
    }
  }

  private resolve(outcome: ThrowOutcome): void {
    this.throwState = null;
    this.phase = "aiming";

    let points = 0;
    if (outcome === "caught") {
      this.combo += 1;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      points = BASE_POINTS + (this.combo - 1) * COMBO_BONUS;
      this.score += points;
    } else {
      this.combo = 0;
      this.lives -= 1;
      if (this.lives <= 0) {
        this.lives = 0;
        this.isOver = true;
      }
    }

    this.obstacles = this.spawnObstacles(this.obstacleCountForCombo(this.combo));

    this.onThrowResolved?.({
      outcome,
      points,
      combo: this.combo,
      livesRemaining: this.lives,
    });
  }
}
