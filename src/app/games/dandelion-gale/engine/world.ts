export interface Seed {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface FanState {
  x: number;
  y: number;
  isActive: boolean;
}

export interface FlowerBed {
  x: number;
  y: number;
  radius: number;
}

export interface Raindrop {
  x: number;
  y: number;
  radius: number;
  swayPhase: number;
  swaySpeed: number;
  isActive: boolean;
}

export interface SeedPlantedEvent {
  combo: number;
  points: number;
}

export interface SeedPoppedEvent {
  livesRemaining: number;
}

export const SEED_RADIUS = 14;
export const STARTING_LIVES = 3;
export const MAX_RAINDROPS = 6;

const BASE_RAINDROPS = 2;
const COMBO_PER_EXTRA_RAINDROP = 2;
const RAINDROP_RADIUS = 10;
const RAIN_BASE_SPEED = 140;
const RAIN_SPEED_PER_COMBO = 10;
const RAIN_SPEED_MAX = 320;
const RAIN_SWAY_ACCEL = 26;

const GRAVITY_ACCEL = 50;
const AMBIENT_WIND_ACCEL = 60;
const AMBIENT_WIND_FREQ = 0.5;
const GUST_ACCEL = 1400;
const DAMPING_PER_SECOND = 1.8;
const MAX_SPEED = 520;
const BOUNCE_RESTITUTION = 0.5;

const TARGET_RADIUS_START = 90;
const TARGET_RADIUS_MIN = 50;
const TARGET_RADIUS_STEP = 4;
const TARGET_BASE_BONUS = 200;
const TARGET_COMBO_BONUS = 60;

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * 綿毛の種を風で操り、点在する花畑へ届け続けるリアルタイム・サバイバルパズルの
 * 純粋ロジック層。React / pixi.js には一切依存しない。
 */
export class DandelionGaleWorld {
  width = 0;
  height = 0;
  seed: Seed = { x: 0, y: 0, vx: 0, vy: 0 };
  fan: FanState = { x: 0, y: 0, isActive: false };
  target: FlowerBed = { x: 0, y: 0, radius: 0 };
  raindrops: Raindrop[] = [];
  score = 0;
  combo = 0;
  lives = STARTING_LIVES;
  isOver = false;
  private elapsedSeconds = 0;

  onSeedPlanted: ((event: SeedPlantedEvent) => void) | null = null;
  onSeedPopped: ((event: SeedPoppedEvent) => void) | null = null;

  constructor(width: number, height: number) {
    this.resize(width, height);
    this.reset();
  }

  reset(): void {
    this.score = 0;
    this.combo = 0;
    this.lives = STARTING_LIVES;
    this.isOver = false;
    this.elapsedSeconds = 0;
    this.fan = { x: this.width / 2, y: this.height / 2, isActive: false };
    this.seed = this.spawnPoint();
    this.target = this.spawnTarget();
    this.raindrops = Array.from({ length: MAX_RAINDROPS }, () => this.spawnRaindrop(false));
    this.activateRaindrops();
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const scaleX = this.width > 0 ? width / this.width : 1;
    const scaleY = this.height > 0 ? height / this.height : 1;
    if (this.width > 0 && this.height > 0) {
      this.seed.x *= scaleX;
      this.seed.y *= scaleY;
      this.fan.x *= scaleX;
      this.fan.y *= scaleY;
      this.target.x *= scaleX;
      this.target.y *= scaleY;
      for (const raindrop of this.raindrops) {
        raindrop.x *= scaleX;
        raindrop.y *= scaleY;
      }
    }
    this.width = width;
    this.height = height;
  }

  /** ドラッグ/長押し中のファン(送風源)の位置を更新する。画面外にはみ出さない。 */
  setFanPosition(x: number, y: number): void {
    this.fan.x = Math.min(Math.max(x, 0), this.width);
    this.fan.y = Math.min(Math.max(y, 0), this.height);
  }

  setFanActive(isActive: boolean): void {
    this.fan.isActive = isActive;
  }

  private spawnPoint(): Seed {
    return { x: this.width / 2, y: this.height * 0.85, vx: 0, vy: 0 };
  }

  private spawnTarget(): FlowerBed {
    const radius = Math.max(
      TARGET_RADIUS_MIN,
      TARGET_RADIUS_START - this.combo * TARGET_RADIUS_STEP,
    );
    const marginRatioX = this.width > 0 ? Math.min(0.45, (radius + 24) / this.width) : 0.3;
    const marginRatioY = this.height > 0 ? Math.min(0.45, (radius + 24) / this.height) : 0.15;
    return {
      x: randRange(this.width * marginRatioX, this.width * (1 - marginRatioX)),
      y: randRange(this.height * marginRatioY, this.height * 0.65),
      radius,
    };
  }

  private spawnRaindrop(isActive: boolean): Raindrop {
    // x/y は width/height に対する比率で決める。resize() は既存座標を scaleX/scaleY で
    // 乗算して引き継ぐため、固定px(半径分のオフセット等)を混ぜると初期化直後の仮サイズ
    // (1x1)から実サイズへ引き伸ばされた瞬間に画面外はるか彼方まで吹き飛んでしまう。
    return {
      x: randRange(this.width * 0.05, this.width * 0.95),
      y: -this.height * randRange(0.05, 0.45),
      radius: RAINDROP_RADIUS,
      swayPhase: randRange(0, Math.PI * 2),
      swaySpeed: randRange(0.6, 1.4),
      isActive,
    };
  }

  private activeRaindropCount(): number {
    const extra = Math.floor(this.combo / COMBO_PER_EXTRA_RAINDROP);
    return Math.min(MAX_RAINDROPS, BASE_RAINDROPS + extra);
  }

  private activateRaindrops(): void {
    const activeCount = this.activeRaindropCount();
    for (let i = 0; i < this.raindrops.length; i++) {
      const shouldBeActive = i < activeCount;
      if (shouldBeActive && !this.raindrops[i].isActive) {
        this.raindrops[i] = this.spawnRaindrop(true);
      } else if (!shouldBeActive) {
        this.raindrops[i].isActive = false;
      }
    }
  }

  private plantSeed(): void {
    const points = TARGET_BASE_BONUS + this.combo * TARGET_COMBO_BONUS;
    this.score += points;
    this.onSeedPlanted?.({ combo: this.combo, points });
    this.combo += 1;
    this.target = this.spawnTarget();
    this.activateRaindrops();
  }

  private popSeed(): void {
    this.lives -= 1;
    this.combo = 0;
    this.seed = this.spawnPoint();
    this.onSeedPopped?.({ livesRemaining: this.lives });
    if (this.lives <= 0) {
      this.isOver = true;
    } else {
      this.activateRaindrops();
    }
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;
    this.elapsedSeconds += deltaSeconds;

    let ax = 0;
    let ay = GRAVITY_ACCEL;

    if (this.fan.isActive) {
      const dx = this.seed.x - this.fan.x;
      const dy = this.seed.y - this.fan.y;
      const dist = Math.max(Math.hypot(dx, dy), 1);
      ax += (dx / dist) * GUST_ACCEL;
      ay += (dy / dist) * GUST_ACCEL;
    }

    ax += Math.sin(this.elapsedSeconds * AMBIENT_WIND_FREQ) * AMBIENT_WIND_ACCEL;
    ay += Math.cos(this.elapsedSeconds * AMBIENT_WIND_FREQ * 1.3) * AMBIENT_WIND_ACCEL * 0.4;

    const dampingFactor = Math.exp(-DAMPING_PER_SECOND * deltaSeconds);
    this.seed.vx = (this.seed.vx + ax * deltaSeconds) * dampingFactor;
    this.seed.vy = (this.seed.vy + ay * deltaSeconds) * dampingFactor;

    const speed = Math.hypot(this.seed.vx, this.seed.vy);
    if (speed > MAX_SPEED) {
      const scale = MAX_SPEED / speed;
      this.seed.vx *= scale;
      this.seed.vy *= scale;
    }

    this.seed.x += this.seed.vx * deltaSeconds;
    this.seed.y += this.seed.vy * deltaSeconds;

    if (this.seed.x < SEED_RADIUS) {
      this.seed.x = SEED_RADIUS;
      this.seed.vx = Math.abs(this.seed.vx) * BOUNCE_RESTITUTION;
    } else if (this.seed.x > this.width - SEED_RADIUS) {
      this.seed.x = this.width - SEED_RADIUS;
      this.seed.vx = -Math.abs(this.seed.vx) * BOUNCE_RESTITUTION;
    }
    if (this.seed.y < SEED_RADIUS) {
      this.seed.y = SEED_RADIUS;
      this.seed.vy = Math.abs(this.seed.vy) * BOUNCE_RESTITUTION;
    } else if (this.seed.y > this.height - SEED_RADIUS) {
      this.seed.y = this.height - SEED_RADIUS;
      this.seed.vy = -Math.abs(this.seed.vy) * BOUNCE_RESTITUTION;
    }

    const fallSpeed = Math.min(RAIN_SPEED_MAX, RAIN_BASE_SPEED + this.combo * RAIN_SPEED_PER_COMBO);
    for (const raindrop of this.raindrops) {
      if (!raindrop.isActive) continue;
      raindrop.y += fallSpeed * deltaSeconds;
      raindrop.x +=
        Math.sin(this.elapsedSeconds * raindrop.swaySpeed + raindrop.swayPhase) *
        RAIN_SWAY_ACCEL *
        deltaSeconds;
      raindrop.x = Math.min(Math.max(raindrop.x, raindrop.radius), this.width - raindrop.radius);
      if (raindrop.y - raindrop.radius > this.height) {
        const respawned = this.spawnRaindrop(true);
        raindrop.x = respawned.x;
        raindrop.y = respawned.y;
        raindrop.swayPhase = respawned.swayPhase;
        raindrop.swaySpeed = respawned.swaySpeed;
      }
    }

    for (const raindrop of this.raindrops) {
      if (!raindrop.isActive) continue;
      const dist = Math.hypot(this.seed.x - raindrop.x, this.seed.y - raindrop.y);
      if (dist < SEED_RADIUS + raindrop.radius) {
        this.popSeed();
        return;
      }
    }

    const distToTarget = Math.hypot(this.seed.x - this.target.x, this.seed.y - this.target.y);
    if (distToTarget < SEED_RADIUS + this.target.radius) {
      this.plantSeed();
    }
  }
}
