export interface Ant {
  /** 出現ごとに振られる連番。描画・テストでの安定した識別に使う。 */
  id: number;
  x: number;
  y: number;
  isCarryingFood: boolean;
  /** 餌を拾った瞬間の距離から決まる、持ち帰った時に入るスコア。 */
  carryPoints: number;
}

export interface TrailPoint {
  x: number;
  y: number;
  life: number;
}

export interface Food {
  x: number;
  y: number;
}

export interface Predator {
  x: number;
  y: number;
}

export interface Nest {
  x: number;
  y: number;
  radius: number;
}

export interface DeliverEvent {
  points: number;
  deliveries: number;
}

export interface AntEatenEvent {
  isCarryingFood: boolean;
}

export interface ColonyLostEvent {
  score: number;
}

export const NEST_RADIUS = 60;
export const ANT_RADIUS = 7;
export const PREDATOR_RADIUS = 16;
export const FOOD_RADIUS = 10;
export const PICKUP_RADIUS = ANT_RADIUS + FOOD_RADIUS;
export const CATCH_RADIUS = ANT_RADIUS + PREDATOR_RADIUS;
export const TRAIL_SNIFF_RADIUS = 36;
export const TRAIL_MIN_SPACING = 18;
export const TRAIL_MAX_LIFE = 9;
export const MAX_ANTS = 5;
export const COLONY_HEALTH_MAX = 100;

const TRAIL_DECAY_PER_SECOND = 1;
const TRAIL_MAX_POINTS = 400;
const BASE_SPEED = 45;
const TRAIL_SPEED = 150;
const ANT_SPAWN_INTERVAL = 1.4;
const PREDATOR_SPEED = 65;
const DAMAGE_PER_EATEN = 18;
const HEAL_PER_DELIVERY = 6;
const FOOD_MIN_DIST_BASE = 150;
const FOOD_MIN_DIST_PER_DELIVERY = 14;
const FOOD_SPAWN_MARGIN = 36;
const FOOD_SPAWN_MAX_ATTEMPTS = 20;
const DELIVER_BASE_POINTS = 100;
const DISTANCE_BONUS_PER_PIXEL = 0.4;

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * 蟻の巣を中心に、フェロモンの道をプレイヤーが描いて餌運びを導くリアルタイム
 * 蟻コロニーシミュレーションの純粋ロジック層。React / pixi.js には依存しない。
 *
 * 蟻は常に目的地（未回収なら餌、回収済みなら巣）へ直進するが、近くに新鮮な
 * トレイル点があるときだけ速く進める。トレイルは時間で消えるため、プレイヤーは
 * 描き直し続ける必要がある。捕食者は最も近い蟻を追い、捕まえるとコロニーの
 * 体力を削る。体力が尽きるとラウンドが終わる。
 */
export class ScentTrailWorld {
  width = 0;
  height = 0;
  nest: Nest = { x: 0, y: 0, radius: NEST_RADIUS };
  ants: Ant[] = [];
  trail: TrailPoint[] = [];
  food: Food = { x: 0, y: 0 };
  predator: Predator = { x: 0, y: 0 };
  colonyHealth = COLONY_HEALTH_MAX;
  score = 0;
  deliveries = 0;
  isOver = false;

  private isPainting = false;
  private paintTargetX = 0;
  private paintTargetY = 0;
  private spawnTimer = 0;
  private nextAntId = 0;

  onDeliver: ((event: DeliverEvent) => void) | null = null;
  onAntEaten: ((event: AntEatenEvent) => void) | null = null;
  onColonyLost: ((event: ColonyLostEvent) => void) | null = null;

  constructor(width: number, height: number) {
    this.resize(width, height);
    this.reset();
  }

  reset(): void {
    this.nest = { x: this.width / 2, y: this.height / 2, radius: NEST_RADIUS };
    this.ants = [];
    this.trail = [];
    this.predator = { x: this.width * 0.08, y: this.height * 0.08 };
    this.colonyHealth = COLONY_HEALTH_MAX;
    this.score = 0;
    this.deliveries = 0;
    this.isOver = false;
    this.isPainting = false;
    this.spawnTimer = 0;
    this.nextAntId = 0;
    this.food = this.spawnFood();
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const scaleX = this.width > 0 ? width / this.width : 1;
    const scaleY = this.height > 0 ? height / this.height : 1;
    if (this.width > 0 && this.height > 0) {
      this.nest.x *= scaleX;
      this.nest.y *= scaleY;
      this.predator.x *= scaleX;
      this.predator.y *= scaleY;
      this.food.x *= scaleX;
      this.food.y *= scaleY;
      this.paintTargetX *= scaleX;
      this.paintTargetY *= scaleY;
      for (const ant of this.ants) {
        ant.x *= scaleX;
        ant.y *= scaleY;
      }
      for (const point of this.trail) {
        point.x *= scaleX;
        point.y *= scaleY;
      }
    }
    this.width = width;
    this.height = height;
  }

  /** ドラッグ/長押し中のポインタ位置、またはキーボード操作のブラシ位置を渡す。 */
  setPaintTarget(x: number, y: number): void {
    this.paintTargetX = clamp(x, 0, this.width);
    this.paintTargetY = clamp(y, 0, this.height);
  }

  setPainting(isActive: boolean): void {
    this.isPainting = isActive;
  }

  private randomFarPosition(
    fromX: number,
    fromY: number,
    minDist: number,
  ): { x: number; y: number } {
    let best = { x: this.width / 2, y: this.height / 2 };
    let bestDist = -1;
    for (let attempt = 0; attempt < FOOD_SPAWN_MAX_ATTEMPTS; attempt++) {
      const x = randRange(
        FOOD_SPAWN_MARGIN,
        Math.max(FOOD_SPAWN_MARGIN, this.width - FOOD_SPAWN_MARGIN),
      );
      const y = randRange(
        FOOD_SPAWN_MARGIN,
        Math.max(FOOD_SPAWN_MARGIN, this.height - FOOD_SPAWN_MARGIN),
      );
      const dist = Math.hypot(x - fromX, y - fromY);
      if (dist >= minDist) return { x, y };
      if (dist > bestDist) {
        bestDist = dist;
        best = { x, y };
      }
    }
    return best;
  }

  private spawnFood(): Food {
    const minDist = FOOD_MIN_DIST_BASE + this.deliveries * FOOD_MIN_DIST_PER_DELIVERY;
    return this.randomFarPosition(this.nest.x, this.nest.y, minDist);
  }

  private addOrRefreshTrailPoint(x: number, y: number): void {
    let nearest: TrailPoint | null = null;
    let nearestDist = Number.POSITIVE_INFINITY;
    for (const point of this.trail) {
      const dist = Math.hypot(point.x - x, point.y - y);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = point;
      }
    }
    if (nearest && nearestDist < TRAIL_MIN_SPACING) {
      nearest.life = TRAIL_MAX_LIFE;
      return;
    }
    this.trail.push({ x, y, life: TRAIL_MAX_LIFE });
    if (this.trail.length > TRAIL_MAX_POINTS) this.trail.shift();
  }

  private hasNearbyTrail(x: number, y: number): boolean {
    for (const point of this.trail) {
      if (Math.hypot(point.x - x, point.y - y) < TRAIL_SNIFF_RADIUS) return true;
    }
    return false;
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    for (const point of this.trail) point.life -= TRAIL_DECAY_PER_SECOND * deltaSeconds;
    this.trail = this.trail.filter((point) => point.life > 0);

    if (this.isPainting) this.addOrRefreshTrailPoint(this.paintTargetX, this.paintTargetY);

    this.spawnTimer -= deltaSeconds;
    if (this.spawnTimer <= 0 && this.ants.length < MAX_ANTS) {
      this.ants.push({
        id: this.nextAntId++,
        x: this.nest.x,
        y: this.nest.y,
        isCarryingFood: false,
        carryPoints: 0,
      });
      this.spawnTimer = ANT_SPAWN_INTERVAL;
    }

    for (const ant of this.ants) {
      const goalX = ant.isCarryingFood ? this.nest.x : this.food.x;
      const goalY = ant.isCarryingFood ? this.nest.y : this.food.y;
      const dx = goalX - ant.x;
      const dy = goalY - ant.y;
      const dist = Math.max(Math.hypot(dx, dy), 1);
      const speed = this.hasNearbyTrail(ant.x, ant.y) ? TRAIL_SPEED : BASE_SPEED;
      ant.x = clamp(ant.x + (dx / dist) * speed * deltaSeconds, 0, this.width);
      ant.y = clamp(ant.y + (dy / dist) * speed * deltaSeconds, 0, this.height);

      if (
        !ant.isCarryingFood &&
        Math.hypot(ant.x - this.food.x, ant.y - this.food.y) < PICKUP_RADIUS
      ) {
        const distFromNest = Math.hypot(this.food.x - this.nest.x, this.food.y - this.nest.y);
        ant.isCarryingFood = true;
        ant.carryPoints = Math.round(DELIVER_BASE_POINTS + distFromNest * DISTANCE_BONUS_PER_PIXEL);
        this.food = this.spawnFood();
      } else if (
        ant.isCarryingFood &&
        Math.hypot(ant.x - this.nest.x, ant.y - this.nest.y) < this.nest.radius
      ) {
        this.score += ant.carryPoints;
        this.deliveries += 1;
        this.colonyHealth = Math.min(COLONY_HEALTH_MAX, this.colonyHealth + HEAL_PER_DELIVERY);
        this.onDeliver?.({ points: ant.carryPoints, deliveries: this.deliveries });
        ant.isCarryingFood = false;
        ant.carryPoints = 0;
      }
    }

    // 捕食者は常に最も近い蟻へ直進する。蟻が1匹もいない間は次の出現地点である巣へ向かう。
    let targetX = this.nest.x;
    let targetY = this.nest.y;
    let nearestAntDist = Number.POSITIVE_INFINITY;
    for (const ant of this.ants) {
      const dist = Math.hypot(ant.x - this.predator.x, ant.y - this.predator.y);
      if (dist < nearestAntDist) {
        nearestAntDist = dist;
        targetX = ant.x;
        targetY = ant.y;
      }
    }
    const toTargetX = targetX - this.predator.x;
    const toTargetY = targetY - this.predator.y;
    const toTargetDist = Math.max(Math.hypot(toTargetX, toTargetY), 1);
    this.predator.x = clamp(
      this.predator.x + (toTargetX / toTargetDist) * PREDATOR_SPEED * deltaSeconds,
      PREDATOR_RADIUS,
      this.width - PREDATOR_RADIUS,
    );
    this.predator.y = clamp(
      this.predator.y + (toTargetY / toTargetDist) * PREDATOR_SPEED * deltaSeconds,
      PREDATOR_RADIUS,
      this.height - PREDATOR_RADIUS,
    );

    this.ants = this.ants.filter((ant) => {
      const isCaught = Math.hypot(ant.x - this.predator.x, ant.y - this.predator.y) < CATCH_RADIUS;
      if (!isCaught) return true;
      this.colonyHealth = Math.max(0, this.colonyHealth - DAMAGE_PER_EATEN);
      this.onAntEaten?.({ isCarryingFood: ant.isCarryingFood });
      return false;
    });

    if (this.colonyHealth <= 0) {
      this.colonyHealth = 0;
      this.isOver = true;
      this.onColonyLost?.({ score: this.score });
    }
  }
}
