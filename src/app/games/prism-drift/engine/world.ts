import { add, distanceToSegment, normalize, reflect, scale, sub, type Vec2 } from "./vec2.ts";

export type PrismType = "mirror" | "splitter";

export interface Prism {
  id: number;
  type: PrismType;
  x: number;
  y: number;
  radius: number;
}

export interface Target {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  charge: number;
  /** このフレームでビームに当たっているか。描画側の演出に使う。 */
  isIlluminated: boolean;
}

export interface BeamSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** 反射/分岐で生まれた何本目の光かで濃さを変えるための深さ。 */
  depth: number;
}

export interface TargetCompletedEvent {
  target: Target;
  points: number;
  combo: number;
}

const CHARGE_RATE = 55; // %/秒
const DECAY_RATE = 22; // %/秒
const BASE_POINTS = 100;
const COMBO_BONUS_PER_EXTRA = 60;
const MAX_BOUNCE_DEPTH = 5;
const MAX_SEGMENTS = 20;
const EPSILON = 0.5;
const TARGET_RADIUS = 22;
const PRISM_RADIUS = 26;
export const ROUND_SECONDS = 90;

let nextId = 1;

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export class PrismDriftWorld {
  width = 0;
  height = 0;
  prisms: Prism[] = [];
  targets: Target[] = [];
  score = 0;
  timeRemaining = ROUND_SECONDS;
  isOver = false;
  lastSegments: BeamSegment[] = [];
  private difficulty = 1;

  onTargetCompleted: ((event: TargetCompletedEvent) => void) | null = null;

  constructor(width: number, height: number) {
    this.resize(width, height);
    this.reset();
  }

  reset(): void {
    this.score = 0;
    this.timeRemaining = ROUND_SECONDS;
    this.isOver = false;
    this.difficulty = 1;
    this.prisms = [
      {
        id: nextId++,
        type: "splitter",
        x: this.width * 0.32,
        y: this.height * 0.5,
        radius: PRISM_RADIUS,
      },
      {
        id: nextId++,
        type: "mirror",
        x: this.width * 0.5,
        y: this.height * 0.28,
        radius: PRISM_RADIUS,
      },
      {
        id: nextId++,
        type: "mirror",
        x: this.width * 0.5,
        y: this.height * 0.72,
        radius: PRISM_RADIUS,
      },
      {
        id: nextId++,
        type: "splitter",
        x: this.width * 0.68,
        y: this.height * 0.5,
        radius: PRISM_RADIUS,
      },
    ];
    this.targets = [this.spawnTarget(), this.spawnTarget(), this.spawnTarget()];
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const scaleX = this.width > 0 ? width / this.width : 1;
    const scaleY = this.height > 0 ? height / this.height : 1;
    if (this.width > 0 && this.height > 0) {
      for (const prism of this.prisms) {
        prism.x *= scaleX;
        prism.y *= scaleY;
      }
      for (const target of this.targets) {
        target.x *= scaleX;
        target.y *= scaleY;
      }
    }
    this.width = width;
    this.height = height;
  }

  setPrismPosition(id: number, x: number, y: number): void {
    const prism = this.prisms.find((p) => p.id === id);
    if (!prism) return;
    const margin = prism.radius;
    prism.x = Math.min(Math.max(x, margin), this.width - margin);
    prism.y = Math.min(Math.max(y, margin), this.height - margin);
  }

  cyclePrismType(id: number): void {
    const prism = this.prisms.find((p) => p.id === id);
    if (!prism) return;
    prism.type = prism.type === "mirror" ? "splitter" : "mirror";
  }

  findPrismAt(x: number, y: number): Prism | undefined {
    return this.prisms.find((p) => Math.hypot(p.x - x, p.y - y) <= p.radius + 8);
  }

  private spawnTarget(): Target {
    const speed = randRange(18, 34) * this.difficulty;
    const angle = randRange(0, Math.PI * 2);
    return {
      id: nextId++,
      x: randRange(this.width * 0.55, this.width * 0.92),
      y: randRange(this.height * 0.15, this.height * 0.85),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: TARGET_RADIUS,
      charge: 0,
      isIlluminated: false,
    };
  }

  private emitterOrigin(): Vec2 {
    return { x: 0, y: this.height / 2 };
  }

  computeBeamSegments(): BeamSegment[] {
    const segments: BeamSegment[] = [];
    this.traceBeam(this.emitterOrigin(), { x: 1, y: 0 }, 0, segments);
    return segments;
  }

  private traceBeam(origin: Vec2, dir: Vec2, depth: number, out: BeamSegment[]): void {
    if (depth > MAX_BOUNCE_DEPTH || out.length >= MAX_SEGMENTS) return;

    let nearestT = this.boundsExitT(origin, dir);
    let hitPrism: Prism | null = null;

    for (const prism of this.prisms) {
      const t = this.raySphereT(origin, dir, prism);
      if (t !== null && t < nearestT) {
        nearestT = t;
        hitPrism = prism;
      }
    }

    const end: Vec2 = { x: origin.x + dir.x * nearestT, y: origin.y + dir.y * nearestT };
    out.push({ x1: origin.x, y1: origin.y, x2: end.x, y2: end.y, depth });

    if (!hitPrism) return;

    const normal = normalize(sub(end, { x: hitPrism.x, y: hitPrism.y }));
    const reflectedDir = reflect(dir, normal);

    if (hitPrism.type === "splitter") {
      const transmittedOrigin = add(end, scale(dir, EPSILON));
      this.traceBeam(transmittedOrigin, dir, depth + 1, out);
    }

    const reflectedOrigin = add(end, scale(reflectedDir, EPSILON));
    this.traceBeam(reflectedOrigin, reflectedDir, depth + 1, out);
  }

  private raySphereT(origin: Vec2, dir: Vec2, prism: Prism): number | null {
    const oc = sub(origin, { x: prism.x, y: prism.y });
    const b = 2 * (oc.x * dir.x + oc.y * dir.y);
    const c = oc.x * oc.x + oc.y * oc.y - prism.radius * prism.radius;
    const disc = b * b - 4 * c;
    if (disc < 0) return null;
    const sqrtDisc = Math.sqrt(disc);
    const t1 = (-b - sqrtDisc) / 2;
    const t2 = (-b + sqrtDisc) / 2;
    const t = t1 > EPSILON ? t1 : t2;
    return t > EPSILON ? t : null;
  }

  private boundsExitT(origin: Vec2, dir: Vec2): number {
    let t = Number.POSITIVE_INFINITY;
    if (dir.x > 1e-6) t = Math.min(t, (this.width - origin.x) / dir.x);
    if (dir.x < -1e-6) t = Math.min(t, -origin.x / dir.x);
    if (dir.y > 1e-6) t = Math.min(t, (this.height - origin.y) / dir.y);
    if (dir.y < -1e-6) t = Math.min(t, -origin.y / dir.y);
    return Number.isFinite(t) ? t : 0;
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    this.timeRemaining = Math.max(0, this.timeRemaining - deltaSeconds);
    if (this.timeRemaining <= 0) {
      this.isOver = true;
      return;
    }

    for (const target of this.targets) {
      target.x += target.vx * deltaSeconds;
      target.y += target.vy * deltaSeconds;
      if (target.x < target.radius || target.x > this.width - target.radius) {
        target.vx *= -1;
        target.x = Math.min(Math.max(target.x, target.radius), this.width - target.radius);
      }
      if (target.y < target.radius || target.y > this.height - target.radius) {
        target.vy *= -1;
        target.y = Math.min(Math.max(target.y, target.radius), this.height - target.radius);
      }
    }

    const segments = this.computeBeamSegments();
    this.lastSegments = segments;
    for (const target of this.targets) {
      const center = { x: target.x, y: target.y };
      target.isIlluminated = segments.some(
        (seg) =>
          distanceToSegment(center, { x: seg.x1, y: seg.y1 }, { x: seg.x2, y: seg.y2 }) <=
          target.radius,
      );
    }

    const illuminatedCount = this.targets.filter((t) => t.isIlluminated).length;

    for (const target of this.targets) {
      if (target.isIlluminated) {
        target.charge = Math.min(100, target.charge + CHARGE_RATE * deltaSeconds);
      } else {
        target.charge = Math.max(0, target.charge - DECAY_RATE * deltaSeconds);
      }

      if (target.charge >= 100) {
        const combo = Math.max(0, illuminatedCount - 1);
        const points = BASE_POINTS + combo * COMBO_BONUS_PER_EXTRA;
        this.score += points;
        this.onTargetCompleted?.({ target, points, combo });

        this.difficulty = Math.min(2.2, this.difficulty + 0.06);
        const respawned = this.spawnTarget();
        target.x = respawned.x;
        target.y = respawned.y;
        target.vx = respawned.vx;
        target.vy = respawned.vy;
        target.charge = 0;
        target.isIlluminated = false;
      }
    }
  }
}
