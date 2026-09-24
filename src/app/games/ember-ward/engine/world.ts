import { distanceToSegment, dot, length, normalize, reflect, sub, type Vec2 } from "./vec2.ts";

export interface Ember {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  /** 一度でも結界に弾かれたか。描画側の色分けに使う。 */
  isWarded: boolean;
}

export interface Ward {
  id: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  age: number;
  ttl: number;
}

export interface EmberWardedEvent {
  x: number;
  y: number;
  points: number;
  combo: number;
}

export interface ShrineHitEvent {
  x: number;
  hpRemaining: number;
}

export const SHRINE_MAX_HP = 5;

const EMBER_RADIUS = 11;
const SPAWN_INTERVAL_START = 1.35;
const SPAWN_INTERVAL_MIN = 0.45;
const SPAWN_INTERVAL_DECAY_PER_SECOND = 0.01;
const EMBER_SPEED_MIN = 95;
const EMBER_SPEED_MAX = 135;
const EMBER_SPEED_GROWTH_PER_SECOND = 0.01;
const EMBER_SPEED_MULTIPLIER_CAP = 1.9;
const EMBER_DRIFT_MAX = 22;
const WARD_TTL_SECONDS = 1.7;
const MAX_WARDS = 4;
const MIN_WARD_LENGTH = 28;
const BOUNCE_SPEED_MULTIPLIER = 1.08;
const MIN_BOUNCE_SPEED = 60;
const MAX_EMBER_SPEED = 420;
const COMBO_WINDOW_SECONDS = 2.4;
const BASE_POINTS = 20;
const COMBO_BONUS_PER_STREAK = 6;
const COMBO_BONUS_CAP = 90;
const SHRINE_LINE_RATIO = 0.9;
const KEYBOARD_CURSOR_SPEED = 300;
const KEYBOARD_WARD_HALF_LENGTH = 64;
const OFFSCREEN_MARGIN = 80;

let nextId = 1;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * 空から降る火の粉(エンバー)を、ドラッグで描いた結界(ward)の線で弾き返して
 * 社(shrine)を守るリアルタイム防衛アクションの純粋ロジック層。
 * React / pixi.js には一切依存しない。
 */
export class EmberWardWorld {
  width = 0;
  height = 0;

  embers: Ember[] = [];
  wards: Ward[] = [];
  score = 0;
  combo = 0;
  shrineHp = SHRINE_MAX_HP;
  isOver = false;
  keyboardCursor: Vec2 = { x: 0, y: 0 };

  private comboTimer = 0;
  private elapsedSeconds = 0;
  private spawnTimer = SPAWN_INTERVAL_START * 0.5;

  onEmberWarded: ((event: EmberWardedEvent) => void) | null = null;
  onShrineHit: ((event: ShrineHitEvent) => void) | null = null;

  constructor(width: number, height: number) {
    this.width = width > 0 ? width : 1;
    this.height = height > 0 ? height : 1;
    this.reset();
  }

  reset(): void {
    this.embers = [];
    this.wards = [];
    this.score = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.shrineHp = SHRINE_MAX_HP;
    this.isOver = false;
    this.elapsedSeconds = 0;
    this.spawnTimer = SPAWN_INTERVAL_START * 0.5;
    this.keyboardCursor = { x: this.width / 2, y: this.height * 0.55 };
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const scaleX = this.width > 0 ? width / this.width : 1;
    const scaleY = this.height > 0 ? height / this.height : 1;
    if (this.width > 0 && this.height > 0) {
      for (const ember of this.embers) {
        ember.x *= scaleX;
        ember.y *= scaleY;
      }
      for (const ward of this.wards) {
        ward.x1 *= scaleX;
        ward.y1 *= scaleY;
        ward.x2 *= scaleX;
        ward.y2 *= scaleY;
      }
      this.keyboardCursor.x *= scaleX;
      this.keyboardCursor.y *= scaleY;
    }
    this.width = width;
    this.height = height;
  }

  /** 火の粉が社に到達したとみなす境界線のy座標。 */
  get shrineLineY(): number {
    return this.height * SHRINE_LINE_RATIO;
  }

  /** ドラッグの始点・終点から結界を1本設置する。短すぎる場合は失敗しfalseを返す。 */
  addWard(x1: number, y1: number, x2: number, y2: number): boolean {
    if (Math.hypot(x2 - x1, y2 - y1) < MIN_WARD_LENGTH) return false;
    if (this.wards.length >= MAX_WARDS) this.wards.shift();
    this.wards.push({ id: nextId++, x1, y1, x2, y2, age: 0, ttl: WARD_TTL_SECONDS });
    return true;
  }

  /** キーボード操作用のカーソルを移動する。dx/dyは-1〜1の方向入力を想定。 */
  moveKeyboardCursor(dx: number, dy: number, deltaSeconds: number): void {
    const margin = EMBER_RADIUS + 4;
    this.keyboardCursor.x = clamp(
      this.keyboardCursor.x + dx * KEYBOARD_CURSOR_SPEED * deltaSeconds,
      margin,
      this.width - margin,
    );
    this.keyboardCursor.y = clamp(
      this.keyboardCursor.y + dy * KEYBOARD_CURSOR_SPEED * deltaSeconds,
      margin,
      this.shrineLineY - margin,
    );
  }

  /** キーボードカーソルの位置に水平な結界を設置する。 */
  placeKeyboardWard(): boolean {
    const { x, y } = this.keyboardCursor;
    return this.addWard(x - KEYBOARD_WARD_HALF_LENGTH, y, x + KEYBOARD_WARD_HALF_LENGTH, y);
  }

  private spawnEmber(): void {
    const speedMultiplier = Math.min(
      EMBER_SPEED_MULTIPLIER_CAP,
      1 + this.elapsedSeconds * EMBER_SPEED_GROWTH_PER_SECOND,
    );
    this.embers.push({
      id: nextId++,
      x: randRange(EMBER_RADIUS, this.width - EMBER_RADIUS),
      y: -EMBER_RADIUS,
      vx: randRange(-EMBER_DRIFT_MAX, EMBER_DRIFT_MAX),
      vy: randRange(EMBER_SPEED_MIN, EMBER_SPEED_MAX) * speedMultiplier,
      radius: EMBER_RADIUS,
      isWarded: false,
    });
  }

  private deflectEmber(ember: Ember, ward: Ward, distance: number): void {
    const wardDir = normalize(sub({ x: ward.x2, y: ward.y2 }, { x: ward.x1, y: ward.y1 }));
    let normal: Vec2 = { x: -wardDir.y, y: wardDir.x };
    const velocity: Vec2 = { x: ember.vx, y: ember.vy };
    // reflect() の結果自体は normal の符号に依存しないが、押し出し補正は
    // エンバーが飛んできた側に向いた法線でないと逆に結界へめり込ませてしまう。
    if (dot(normal, velocity) > 0) normal = { x: -normal.x, y: -normal.y };

    const reflected = reflect(velocity, normal);
    const reflectedDir = normalize(reflected);
    const speed = clamp(
      length(reflected) * BOUNCE_SPEED_MULTIPLIER,
      MIN_BOUNCE_SPEED,
      MAX_EMBER_SPEED,
    );
    ember.vx = reflectedDir.x * speed;
    ember.vy = reflectedDir.y * speed;

    const pushOut = ember.radius - distance + 1;
    ember.x += normal.x * pushOut;
    ember.y += normal.y * pushOut;
    ember.isWarded = true;

    this.combo += 1;
    this.comboTimer = COMBO_WINDOW_SECONDS;
    const points =
      BASE_POINTS + Math.min(COMBO_BONUS_CAP, (this.combo - 1) * COMBO_BONUS_PER_STREAK);
    this.score += points;
    this.onEmberWarded?.({ x: ember.x, y: ember.y, points, combo: this.combo });
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;
    this.elapsedSeconds += deltaSeconds;

    if (this.combo > 0) {
      this.comboTimer -= deltaSeconds;
      if (this.comboTimer <= 0) {
        this.combo = 0;
        this.comboTimer = 0;
      }
    }

    this.spawnTimer -= deltaSeconds;
    if (this.spawnTimer <= 0) {
      this.spawnEmber();
      const interval = Math.max(
        SPAWN_INTERVAL_MIN,
        SPAWN_INTERVAL_START - this.elapsedSeconds * SPAWN_INTERVAL_DECAY_PER_SECOND,
      );
      this.spawnTimer += interval;
    }

    for (let i = this.wards.length - 1; i >= 0; i--) {
      const ward = this.wards[i];
      ward.age += deltaSeconds;
      if (ward.age >= ward.ttl) this.wards.splice(i, 1);
    }

    for (let i = this.embers.length - 1; i >= 0; i--) {
      const ember = this.embers[i];
      ember.x += ember.vx * deltaSeconds;
      ember.y += ember.vy * deltaSeconds;

      for (const ward of this.wards) {
        const distance = distanceToSegment(
          { x: ember.x, y: ember.y },
          { x: ward.x1, y: ward.y1 },
          { x: ward.x2, y: ward.y2 },
        );
        if (distance > ember.radius) continue;
        this.deflectEmber(ember, ward, distance);
        break;
      }

      if (ember.y + ember.radius >= this.shrineLineY) {
        this.embers.splice(i, 1);
        this.shrineHp = Math.max(0, this.shrineHp - 1);
        this.combo = 0;
        this.comboTimer = 0;
        this.onShrineHit?.({ x: ember.x, hpRemaining: this.shrineHp });
        if (this.shrineHp <= 0) this.isOver = true;
        continue;
      }

      if (
        ember.x < -OFFSCREEN_MARGIN ||
        ember.x > this.width + OFFSCREEN_MARGIN ||
        ember.y < -OFFSCREEN_MARGIN
      ) {
        this.embers.splice(i, 1);
      }
    }
  }
}
