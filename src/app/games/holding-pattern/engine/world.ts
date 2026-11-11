export interface Plane {
  readonly id: number;
  x: number;
  y: number;
  heading: number;
  targetHeading: number;
  readonly speed: number;
  fuel: number;
}

interface RunwayDefinition {
  readonly label: string;
  readonly heading: number;
  readonly centerXRatio: number;
  readonly centerYRatio: number;
  readonly widthRatio: number;
  readonly heightRatio: number;
  readonly beaconXRatio: number;
  readonly beaconYRatio: number;
}

export interface Runway {
  readonly label: string;
  readonly heading: number;
  x: number;
  y: number;
  width: number;
  height: number;
  beaconX: number;
  beaconY: number;
}

export interface LandEvent {
  readonly planeId: number;
  readonly runwayLabel: string;
  readonly points: number;
  readonly streak: number;
  readonly x: number;
  readonly y: number;
}

export type IncidentReason = "fuel" | "collision";

export interface IncidentEvent {
  readonly reason: IncidentReason;
  readonly planeIds: readonly number[];
  readonly x: number;
  readonly y: number;
}

export const PLANE_RADIUS = 14;
export const PLANE_SPEED = 95;
export const TURN_RATE = 3.2;
export const FUEL_MAX = 40;
export const COLLISION_DISTANCE = PLANE_RADIUS * 2 + 16;
export const MAX_STRIKES = 3;
export const MAX_PLANES = 6;
export const RUNWAY_HEADING_TOLERANCE = 0.6;

const LAND_BASE_POINTS = 160;
const LAND_STREAK_BONUS = 35;
const INITIAL_SPAWN_INTERVAL = 3;
const MIN_SPAWN_INTERVAL = 1.3;
const SPAWN_INTERVAL_DECAY_PER_SUCCESS = 0.15;
const SPAWN_EDGE_MARGIN = 24;
const SPAWN_HEADING_SPREAD = 0.5;
// 誘導されないまままっすぐ飛んで、出現からこの秒数以内に滑走路へ入ってしまう出現は引き直す
// (プレイヤーが触る前に勝手に着陸して得点が入るため)。それより後に偶然向きが揃って
// 着陸するのはゲームの一部として残す。
const UNGUIDED_LANDING_GRACE_SECONDS = 3;
const SPAWN_REROLL_ATTEMPTS = 8;

/**
 * 進入方位は往復どちらの向きでもよい(滑走路の軸と機体の向きが揃っていればよい)ため、
 * ランウェイは一方向の`heading`だけを持ち、判定は軸(mod π)で行う。
 */
const RUNWAY_DEFINITIONS: readonly RunwayDefinition[] = [
  {
    label: "東ランウェイ",
    heading: 0,
    centerXRatio: 0.72,
    centerYRatio: 0.32,
    widthRatio: 0.46,
    heightRatio: 0.34,
    beaconXRatio: 0.97,
    beaconYRatio: 0.32,
  },
  {
    label: "南ランウェイ",
    heading: Math.PI / 2,
    centerXRatio: 0.28,
    centerYRatio: 0.78,
    widthRatio: 0.34,
    heightRatio: 0.46,
    beaconXRatio: 0.28,
    beaconYRatio: 0.98,
  },
];

function normalizeAngle(angle: number): number {
  let normalized = angle % (Math.PI * 2);
  if (normalized > Math.PI) normalized -= Math.PI * 2;
  if (normalized < -Math.PI) normalized += Math.PI * 2;
  return normalized;
}

function turnToward(current: number, target: number, maxDelta: number): number {
  const diff = normalizeAngle(target - current);
  if (Math.abs(diff) <= maxDelta) return normalizeAngle(target);
  return normalizeAngle(current + Math.sign(diff) * maxDelta);
}

/** headingがrunwayHeadingの軸(mod π)からどれだけずれているか(0〜π/2)を返す。 */
function headingAxisOffset(heading: number, runwayHeading: number): number {
  let diff = normalizeAngle(heading - runwayHeading);
  if (diff > Math.PI / 2) diff -= Math.PI;
  else if (diff < -Math.PI / 2) diff += Math.PI;
  return Math.abs(diff);
}

function randRange(min: number, max: number, randomFn: () => number): number {
  return min + randomFn() * (max - min);
}

interface EdgeSpawn {
  x: number;
  y: number;
  heading: number;
}

function randomEdgeSpawn(width: number, height: number, randomFn: () => number): EdgeSpawn {
  const edge = Math.floor(randRange(0, 4, randomFn));
  let x: number;
  let y: number;
  if (edge === 0) {
    x = randRange(0, width, randomFn);
    y = -SPAWN_EDGE_MARGIN;
  } else if (edge === 1) {
    x = width + SPAWN_EDGE_MARGIN;
    y = randRange(0, height, randomFn);
  } else if (edge === 2) {
    x = randRange(0, width, randomFn);
    y = height + SPAWN_EDGE_MARGIN;
  } else {
    x = -SPAWN_EDGE_MARGIN;
    y = randRange(0, height, randomFn);
  }
  const towardCenter = Math.atan2(height / 2 - y, width / 2 - x);
  const heading = normalizeAngle(
    towardCenter + randRange(-SPAWN_HEADING_SPREAD, SPAWN_HEADING_SPREAD, randomFn),
  );
  return { x, y, heading };
}

/**
 * 複数の機体を同時に誘導し、滑走路の軸に方位を揃えて着陸させ続けるリアルタイム
 * 航空管制パズルの純粋ロジック層。React / pixi.js には依存しない。
 *
 * 機体は目標方位(targetHeading)へ有限の旋回速度(TURN_RATE)で近づいていくため、
 * 直接instantに向きを変えることはできない(事前に狙いを定める必要がある)。
 */
export class HoldingPatternWorld {
  width = 0;
  height = 0;
  runways: Runway[] = [];

  score = 0;
  streak = 0;
  strikes = 0;
  isOver = false;

  onLand: ((event: LandEvent) => void) | null = null;
  onIncident: ((event: IncidentEvent) => void) | null = null;

  private _planes: Plane[] = [];
  private spawnTimer = 0;
  private successCount = 0;
  private nextId = 0;
  private readonly randomFn: () => number;

  /** randomFn を差し替えられるのはテストで決定的な出現位置を再現するため(本番は Math.random)。 */
  constructor(width: number, height: number, randomFn: () => number = Math.random) {
    this.randomFn = randomFn;
    this.resize(width, height);
    this.reset();
  }

  get planes(): readonly Plane[] {
    return this._planes;
  }

  get spawnInterval(): number {
    return Math.max(
      MIN_SPAWN_INTERVAL,
      INITIAL_SPAWN_INTERVAL - this.successCount * SPAWN_INTERVAL_DECAY_PER_SUCCESS,
    );
  }

  reset(): void {
    this._planes = [];
    this.spawnTimer = 0;
    this.successCount = 0;
    this.nextId = 0;
    this.score = 0;
    this.streak = 0;
    this.strikes = 0;
    this.isOver = false;
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const scaleX = this.width > 0 ? width / this.width : 1;
    const scaleY = this.height > 0 ? height / this.height : 1;
    if (this.width > 0 && this.height > 0) {
      for (const plane of this._planes) {
        plane.x *= scaleX;
        plane.y *= scaleY;
      }
    }
    this.width = width;
    this.height = height;
    this.runways = RUNWAY_DEFINITIONS.map((def) => ({
      label: def.label,
      heading: def.heading,
      x: width * def.centerXRatio,
      y: height * def.centerYRatio,
      width: width * def.widthRatio,
      height: height * def.heightRatio,
      beaconX: width * def.beaconXRatio,
      beaconY: height * def.beaconYRatio,
    }));
  }

  /** ドラッグ等で狙った方角(ラジアン)を目標方位として設定する。即座には向きは変わらない。 */
  setPlaneTargetHeading(planeId: number, heading: number): void {
    if (this.isOver) return;
    const plane = this._planes.find((p) => p.id === planeId);
    if (plane) plane.targetHeading = normalizeAngle(heading);
  }

  /** キーボードで目標方位を少しずつ回す。deltaRadiansは1フレーム分の回転量。 */
  rotatePlaneTargetHeading(planeId: number, deltaRadians: number): void {
    if (this.isOver) return;
    const plane = this._planes.find((p) => p.id === planeId);
    if (plane) plane.targetHeading = normalizeAngle(plane.targetHeading + deltaRadians);
  }

  /** 残り燃料が最も少ない機体のidを返す。1機も無ければnull。キーボード操作用。 */
  mostUrgentPlaneId(): number | null {
    let best: Plane | null = null;
    for (const plane of this._planes) {
      if (!best || plane.fuel < best.fuel) best = plane;
    }
    return best?.id ?? null;
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    for (const plane of this._planes) {
      plane.heading = turnToward(plane.heading, plane.targetHeading, TURN_RATE * deltaSeconds);
      plane.x += Math.cos(plane.heading) * plane.speed * deltaSeconds;
      plane.y += Math.sin(plane.heading) * plane.speed * deltaSeconds;
      plane.fuel -= deltaSeconds;
    }

    this.resolveCollisions();
    if (this.isOver) return;
    this.resolveLandings();
    if (this.isOver) return;
    this.resolveFuelOuts();
    if (this.isOver) return;

    this.spawnTimer -= deltaSeconds;
    if (this.spawnTimer <= 0) {
      this.trySpawn();
      this.spawnTimer = this.spawnInterval;
    }
  }

  private resolveCollisions(): void {
    const collidedIds = new Set<number>();
    const positionById = new Map<number, { x: number; y: number }>();
    for (let i = 0; i < this._planes.length; i++) {
      for (let j = i + 1; j < this._planes.length; j++) {
        const a = this._planes[i];
        const b = this._planes[j];
        if (Math.hypot(a.x - b.x, a.y - b.y) < COLLISION_DISTANCE) {
          collidedIds.add(a.id);
          collidedIds.add(b.id);
          positionById.set(a.id, { x: a.x, y: a.y });
          positionById.set(b.id, { x: b.x, y: b.y });
        }
      }
    }
    if (collidedIds.size === 0) return;

    const positions = Array.from(positionById.values());
    const x = positions.reduce((sum, p) => sum + p.x, 0) / positions.length;
    const y = positions.reduce((sum, p) => sum + p.y, 0) / positions.length;

    this._planes = this._planes.filter((p) => !collidedIds.has(p.id));
    this.streak = 0;
    this.strikes += 1;
    this.onIncident?.({ reason: "collision", planeIds: Array.from(collidedIds), x, y });
    if (this.strikes >= MAX_STRIKES) this.isOver = true;
  }

  private findLandingRunway(x: number, y: number, heading: number): Runway | undefined {
    return this.runways.find(
      (r) =>
        Math.abs(x - r.x) <= r.width / 2 &&
        Math.abs(y - r.y) <= r.height / 2 &&
        headingAxisOffset(heading, r.heading) <= RUNWAY_HEADING_TOLERANCE,
    );
  }

  private resolveLandings(): void {
    for (let i = this._planes.length - 1; i >= 0; i--) {
      const plane = this._planes[i];
      const runway = this.findLandingRunway(plane.x, plane.y, plane.heading);
      if (!runway) continue;

      const { x, y } = plane;
      this._planes.splice(i, 1);
      const points = LAND_BASE_POINTS + this.streak * LAND_STREAK_BONUS;
      this.score += points;
      this.streak += 1;
      this.successCount += 1;
      this.onLand?.({
        planeId: plane.id,
        runwayLabel: runway.label,
        points,
        streak: this.streak,
        x,
        y,
      });
    }
  }

  private resolveFuelOuts(): void {
    for (let i = this._planes.length - 1; i >= 0; i--) {
      const plane = this._planes[i];
      if (plane.fuel > 0) continue;

      const { x, y } = plane;
      this._planes.splice(i, 1);
      this.streak = 0;
      this.strikes += 1;
      this.onIncident?.({ reason: "fuel", planeIds: [plane.id], x, y });
      if (this.strikes >= MAX_STRIKES) {
        this.isOver = true;
        return;
      }
    }
  }

  private landsSoonWithoutGuidance(spawn: EdgeSpawn): boolean {
    const reach = PLANE_SPEED * UNGUIDED_LANDING_GRACE_SECONDS;
    for (let distance = 0; distance <= reach; distance += PLANE_RADIUS) {
      const x = spawn.x + Math.cos(spawn.heading) * distance;
      const y = spawn.y + Math.sin(spawn.heading) * distance;
      if (this.findLandingRunway(x, y, spawn.heading)) return true;
    }
    return false;
  }

  private trySpawn(): void {
    if (this._planes.length >= MAX_PLANES) return;
    let spawn = randomEdgeSpawn(this.width, this.height, this.randomFn);
    for (
      let attempt = 0;
      attempt < SPAWN_REROLL_ATTEMPTS && this.landsSoonWithoutGuidance(spawn);
      attempt++
    ) {
      spawn = randomEdgeSpawn(this.width, this.height, this.randomFn);
    }
    this._planes.push({
      id: this.nextId++,
      x: spawn.x,
      y: spawn.y,
      heading: spawn.heading,
      targetHeading: spawn.heading,
      speed: PLANE_SPEED,
      fuel: FUEL_MAX,
    });
  }
}
