import { clamp, computeSpeedFraction, normalizeAngle, shortestAngleDiff } from "./sailPhysics.ts";

export interface Buoy {
  id: number;
  x: number;
  y: number;
  radius: number;
}

export interface WakePoint {
  x: number;
  y: number;
  age: number;
}

export interface BuoyCapturedEvent {
  buoy: Buoy;
  points: number;
  leg: number;
}

const degToRad = (deg: number): number => (deg * Math.PI) / 180;

export const ROUND_SECONDS = 75;
export const BOAT_RADIUS = 14;
export const BUOY_RADIUS = 20;
export const NO_GO_RAD = degToRad(42);

const MAX_SPEED = 170; // px/秒（最高効率時）
const TURN_RATE_RAD = degToRad(160); // 秒あたりの最大旋回角
const KEY_TURN_RATE_RAD = degToRad(110); // キーボード入力での目標角の変化速度
const WIND_PERIOD_SECONDS = 17;
const WIND_AMPLITUDE_RAD = degToRad(28);
const WAKE_LIFETIME = 2.2;
const WAKE_MIN_INTERVAL = 0.06;
const BASE_POINTS = 150;
const BUOY_SEARCH_ATTEMPTS = 16;
const BUOY_CONE_RAD = degToRad(78);

let nextId = 1;

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * 帆走ゲームのワールド。風上にあるブイへ向けて、ノーゴーゾーンを避けながら
 * ジグザグ（タック）で進むのが中心の駆け引き。
 */
export class CloseHauledWorld {
  width = 0;
  height = 0;

  boatX = 0;
  boatY = 0;
  boatHeading = 0;
  targetHeading = 0;

  /** 風が吹いてくる方向（船からその方角を見る角度）。基準値を風の揺れが揺さぶる。 */
  private baseWindFromAngle = -Math.PI / 2;
  windFromAngle = -Math.PI / 2;
  windElapsed = 0;

  speed = 0;
  speedFraction = 0;

  activeBuoy: Buoy;
  buoysCollected = 0;
  leg = 1;

  score = 0;
  timeRemaining = ROUND_SECONDS;
  isOver = false;

  wake: WakePoint[] = [];
  private wakeCooldown = 0;

  onBuoyCaptured: ((event: BuoyCapturedEvent) => void) | null = null;

  constructor(width: number, height: number) {
    this.resize(width, height);
    this.activeBuoy = this.spawnBuoy();
    this.reset();
  }

  reset(): void {
    this.score = 0;
    this.timeRemaining = ROUND_SECONDS;
    this.isOver = false;
    this.buoysCollected = 0;
    this.leg = 1;
    this.windElapsed = 0;
    this.windFromAngle = this.baseWindFromAngle;
    this.wake = [];
    this.wakeCooldown = 0;

    this.boatX = this.width * 0.5;
    this.boatY = this.height * 0.85;
    // 初期針路はノーゴーゾーンのすぐ外（クローズホールド）にして、
    // 何も操作しなくても船がすぐ動き出す状態にしておく。
    this.boatHeading = normalizeAngle(this.baseWindFromAngle + NO_GO_RAD + degToRad(18));
    this.targetHeading = this.boatHeading;
    this.speed = 0;
    this.speedFraction = 0;

    this.activeBuoy = this.spawnBuoy();
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const scaleX = this.width > 0 ? width / this.width : 1;
    const scaleY = this.height > 0 ? height / this.height : 1;
    if (this.width > 0 && this.height > 0) {
      this.boatX *= scaleX;
      this.boatY *= scaleY;
      if (this.activeBuoy) {
        this.activeBuoy.x *= scaleX;
        this.activeBuoy.y *= scaleY;
      }
      for (const point of this.wake) {
        point.x *= scaleX;
        point.y *= scaleY;
      }
    }
    this.width = width;
    this.height = height;
  }

  /** ポインタで指した方向へ目標針路を向ける（マウス/タッチ共通）。 */
  setTargetHeadingTowards(x: number, y: number): void {
    const dx = x - this.boatX;
    const dy = y - this.boatY;
    if (Math.hypot(dx, dy) < 1) return;
    this.targetHeading = Math.atan2(dy, dx);
  }

  /** キーボードでの連続的な旋回入力（direction: -1=左, 1=右）。 */
  steerByKey(direction: -1 | 1, deltaSeconds: number): void {
    this.targetHeading = normalizeAngle(
      this.targetHeading + direction * KEY_TURN_RATE_RAD * deltaSeconds,
    );
  }

  private spawnBuoy(): Buoy {
    const margin = BUOY_RADIUS + 18;
    const minDistance = Math.min(this.width, this.height) * (0.22 + Math.min(this.leg, 5) * 0.03);

    for (let attempt = 0; attempt < BUOY_SEARCH_ATTEMPTS; attempt++) {
      const x = randRange(margin, Math.max(margin, this.width - margin));
      const y = randRange(margin, Math.max(margin, this.height - margin));
      const angleFromBoat = Math.atan2(y - this.boatY, x - this.boatX);
      const withinCone =
        Math.abs(shortestAngleDiff(angleFromBoat, this.windFromAngle)) <= BUOY_CONE_RAD;
      const distance = Math.hypot(x - this.boatX, y - this.boatY);
      if (withinCone && distance >= minDistance) {
        return { id: nextId++, x, y, radius: BUOY_RADIUS };
      }
    }

    // 条件を満たす点が見つからない場合（小さい画面など）は画面内の適当な点にフォールバックする
    return {
      id: nextId++,
      x: randRange(margin, Math.max(margin, this.width - margin)),
      y: randRange(margin, Math.max(margin, this.height - margin)),
      radius: BUOY_RADIUS,
    };
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    this.timeRemaining = Math.max(0, this.timeRemaining - deltaSeconds);
    if (this.timeRemaining <= 0) {
      this.isOver = true;
      return;
    }

    this.windElapsed += deltaSeconds;
    this.windFromAngle = normalizeAngle(
      this.baseWindFromAngle +
        Math.sin((this.windElapsed / WIND_PERIOD_SECONDS) * Math.PI * 2) * WIND_AMPLITUDE_RAD,
    );

    const headingDiff = shortestAngleDiff(this.boatHeading, this.targetHeading);
    const maxStep = TURN_RATE_RAD * deltaSeconds;
    this.boatHeading = normalizeAngle(this.boatHeading + clamp(headingDiff, -maxStep, maxStep));

    this.speedFraction = computeSpeedFraction(this.boatHeading - this.windFromAngle, NO_GO_RAD);
    this.speed = MAX_SPEED * this.speedFraction;

    this.boatX += Math.cos(this.boatHeading) * this.speed * deltaSeconds;
    this.boatY += Math.sin(this.boatHeading) * this.speed * deltaSeconds;
    this.boatX = clamp(this.boatX, BOAT_RADIUS, Math.max(BOAT_RADIUS, this.width - BOAT_RADIUS));
    this.boatY = clamp(this.boatY, BOAT_RADIUS, Math.max(BOAT_RADIUS, this.height - BOAT_RADIUS));

    this.wakeCooldown -= deltaSeconds;
    if (this.speed > 4 && this.wakeCooldown <= 0) {
      this.wakeCooldown = WAKE_MIN_INTERVAL;
      this.wake.push({ x: this.boatX, y: this.boatY, age: 0 });
    }
    for (let i = this.wake.length - 1; i >= 0; i--) {
      this.wake[i].age += deltaSeconds;
      if (this.wake[i].age >= WAKE_LIFETIME) this.wake.splice(i, 1);
    }

    const buoy = this.activeBuoy;
    const distanceToBuoy = Math.hypot(this.boatX - buoy.x, this.boatY - buoy.y);
    if (distanceToBuoy <= buoy.radius + BOAT_RADIUS) {
      this.buoysCollected += 1;
      const points = BASE_POINTS + (this.leg - 1) * 20;
      this.score += points;
      this.onBuoyCaptured?.({ buoy, points, leg: this.leg });

      if (this.buoysCollected % 3 === 0) this.leg += 1;
      this.activeBuoy = this.spawnBuoy();
    }
  }
}
