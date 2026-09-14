export interface Comet {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  hue: number;
  /** 回収リング内に居続けた時間（秒）。これが一定値に達すると回収される。 */
  dwell: number;
}

export interface Hazard {
  id: number;
  x: number;
  y: number;
  radius: number;
  angle: number;
  angularSpeed: number;
  orbitRadiusFactor: number;
}

export interface Collector {
  x: number;
  y: number;
  radius: number;
}

export interface CometCapturedEvent {
  x: number;
  y: number;
  hue: number;
  points: number;
  combo: number;
}

export interface CometBurnedEvent {
  x: number;
  y: number;
  hue: number;
}

const ROUND_SECONDS = 75;
const SUN_STRENGTH = 900_000;
const WELL_STRENGTH = SUN_STRENGTH * 6;
const MAX_WELL_ACCEL = 2200;
const MIN_DIST = 30;
const MIN_DIST_SQ = MIN_DIST * MIN_DIST;
const MAX_SPEED = 380;
const CAPTURE_DWELL = 0.55;
const BASE_POINTS = 120;
const COMBO_BONUS_PER_STREAK = 45;
const COMET_RADIUS = 13;
const HAZARD_RADIUS = 16;
const COMET_COUNT = 5;
const COMET_SPAWN_FACTOR = 0.42;
const DIFFICULTY_STEP = 0.035;
const MAX_DIFFICULTY = 1.35;

const HAZARD_CONFIGS = [
  { orbitRadiusFactor: 0.22, angularSpeed: 0.55, startAngle: 0 },
  { orbitRadiusFactor: 0.3, angularSpeed: 0.38, startAngle: (Math.PI * 2) / 3 },
  { orbitRadiusFactor: 0.37, angularSpeed: 0.62, startAngle: (Math.PI * 4) / 3 },
];

let nextId = 1;

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export class GravityHerdWorld {
  width = 0;
  height = 0;
  comets: Comet[] = [];
  hazards: Hazard[] = [];
  collector: Collector = { x: 0, y: 0, radius: 0 };
  wellX = 0;
  wellY = 0;
  boosting = false;
  score = 0;
  combo = 0;
  timeRemaining = ROUND_SECONDS;
  isOver = false;
  private difficulty = 1;

  onCometCaptured: ((event: CometCapturedEvent) => void) | null = null;
  onCometBurned: ((event: CometBurnedEvent) => void) | null = null;

  constructor(width: number, height: number) {
    this.resize(width, height);
    this.reset();
  }

  reset(): void {
    this.score = 0;
    this.combo = 0;
    this.timeRemaining = ROUND_SECONDS;
    this.isOver = false;
    this.difficulty = 1;
    this.collector = this.computeCollector();
    this.hazards = HAZARD_CONFIGS.map((config) => this.spawnHazard(config));
    this.comets = Array.from({ length: COMET_COUNT }, () => this.spawnComet());
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.width = width;
    this.height = height;
    this.collector = this.computeCollector();
    for (const comet of this.comets) {
      comet.x = Math.min(Math.max(comet.x, comet.radius), width - comet.radius);
      comet.y = Math.min(Math.max(comet.y, comet.radius), height - comet.radius);
    }
  }

  setWellTarget(x: number, y: number): void {
    this.wellX = x;
    this.wellY = y;
  }

  setBoost(active: boolean): void {
    this.boosting = active;
  }

  private computeCollector(): Collector {
    const minDim = Math.min(this.width, this.height);
    const radius = Math.min(Math.max(minDim * 0.115, 42), 92);
    return { x: this.width / 2, y: this.height / 2, radius };
  }

  private spawnHazard(config: (typeof HAZARD_CONFIGS)[number]): Hazard {
    const hazard: Hazard = {
      id: nextId++,
      x: 0,
      y: 0,
      radius: HAZARD_RADIUS,
      angle: config.startAngle,
      angularSpeed: config.angularSpeed * (Math.random() < 0.5 ? 1 : -1),
      orbitRadiusFactor: config.orbitRadiusFactor,
    };
    this.placeHazard(hazard);
    return hazard;
  }

  private placeHazard(hazard: Hazard): void {
    const minDim = Math.min(this.width, this.height);
    const orbitRadius = hazard.orbitRadiusFactor * minDim;
    hazard.x = this.width / 2 + Math.cos(hazard.angle) * orbitRadius;
    hazard.y = this.height / 2 + Math.sin(hazard.angle) * orbitRadius;
  }

  private spawnComet(): Comet {
    const minDim = Math.min(this.width, this.height);
    const spawnRadius = COMET_SPAWN_FACTOR * minDim;
    const angle = randRange(0, Math.PI * 2);
    const x = this.width / 2 + Math.cos(angle) * spawnRadius;
    const y = this.height / 2 + Math.sin(angle) * spawnRadius;
    const circularSpeed = Math.sqrt(SUN_STRENGTH / Math.max(spawnRadius, MIN_DIST));
    const speed = circularSpeed * randRange(0.75, 1.05) * this.difficulty;
    const spin = Math.random() < 0.5 ? 1 : -1;
    return {
      id: nextId++,
      x,
      y,
      vx: -Math.sin(angle) * speed * spin,
      vy: Math.cos(angle) * speed * spin,
      radius: COMET_RADIUS,
      hue: randRange(0, 360),
      dwell: 0,
    };
  }

  private respawnComet(comet: Comet): void {
    const fresh = this.spawnComet();
    comet.x = fresh.x;
    comet.y = fresh.y;
    comet.vx = fresh.vx;
    comet.vy = fresh.vy;
    comet.hue = fresh.hue;
    comet.dwell = 0;
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    this.timeRemaining = Math.max(0, this.timeRemaining - deltaSeconds);
    if (this.timeRemaining <= 0) {
      this.isOver = true;
      return;
    }

    for (const hazard of this.hazards) {
      hazard.angle += hazard.angularSpeed * deltaSeconds;
      this.placeHazard(hazard);
    }

    for (const comet of this.comets) {
      let ax = 0;
      let ay = 0;

      const sunDx = this.width / 2 - comet.x;
      const sunDy = this.height / 2 - comet.y;
      const sunDistSq = Math.max(sunDx * sunDx + sunDy * sunDy, MIN_DIST_SQ);
      const sunDist = Math.sqrt(sunDistSq);
      const sunAccel = SUN_STRENGTH / sunDistSq;
      ax += (sunDx / sunDist) * sunAccel;
      ay += (sunDy / sunDist) * sunAccel;

      if (this.boosting) {
        const wellDx = this.wellX - comet.x;
        const wellDy = this.wellY - comet.y;
        const wellDistSq = Math.max(wellDx * wellDx + wellDy * wellDy, MIN_DIST_SQ);
        const wellDist = Math.sqrt(wellDistSq);
        const wellAccel = Math.min(WELL_STRENGTH / wellDistSq, MAX_WELL_ACCEL);
        ax += (wellDx / wellDist) * wellAccel;
        ay += (wellDy / wellDist) * wellAccel;
      }

      comet.vx += ax * deltaSeconds;
      comet.vy += ay * deltaSeconds;
      const speed = Math.hypot(comet.vx, comet.vy);
      if (speed > MAX_SPEED) {
        const factor = MAX_SPEED / speed;
        comet.vx *= factor;
        comet.vy *= factor;
      }

      comet.x += comet.vx * deltaSeconds;
      comet.y += comet.vy * deltaSeconds;

      if (comet.x < comet.radius) {
        comet.x = comet.radius;
        comet.vx = Math.abs(comet.vx);
      } else if (comet.x > this.width - comet.radius) {
        comet.x = this.width - comet.radius;
        comet.vx = -Math.abs(comet.vx);
      }
      if (comet.y < comet.radius) {
        comet.y = comet.radius;
        comet.vy = Math.abs(comet.vy);
      } else if (comet.y > this.height - comet.radius) {
        comet.y = this.height - comet.radius;
        comet.vy = -Math.abs(comet.vy);
      }

      const hitHazard = this.hazards.some(
        (hazard) =>
          Math.hypot(comet.x - hazard.x, comet.y - hazard.y) <= comet.radius + hazard.radius,
      );
      if (hitHazard) {
        this.combo = 0;
        this.onCometBurned?.({ x: comet.x, y: comet.y, hue: comet.hue });
        this.respawnComet(comet);
        continue;
      }

      const distToCollector = Math.hypot(comet.x - this.collector.x, comet.y - this.collector.y);
      if (distToCollector <= this.collector.radius) {
        comet.dwell += deltaSeconds;
      } else {
        comet.dwell = Math.max(0, comet.dwell - deltaSeconds * 2);
      }

      if (comet.dwell >= CAPTURE_DWELL) {
        this.combo += 1;
        const points = BASE_POINTS + (this.combo - 1) * COMBO_BONUS_PER_STREAK;
        this.score += points;
        this.onCometCaptured?.({
          x: comet.x,
          y: comet.y,
          hue: comet.hue,
          points,
          combo: this.combo,
        });
        this.difficulty = Math.min(MAX_DIFFICULTY, this.difficulty + DIFFICULTY_STEP);
        this.respawnComet(comet);
      }
    }
  }
}
