export interface Planet {
  id: number;
  /** 画面サイズに対する基準位置（0〜1）。resize時はここから絶対座標を再計算する。 */
  fx: number;
  fy: number;
  radius: number;
  mass: number;
  /** ゆっくり基準点の周りを回る惑星の揺れ幅（px）。0なら静止。 */
  wobbleAmp: number;
  wobbleSpeed: number;
  wobblePhase: number;
  x: number;
  y: number;
}

export interface Ring {
  id: number;
  x: number;
  y: number;
  radius: number;
}

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  trail: { x: number; y: number }[];
}

export interface RingHitEvent {
  ring: Ring;
  points: number;
  combo: number;
}

const SESSION_SECONDS = 75;
const RESPAWN_DELAY = 0.45;
const TRAIL_MAX_POINTS = 42;
const RING_COUNT = 3;
const BASE_POINTS = 100;
const COMBO_BONUS = 70;
const MASS_COEF = 3500;
const RING_RADIUS_FRAC = 0.05;
const PREVIEW_STEPS = 90;
const PREVIEW_DT = 1 / 60;

let nextId = 1;

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export class OrbitSlingWorld {
  width = 0;
  height = 0;
  planets: Planet[] = [];
  rings: Ring[] = [];
  ball: Ball | null = null;
  ballReady = false;
  respawnTimer = 0;
  score = 0;
  timeRemaining = SESSION_SECONDS;
  isOver = false;
  combo = 0;

  padX = 0;
  padY = 0;
  padRadius = 0;
  ballRadius = 0;
  maxDrag = 0;
  maxSpeed = 0;

  private elapsed = 0;
  private planetRadiusFrac = new Map<number, number>();
  private planetStrength = new Map<number, number>();
  private planetWobbleFrac = new Map<number, number>();

  onRingHit: ((event: RingHitEvent) => void) | null = null;
  onBallLost: (() => void) | null = null;

  constructor(width: number, height: number) {
    this.resize(width, height);
    this.reset();
  }

  reset(): void {
    this.score = 0;
    this.timeRemaining = SESSION_SECONDS;
    this.isOver = false;
    this.combo = 0;
    this.ball = null;
    this.ballReady = true;
    this.respawnTimer = 0;
    this.elapsed = 0;
    this.initPlanets();
    this.rings = [];
    while (this.rings.length < RING_COUNT) {
      this.rings.push(this.spawnRing());
    }
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const scaleX = this.width > 0 ? width / this.width : 1;
    const scaleY = this.height > 0 ? height / this.height : 1;
    const hasPrevSize = this.width > 0 && this.height > 0;

    this.width = width;
    this.height = height;

    const minDim = Math.min(width, height);
    this.padX = width * 0.13;
    this.padY = height * 0.85;
    this.padRadius = minDim * 0.03;
    this.ballRadius = minDim * 0.014;
    this.maxDrag = minDim * 0.32;
    this.maxSpeed = minDim * 1.2;

    if (this.planets.length > 0) {
      this.recomputePlanetSizes(minDim);
    }

    for (const ring of this.rings) {
      ring.radius = minDim * RING_RADIUS_FRAC;
    }

    if (hasPrevSize && (scaleX !== 1 || scaleY !== 1)) {
      for (const ring of this.rings) {
        ring.x *= scaleX;
        ring.y *= scaleY;
      }
      if (this.ball) {
        this.ball.x *= scaleX;
        this.ball.y *= scaleY;
        for (const point of this.ball.trail) {
          point.x *= scaleX;
          point.y *= scaleY;
        }
      }
    }

    this.updatePlanetPositions();
  }

  private recomputePlanetSizes(minDim: number): void {
    for (const planet of this.planets) {
      const frac = this.planetRadiusFrac.get(planet.id) ?? 0.06;
      planet.radius = minDim * frac;
      const strength = this.planetStrength.get(planet.id) ?? 1;
      planet.mass = planet.radius * planet.radius * MASS_COEF * strength;
      planet.wobbleAmp = minDim * (this.planetWobbleFrac.get(planet.id) ?? 0);
    }
  }

  private initPlanets(): void {
    this.planetRadiusFrac.clear();
    this.planetStrength.clear();
    this.planetWobbleFrac.clear();

    const defs: Array<{
      fx: number;
      fy: number;
      radiusFrac: number;
      strength: number;
      wobbleFrac: number;
      wobbleSpeed: number;
    }> = [
      { fx: 0.58, fy: 0.3, radiusFrac: 0.075, strength: 1, wobbleFrac: 0, wobbleSpeed: 0 },
      { fx: 0.83, fy: 0.66, radiusFrac: 0.05, strength: 0.75, wobbleFrac: 0.05, wobbleSpeed: 0.55 },
      { fx: 0.34, fy: 0.62, radiusFrac: 0.04, strength: 0.55, wobbleFrac: 0, wobbleSpeed: 0 },
    ];

    const minDim = Math.min(this.width, this.height);
    this.planets = defs.map((def) => {
      const id = nextId++;
      this.planetRadiusFrac.set(id, def.radiusFrac);
      this.planetStrength.set(id, def.strength);
      this.planetWobbleFrac.set(id, def.wobbleFrac);
      const radius = minDim * def.radiusFrac;
      return {
        id,
        fx: def.fx,
        fy: def.fy,
        radius,
        mass: radius * radius * MASS_COEF * def.strength,
        wobbleAmp: minDim * def.wobbleFrac,
        wobbleSpeed: def.wobbleSpeed,
        wobblePhase: randRange(0, Math.PI * 2),
        x: 0,
        y: 0,
      };
    });
    this.updatePlanetPositions();
  }

  private updatePlanetPositions(): void {
    for (const planet of this.planets) {
      const baseX = this.width * planet.fx;
      const baseY = this.height * planet.fy;
      if (planet.wobbleAmp > 0) {
        const t = this.elapsed * planet.wobbleSpeed + planet.wobblePhase;
        planet.x = baseX + Math.cos(t) * planet.wobbleAmp;
        planet.y = baseY + Math.sin(t) * planet.wobbleAmp * 0.6;
      } else {
        planet.x = baseX;
        planet.y = baseY;
      }
    }
  }

  private spawnRing(): Ring {
    const minDim = Math.min(this.width, this.height);
    const radius = minDim * RING_RADIUS_FRAC;
    const minSpacing = minDim * 0.15;
    let best: { x: number; y: number } | null = null;
    let bestScore = -Infinity;

    for (let attempt = 0; attempt < 24; attempt++) {
      const x = randRange(this.width * 0.42, this.width * 0.95);
      const y = randRange(this.height * 0.1, this.height * 0.9);
      let nearest = Infinity;
      for (const planet of this.planets) {
        nearest = Math.min(nearest, Math.hypot(x - planet.x, y - planet.y) - planet.radius);
      }
      for (const ring of this.rings) {
        nearest = Math.min(nearest, Math.hypot(x - ring.x, y - ring.y));
      }
      nearest = Math.min(nearest, Math.hypot(x - this.padX, y - this.padY));
      if (nearest > bestScore) {
        bestScore = nearest;
        best = { x, y };
      }
      if (nearest > minSpacing) break;
    }

    const point = best ?? { x: this.width * 0.7, y: this.height * 0.4 };
    return { id: nextId++, x: point.x, y: point.y, radius };
  }

  /** ドラッグ量やキー入力から求めた発射速度で、当たり判定なしの予測軌道を計算する。 */
  previewTrajectory(vx: number, vy: number): { x: number; y: number }[] {
    const points: { x: number; y: number }[] = [];
    let x = this.padX;
    let y = this.padY;
    let sx = vx;
    let sy = vy;

    for (let i = 0; i < PREVIEW_STEPS; i++) {
      const acc = this.gravityAt(x, y);
      sx += acc.ax * PREVIEW_DT;
      sy += acc.ay * PREVIEW_DT;
      x += sx * PREVIEW_DT;
      y += sy * PREVIEW_DT;
      points.push({ x, y });

      if (x < -20 || x > this.width + 20 || y < -20 || y > this.height + 20) break;
      if (this.planets.some((p) => Math.hypot(x - p.x, y - p.y) < p.radius)) break;
    }
    return points;
  }

  launch(vx: number, vy: number): void {
    if (!this.ballReady || this.isOver) return;
    this.ballReady = false;
    this.combo = 0;
    this.ball = {
      x: this.padX,
      y: this.padY,
      vx,
      vy,
      trail: [],
    };
  }

  private gravityAt(x: number, y: number): { ax: number; ay: number } {
    let ax = 0;
    let ay = 0;
    for (const planet of this.planets) {
      const dx = planet.x - x;
      const dy = planet.y - y;
      const distSq = Math.max(dx * dx + dy * dy, (planet.radius * 0.9) ** 2);
      const dist = Math.sqrt(distSq);
      const accel = planet.mass / distSq;
      ax += (accel * dx) / dist;
      ay += (accel * dy) / dist;
    }
    return { ax, ay };
  }

  private destroyBall(): void {
    this.ball = null;
    this.combo = 0;
    this.respawnTimer = RESPAWN_DELAY;
    this.onBallLost?.();
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    this.timeRemaining = Math.max(0, this.timeRemaining - deltaSeconds);
    this.elapsed += deltaSeconds;
    if (this.timeRemaining <= 0) {
      this.isOver = true;
      return;
    }

    this.updatePlanetPositions();

    if (!this.ball && !this.ballReady) {
      this.respawnTimer -= deltaSeconds;
      if (this.respawnTimer <= 0) this.ballReady = true;
    }

    const ball = this.ball;
    if (!ball) return;

    const acc = this.gravityAt(ball.x, ball.y);
    ball.vx += acc.ax * deltaSeconds;
    ball.vy += acc.ay * deltaSeconds;
    ball.x += ball.vx * deltaSeconds;
    ball.y += ball.vy * deltaSeconds;

    ball.trail.push({ x: ball.x, y: ball.y });
    if (ball.trail.length > TRAIL_MAX_POINTS) ball.trail.shift();

    for (const planet of this.planets) {
      if (Math.hypot(ball.x - planet.x, ball.y - planet.y) < planet.radius + this.ballRadius) {
        this.destroyBall();
        return;
      }
    }

    const margin = 40;
    if (
      ball.x < -margin ||
      ball.x > this.width + margin ||
      ball.y < -margin ||
      ball.y > this.height + margin
    ) {
      this.destroyBall();
      return;
    }

    for (const ring of this.rings) {
      if (Math.hypot(ball.x - ring.x, ball.y - ring.y) < ring.radius) {
        const points = BASE_POINTS + this.combo * COMBO_BONUS;
        this.score += points;
        this.onRingHit?.({ ring, points, combo: this.combo });
        this.combo += 1;

        const index = this.rings.indexOf(ring);
        this.rings.splice(index, 1);
        this.rings.push(this.spawnRing());
        break;
      }
    }
  }
}
