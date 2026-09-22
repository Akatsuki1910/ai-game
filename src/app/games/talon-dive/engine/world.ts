export interface Falcon {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface Prey {
  x: number;
  y: number;
  vx: number;
  vy: number;
  wanderAngle: number;
}

export interface Rival {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface Perch {
  x: number;
  y: number;
  radius: number;
}

export interface CatchEvent {
  streak: number;
  points: number;
}

export interface StolenEvent {
  streak: number;
}

export interface ExhaustedEvent {
  score: number;
}

export const FALCON_RADIUS = 16;
export const PREY_RADIUS = 11;
export const RIVAL_RADIUS = 15;
export const PERCH_RADIUS = 80;
export const CATCH_RADIUS = FALCON_RADIUS + PREY_RADIUS;
export const ALERT_RADIUS = 170;
export const PREY_COUNT = 3;
export const STAMINA_MAX = 100;

const FLEE_SPEED = 100;
const WANDER_SPEED = 26;
const WANDER_TURN_RATE = 1.6;
const FALCON_ACCEL = 1100;
const FALCON_DAMPING_PER_SECOND = 1.6;
const FALCON_MAX_SPEED = 270;
const STAMINA_DRAIN_PER_SECOND = 11;
const STAMINA_REGEN_PER_SECOND = 30;
const RIVAL_BASE_SPEED = 150;
const RIVAL_SPEED_PER_SECOND = 4;
const RIVAL_SPEED_MAX = 230;
const CATCH_BASE_POINTS = 150;
const CATCH_STREAK_BONUS = 40;
const SPAWN_MARGIN = 40;
const SPAWN_MAX_ATTEMPTS = 20;

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * 惑星ならぬ狩場を舞う隼を操り、逃げる獲物をライバルの鷹より先に仕留める
 * リアルタイム狩猟シミュレーションの純粋ロジック層。React / pixi.js には依存しない。
 *
 * 中央の巣(perch)の中にいる間だけスタミナが回復し、外に出ると常に減り続ける。
 * ライバルは常に自分から最も近い獲物を追うため、狩り場を離れすぎると横取りされる。
 */
export class TalonDiveWorld {
  width = 0;
  height = 0;
  falcon: Falcon = { x: 0, y: 0, vx: 0, vy: 0 };
  perch: Perch = { x: 0, y: 0, radius: PERCH_RADIUS };
  prey: Prey[] = [];
  rival: Rival = { x: 0, y: 0, vx: 0, vy: 0 };
  stamina = STAMINA_MAX;
  score = 0;
  streak = 0;
  isOver = false;
  private isSteering = false;
  private steerTargetX = 0;
  private steerTargetY = 0;
  private elapsedSeconds = 0;

  onCatch: ((event: CatchEvent) => void) | null = null;
  onStolen: ((event: StolenEvent) => void) | null = null;
  onExhausted: ((event: ExhaustedEvent) => void) | null = null;

  constructor(width: number, height: number) {
    this.resize(width, height);
    this.reset();
  }

  reset(): void {
    this.stamina = STAMINA_MAX;
    this.score = 0;
    this.streak = 0;
    this.isOver = false;
    this.isSteering = false;
    this.elapsedSeconds = 0;
    this.perch = { x: this.width / 2, y: this.height * 0.82, radius: PERCH_RADIUS };
    this.falcon = { x: this.perch.x, y: this.perch.y, vx: 0, vy: 0 };
    this.steerTargetX = this.falcon.x;
    this.steerTargetY = this.falcon.y;
    this.rival = { x: this.width * 0.12, y: this.height * 0.15, vx: 0, vy: 0 };
    this.prey = Array.from({ length: PREY_COUNT }, () => this.spawnPrey());
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const scaleX = this.width > 0 ? width / this.width : 1;
    const scaleY = this.height > 0 ? height / this.height : 1;
    if (this.width > 0 && this.height > 0) {
      this.falcon.x *= scaleX;
      this.falcon.y *= scaleY;
      this.perch.x *= scaleX;
      this.perch.y *= scaleY;
      this.rival.x *= scaleX;
      this.rival.y *= scaleY;
      this.steerTargetX *= scaleX;
      this.steerTargetY *= scaleY;
      for (const p of this.prey) {
        p.x *= scaleX;
        p.y *= scaleY;
      }
    }
    this.width = width;
    this.height = height;
  }

  /** ドラッグ/長押し中のポインタ位置、またはキーボード入力から計算した狙点を渡す。 */
  setSteerTarget(x: number, y: number): void {
    this.steerTargetX = clamp(x, 0, this.width);
    this.steerTargetY = clamp(y, 0, this.height);
  }

  setSteering(isActive: boolean): void {
    this.isSteering = isActive;
  }

  private randomFarPosition(
    fromX: number,
    fromY: number,
    minDist: number,
  ): { x: number; y: number } {
    let best = { x: this.width / 2, y: this.height / 2 };
    let bestDist = -1;
    for (let attempt = 0; attempt < SPAWN_MAX_ATTEMPTS; attempt++) {
      const x = randRange(SPAWN_MARGIN, Math.max(SPAWN_MARGIN, this.width - SPAWN_MARGIN));
      const y = randRange(SPAWN_MARGIN, Math.max(SPAWN_MARGIN, this.height - SPAWN_MARGIN));
      const dist = Math.hypot(x - fromX, y - fromY);
      if (dist >= minDist) return { x, y };
      if (dist > bestDist) {
        bestDist = dist;
        best = { x, y };
      }
    }
    return best;
  }

  private spawnPrey(): Prey {
    const pos = this.randomFarPosition(this.perch.x, this.perch.y, this.perch.radius * 1.5);
    return { x: pos.x, y: pos.y, vx: 0, vy: 0, wanderAngle: randRange(0, Math.PI * 2) };
  }

  private catchPoints(): number {
    return CATCH_BASE_POINTS + this.streak * CATCH_STREAK_BONUS;
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;
    this.elapsedSeconds += deltaSeconds;

    let ax = 0;
    let ay = 0;
    if (this.isSteering) {
      const dx = this.steerTargetX - this.falcon.x;
      const dy = this.steerTargetY - this.falcon.y;
      const dist = Math.max(Math.hypot(dx, dy), 1);
      ax = (dx / dist) * FALCON_ACCEL;
      ay = (dy / dist) * FALCON_ACCEL;
    }

    const dampingFactor = Math.exp(-FALCON_DAMPING_PER_SECOND * deltaSeconds);
    this.falcon.vx = (this.falcon.vx + ax * deltaSeconds) * dampingFactor;
    this.falcon.vy = (this.falcon.vy + ay * deltaSeconds) * dampingFactor;
    const falconSpeed = Math.hypot(this.falcon.vx, this.falcon.vy);
    if (falconSpeed > FALCON_MAX_SPEED) {
      const scale = FALCON_MAX_SPEED / falconSpeed;
      this.falcon.vx *= scale;
      this.falcon.vy *= scale;
    }
    this.falcon.x += this.falcon.vx * deltaSeconds;
    this.falcon.y += this.falcon.vy * deltaSeconds;
    if (this.falcon.x < FALCON_RADIUS) {
      this.falcon.x = FALCON_RADIUS;
      this.falcon.vx = Math.max(this.falcon.vx, 0);
    } else if (this.falcon.x > this.width - FALCON_RADIUS) {
      this.falcon.x = this.width - FALCON_RADIUS;
      this.falcon.vx = Math.min(this.falcon.vx, 0);
    }
    if (this.falcon.y < FALCON_RADIUS) {
      this.falcon.y = FALCON_RADIUS;
      this.falcon.vy = Math.max(this.falcon.vy, 0);
    } else if (this.falcon.y > this.height - FALCON_RADIUS) {
      this.falcon.y = this.height - FALCON_RADIUS;
      this.falcon.vy = Math.min(this.falcon.vy, 0);
    }

    const distToPerch = Math.hypot(this.falcon.x - this.perch.x, this.falcon.y - this.perch.y);
    const isHome = distToPerch < this.perch.radius;
    if (isHome) {
      this.stamina = Math.min(STAMINA_MAX, this.stamina + STAMINA_REGEN_PER_SECOND * deltaSeconds);
    } else {
      this.stamina = Math.max(0, this.stamina - STAMINA_DRAIN_PER_SECOND * deltaSeconds);
    }
    if (this.stamina <= 0) {
      this.stamina = 0;
      this.isOver = true;
      this.onExhausted?.({ score: this.score });
      return;
    }

    for (const p of this.prey) {
      const distToFalcon = Math.hypot(p.x - this.falcon.x, p.y - this.falcon.y);
      if (distToFalcon < ALERT_RADIUS) {
        const dist = Math.max(distToFalcon, 1);
        p.vx = ((p.x - this.falcon.x) / dist) * FLEE_SPEED;
        p.vy = ((p.y - this.falcon.y) / dist) * FLEE_SPEED;
      } else {
        p.wanderAngle += randRange(-1, 1) * WANDER_TURN_RATE * deltaSeconds;
        p.vx = Math.cos(p.wanderAngle) * WANDER_SPEED;
        p.vy = Math.sin(p.wanderAngle) * WANDER_SPEED;
      }
      p.x += p.vx * deltaSeconds;
      p.y += p.vy * deltaSeconds;
      if (p.x < PREY_RADIUS) {
        p.x = PREY_RADIUS;
        p.vx = Math.abs(p.vx);
        p.wanderAngle = Math.atan2(p.vy, p.vx);
      } else if (p.x > this.width - PREY_RADIUS) {
        p.x = this.width - PREY_RADIUS;
        p.vx = -Math.abs(p.vx);
        p.wanderAngle = Math.atan2(p.vy, p.vx);
      }
      if (p.y < PREY_RADIUS) {
        p.y = PREY_RADIUS;
        p.vy = Math.abs(p.vy);
        p.wanderAngle = Math.atan2(p.vy, p.vx);
      } else if (p.y > this.height - PREY_RADIUS) {
        p.y = this.height - PREY_RADIUS;
        p.vy = -Math.abs(p.vy);
        p.wanderAngle = Math.atan2(p.vy, p.vx);
      }
    }

    let nearestIndex = -1;
    let nearestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.prey.length; i++) {
      const dist = Math.hypot(this.prey[i].x - this.rival.x, this.prey[i].y - this.rival.y);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIndex = i;
      }
    }
    if (nearestIndex >= 0) {
      const target = this.prey[nearestIndex];
      const dx = target.x - this.rival.x;
      const dy = target.y - this.rival.y;
      const dist = Math.max(Math.hypot(dx, dy), 1);
      const rivalSpeed = Math.min(
        RIVAL_SPEED_MAX,
        RIVAL_BASE_SPEED + this.elapsedSeconds * RIVAL_SPEED_PER_SECOND,
      );
      this.rival.vx = (dx / dist) * rivalSpeed;
      this.rival.vy = (dy / dist) * rivalSpeed;
      this.rival.x = clamp(
        this.rival.x + this.rival.vx * deltaSeconds,
        RIVAL_RADIUS,
        this.width - RIVAL_RADIUS,
      );
      this.rival.y = clamp(
        this.rival.y + this.rival.vy * deltaSeconds,
        RIVAL_RADIUS,
        this.height - RIVAL_RADIUS,
      );
    }

    for (let i = 0; i < this.prey.length; i++) {
      const p = this.prey[i];
      const distFalcon = Math.hypot(p.x - this.falcon.x, p.y - this.falcon.y);
      const distRival = Math.hypot(p.x - this.rival.x, p.y - this.rival.y);
      const falconCatches = distFalcon < CATCH_RADIUS;
      const rivalCatches = distRival < CATCH_RADIUS;
      if (!falconCatches && !rivalCatches) continue;

      if (falconCatches && (!rivalCatches || distFalcon <= distRival)) {
        const points = this.catchPoints();
        this.score += points;
        this.streak += 1;
        this.onCatch?.({ streak: this.streak, points });
      } else {
        this.streak = 0;
        this.onStolen?.({ streak: 0 });
      }
      this.prey[i] = this.spawnPrey();
    }
  }
}
