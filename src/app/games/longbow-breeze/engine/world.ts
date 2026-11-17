export interface RingDef {
  /** 的の中心からの半径(px)。昇順（金的が最小）で並ぶ。 */
  radius: number;
  points: number;
}

export interface Target {
  x: number;
  centerY: number;
  /** ラウンドが進むほど縮む難易度係数(1が初期サイズ)。 */
  scale: number;
  rings: RingDef[];
}

export interface Arrow {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  trail: { x: number; y: number }[];
}

export interface ShotResolution {
  /** 当たったリング。外れた場合は null。 */
  ring: RingDef | null;
  points: number;
  combo: number;
  /** 外れた理由。当たった場合は undefined。 */
  missReason?: "ground" | "wide" | "timeout";
  /** 結果が確定した位置(ポップアップ表示などに使う)。 */
  at: { x: number; y: number };
}

const START_LIVES = 3;
const GRAVITY_FRAC = 0.95;
const MIN_SPEED_FRAC = 0.55;
const MAX_SPEED_FRAC = 1.3;
const MAX_DRAG_FRAC = 0.3;
const GROUND_Y_FRAC = 0.86;
const ANCHOR_X_FRAC = 0.12;
const ANCHOR_HEIGHT_FRAC = 0.05;
const BASE_WIND_FRAC = 0.1;
const WIND_GROWTH_FRAC = 0.012;
const MAX_WIND_FRAC = 0.34;
const RING_RADIUS_FRACS = [0.022, 0.045, 0.07, 0.095] as const;
const RING_POINTS = [100, 70, 50, 30] as const;
const COMBO_BONUS = 20;
const MIN_TARGET_SCALE = 0.55;
const TARGET_SCALE_DECAY = 0.025;
const TRAIL_MAX_POINTS = 36;
const MAX_FLIGHT_SECONDS = 6;

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export class LongbowBreezeWorld {
  width = 0;
  height = 0;

  anchorX = 0;
  anchorY = 0;
  groundY = 0;
  gravity = 0;
  minSpeed = 0;
  maxSpeed = 0;
  maxDrag = 0;

  target: Target;
  /** 現在のラウンドの風(px/s^2)。正=右向き(的方向)、負=左向き。 */
  windAccel = 0;
  arrow: Arrow | null = null;
  ready = true;

  score = 0;
  lives = START_LIVES;
  combo = 0;
  round = 0;
  isOver = false;

  onShotResolved: ((resolution: ShotResolution) => void) | null = null;

  constructor(width: number, height: number) {
    this.target = { x: 0, centerY: 0, scale: 1, rings: [] };
    this.resize(width, height);
    this.reset();
  }

  reset(): void {
    this.score = 0;
    this.lives = START_LIVES;
    this.combo = 0;
    this.round = 0;
    this.isOver = false;
    this.arrow = null;
    this.ready = true;
    this.target = this.spawnTarget();
    this.windAccel = this.rollWind();
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const scaleX = this.width > 0 ? width / this.width : 1;
    const scaleY = this.height > 0 ? height / this.height : 1;
    const hasPrevSize = this.width > 0 && this.height > 0;

    this.width = width;
    this.height = height;

    const minDim = Math.min(width, height);
    this.anchorX = width * ANCHOR_X_FRAC;
    this.groundY = height * GROUND_Y_FRAC;
    this.anchorY = this.groundY - minDim * ANCHOR_HEIGHT_FRAC;
    this.gravity = minDim * GRAVITY_FRAC;
    this.minSpeed = minDim * MIN_SPEED_FRAC;
    this.maxSpeed = minDim * MAX_SPEED_FRAC;
    this.maxDrag = minDim * MAX_DRAG_FRAC;

    if (this.target.rings.length > 0) {
      this.target.rings = RING_RADIUS_FRACS.map((frac, i) => ({
        radius: minDim * frac * this.target.scale,
        points: RING_POINTS[i],
      }));
    }

    if (hasPrevSize && (scaleX !== 1 || scaleY !== 1)) {
      this.target.x *= scaleX;
      this.target.centerY *= scaleY;
      if (this.arrow) {
        this.arrow.x *= scaleX;
        this.arrow.y *= scaleY;
        for (const point of this.arrow.trail) {
          point.x *= scaleX;
          point.y *= scaleY;
        }
      }
    }
  }

  private windMaxForRound(): number {
    const minDim = Math.min(this.width, this.height);
    const growth = Math.min(this.round, 20) * WIND_GROWTH_FRAC;
    return minDim * Math.min(BASE_WIND_FRAC + growth, MAX_WIND_FRAC);
  }

  private rollWind(): number {
    const windMax = this.windMaxForRound();
    return randRange(-windMax, windMax);
  }

  private spawnTarget(): Target {
    const minDim = Math.min(this.width, this.height);
    const scale = Math.max(MIN_TARGET_SCALE, 1 - this.round * TARGET_SCALE_DECAY);

    const minXFrac = Math.min(0.5 + this.round * 0.01, 0.78);
    const maxXFrac = Math.min(0.68 + this.round * 0.015, 0.93);
    const x = this.width * randRange(minXFrac, Math.max(maxXFrac, minXFrac + 0.05));
    const centerY = this.height * randRange(0.25, 0.55);

    const rings: RingDef[] = RING_RADIUS_FRACS.map((frac, i) => ({
      radius: minDim * frac * scale,
      points: RING_POINTS[i],
    }));

    return { x, centerY, scale, rings };
  }

  /** ドラッグ量/キー入力から求めた速度ベクトルで矢を放つ。準備中でなければ無視する。 */
  fire(vx: number, vy: number): void {
    if (!this.ready || this.isOver || this.arrow) return;
    this.ready = false;
    this.arrow = { x: this.anchorX, y: this.anchorY, vx, vy, age: 0, trail: [] };
  }

  private resolveShot(
    ring: RingDef | null,
    at: { x: number; y: number },
    missReason?: ShotResolution["missReason"],
  ): void {
    this.arrow = null;

    if (ring) {
      const points = ring.points + this.combo * COMBO_BONUS;
      this.score += points;
      this.onShotResolved?.({ ring, points, combo: this.combo, at });
      this.combo += 1;
      this.round += 1;
      this.target = this.spawnTarget();
      this.windAccel = this.rollWind();
    } else {
      this.combo = 0;
      this.lives -= 1;
      this.onShotResolved?.({ ring: null, points: 0, combo: 0, missReason, at });
      if (this.lives <= 0) {
        this.isOver = true;
      } else {
        this.windAccel = this.rollWind();
      }
    }

    if (!this.isOver) this.ready = true;
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    const arrow = this.arrow;
    if (!arrow) return;

    arrow.age += deltaSeconds;
    const prevX = arrow.x;
    const prevY = arrow.y;

    arrow.vx += this.windAccel * deltaSeconds;
    arrow.vy += this.gravity * deltaSeconds;
    arrow.x += arrow.vx * deltaSeconds;
    arrow.y += arrow.vy * deltaSeconds;

    arrow.trail.push({ x: arrow.x, y: arrow.y });
    if (arrow.trail.length > TRAIL_MAX_POINTS) arrow.trail.shift();

    const targetX = this.target.x;
    const crossedTarget = (prevX - targetX) * (arrow.x - targetX) <= 0 && prevX !== arrow.x;

    if (crossedTarget) {
      const t = (targetX - prevX) / (arrow.x - prevX);
      const crossY = prevY + (arrow.y - prevY) * t;
      const offset = Math.abs(crossY - this.target.centerY);
      const hitRing = this.target.rings.find((ring) => offset <= ring.radius) ?? null;
      this.resolveShot(hitRing, { x: targetX, y: crossY }, hitRing ? undefined : "wide");
      return;
    }

    if (arrow.y >= this.groundY) {
      this.resolveShot(null, { x: arrow.x, y: this.groundY }, "ground");
      return;
    }

    if (arrow.age >= MAX_FLIGHT_SECONDS) {
      this.resolveShot(null, { x: arrow.x, y: arrow.y }, "timeout");
    }
  }
}
