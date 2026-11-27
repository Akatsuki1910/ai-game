export interface Ship {
  id: number;
  lane: number;
  x: number;
  y: number;
  vx: number;
  radius: number;
}

export interface Torpedo {
  id: number;
  x: number;
  y: number;
}

export interface ShipSunkEvent {
  ship: Ship;
  points: number;
  combo: number;
}

/** 遠距離→近距離の順の画面内y比率。遠いレーンほど魚雷の到達に時間がかかり、より多くのリードが要る。 */
export const LANE_RATIOS = [0.3, 0.52, 0.74] as const;
const SHIP_RADIUS = 24;
/** 魚雷の上昇速度(px/秒)。テスト側でもリード計算の正解値を出すために公開する。 */
export const TORPEDO_SPEED = 420;
const SHIP_SPEED_MIN = 46;
const SHIP_SPEED_MAX = 86;
const HIT_RADIUS = SHIP_RADIUS + 6;
const DETECTION_RATE = 30; // %/秒。約3.3秒で発見される。
const DETECTION_DECAY = 46; // %/秒。沈めるより早く下げられるので「のぞいて沈める」動きが成立する。
const RELOAD_SECONDS = 0.5;
const SPOTTED_COOLDOWN_SECONDS = 1.4;
const START_LIVES = 3;
const MAX_SHIPS = 6;
const SPAWN_INTERVAL_MIN = 0.65;
const SPAWN_INTERVAL_MAX = 1.7;
const SPAWN_INTERVAL_FLOOR = 0.35;
const DIFFICULTY_RAMP_SECONDS = 70;
const MAX_DIFFICULTY = 2.3;
const BASE_POINTS = 120;
const COMBO_BONUS_PER_HIT = 50;

let nextId = 1;

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export class PeriscopeStrikeWorld {
  width = 0;
  height = 0;
  ships: Ship[] = [];
  torpedoes: Torpedo[] = [];
  score = 0;
  combo = 0;
  lives = START_LIVES;
  detection = 0;
  isAiming = false;
  aimX = 0;
  reloadRemaining = 0;
  cooldownRemaining = 0;
  isOver = false;

  onShipSunk: ((event: ShipSunkEvent) => void) | null = null;
  onMiss: (() => void) | null = null;
  onSpotted: (() => void) | null = null;

  private laneYs: readonly number[] = LANE_RATIOS.map(() => 0);
  private elapsed = 0;
  private difficulty = 1;
  private spawnTimer = 0;

  constructor(width: number, height: number) {
    this.resize(width, height);
    this.reset();
  }

  reset(): void {
    this.score = 0;
    this.combo = 0;
    this.lives = START_LIVES;
    this.detection = 0;
    this.isAiming = false;
    this.reloadRemaining = 0;
    this.cooldownRemaining = 0;
    this.isOver = false;
    this.elapsed = 0;
    this.difficulty = 1;
    this.torpedoes = [];
    this.ships = [this.spawnShip(), this.spawnShip()];
    this.spawnTimer = randRange(SPAWN_INTERVAL_MIN, SPAWN_INTERVAL_MAX);
    this.aimX = this.width / 2;
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const scaleX = this.width > 0 ? width / this.width : 1;
    const scaleY = this.height > 0 ? height / this.height : 1;
    if (this.width > 0 && this.height > 0) {
      for (const ship of this.ships) ship.x *= scaleX;
      for (const torpedo of this.torpedoes) {
        torpedo.x *= scaleX;
        torpedo.y *= scaleY;
      }
      this.aimX *= scaleX;
    }
    this.width = width;
    this.height = height;
    this.laneYs = LANE_RATIOS.map((ratio) => height * ratio);
    for (const ship of this.ships) {
      ship.y = this.laneYs[ship.lane] ?? ship.y;
    }
  }

  /** ポインタ/キーを押し始めた瞬間。周期塔(ペリスコープ)を上げて照準を開始する。 */
  startAiming(x: number): void {
    if (this.isOver || this.cooldownRemaining > 0) return;
    this.isAiming = true;
    this.aimX = this.clampX(x);
  }

  /** 照準中の移動。ペリスコープが上がっていないときは無視する。 */
  updateAim(x: number): void {
    if (!this.isAiming) return;
    this.aimX = this.clampX(x);
  }

  /** 離した瞬間に発射し、ペリスコープを下げる。リロード中は発射されない。 */
  releaseAndFire(): void {
    if (!this.isAiming) return;
    this.isAiming = false;
    if (this.isOver || this.reloadRemaining > 0) return;
    this.torpedoes.push({ id: nextId++, x: this.aimX, y: this.height });
    this.reloadRemaining = RELOAD_SECONDS;
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    this.elapsed += deltaSeconds;
    this.difficulty = Math.min(MAX_DIFFICULTY, 1 + this.elapsed / DIFFICULTY_RAMP_SECONDS);

    if (this.cooldownRemaining > 0) {
      this.cooldownRemaining = Math.max(0, this.cooldownRemaining - deltaSeconds);
    }
    if (this.reloadRemaining > 0) {
      this.reloadRemaining = Math.max(0, this.reloadRemaining - deltaSeconds);
    }

    if (this.isAiming) {
      this.detection = Math.min(100, this.detection + DETECTION_RATE * deltaSeconds);
      if (this.detection >= 100) {
        this.handleSpotted();
        if (this.isOver) return;
      }
    } else {
      this.detection = Math.max(0, this.detection - DETECTION_DECAY * deltaSeconds);
    }

    this.updateShips(deltaSeconds);
    this.updateSpawning(deltaSeconds);
    this.updateTorpedoes(deltaSeconds);
  }

  private clampX(x: number): number {
    return Math.min(Math.max(x, 0), this.width);
  }

  private spawnShip(): Ship {
    const lane = Math.floor(randRange(0, LANE_RATIOS.length));
    const fromLeft = Math.random() < 0.5;
    const speed = randRange(SHIP_SPEED_MIN, SHIP_SPEED_MAX) * this.difficulty;
    return {
      id: nextId++,
      lane,
      x: fromLeft ? -SHIP_RADIUS : this.width + SHIP_RADIUS,
      y: this.laneYs[lane] ?? this.height / 2,
      vx: fromLeft ? speed : -speed,
      radius: SHIP_RADIUS,
    };
  }

  private handleSpotted(): void {
    this.lives -= 1;
    this.detection = 0;
    this.isAiming = false;
    this.combo = 0;
    this.cooldownRemaining = SPOTTED_COOLDOWN_SECONDS;
    this.onSpotted?.();
    if (this.lives <= 0) this.isOver = true;
  }

  private updateShips(deltaSeconds: number): void {
    for (const ship of this.ships) {
      ship.x += ship.vx * deltaSeconds;
    }
    this.ships = this.ships.filter(
      (ship) => ship.x > -ship.radius * 2 && ship.x < this.width + ship.radius * 2,
    );
  }

  private updateSpawning(deltaSeconds: number): void {
    this.spawnTimer -= deltaSeconds;
    if (this.spawnTimer > 0 || this.ships.length >= MAX_SHIPS) return;
    this.ships.push(this.spawnShip());
    const interval = randRange(SPAWN_INTERVAL_MIN, SPAWN_INTERVAL_MAX) / this.difficulty;
    this.spawnTimer = Math.max(SPAWN_INTERVAL_FLOOR, interval);
  }

  private updateTorpedoes(deltaSeconds: number): void {
    const surviving: Torpedo[] = [];
    for (const torpedo of this.torpedoes) {
      const prevY = torpedo.y;
      torpedo.y -= TORPEDO_SPEED * deltaSeconds;

      const crossedLanes = this.laneYs
        .map((y, laneIndex) => ({ y, laneIndex }))
        .filter(({ y }) => y <= prevY && y > torpedo.y)
        .sort((a, b) => b.y - a.y);

      let hit = false;
      for (const { laneIndex } of crossedLanes) {
        const target = this.ships.find(
          (ship) => ship.lane === laneIndex && Math.abs(ship.x - torpedo.x) <= HIT_RADIUS,
        );
        if (!target) continue;
        this.sinkShip(target);
        hit = true;
        break;
      }

      if (hit) continue;
      if (torpedo.y <= 0) {
        this.combo = 0;
        this.onMiss?.();
        continue;
      }
      surviving.push(torpedo);
    }
    this.torpedoes = surviving;
  }

  private sinkShip(ship: Ship): void {
    this.ships = this.ships.filter((s) => s.id !== ship.id);
    const points = BASE_POINTS + this.combo * COMBO_BONUS_PER_HIT;
    this.score += points;
    this.combo += 1;
    this.onShipSunk?.({ ship, points, combo: this.combo });
  }
}
