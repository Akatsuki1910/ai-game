export type BubbleSize = "small" | "medium" | "large";

export const BUBBLE_SIZES: readonly BubbleSize[] = ["small", "medium", "large"];

export interface BubbleState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  size: BubbleSize;
}

export interface TargetFlower {
  x: number;
  y: number;
  size: BubbleSize;
  bandHalfWidth: number;
}

export interface HazardState {
  x: number;
  y: number;
  vx: number;
  radius: number;
}

export interface FlowerMatchedEvent {
  size: BubbleSize;
  isPerfect: boolean;
  points: number;
  combo: number;
}

export type BubbleLostReason = "wrong-size" | "off-center" | "hazard" | "overcharge";

export interface BubbleLostEvent {
  reason: BubbleLostReason;
  vitality: number;
}

export interface GardenWiltedEvent {
  score: number;
  maxCombo: number;
  bloomed: number;
}

export const START_VITALITY = 100;
export const CHARGE_MAX_SECONDS = 1.3;

/** 風船(泡)を吹く開始位置。正規化座標(0〜1)で、画面サイズに依存しない。 */
const WAND_X = 0.5;
const WAND_Y = 0.92;
const TARGET_Y = 0.16;
const HAZARD_Y = 0.55;

const OVERCHARGE_GRACE_SECONDS = 0.5;
const SMALL_CHARGE_MAX = 0.38;
const MEDIUM_CHARGE_MAX = 0.72;

export const BUBBLE_RADIUS_BY_SIZE: Readonly<Record<BubbleSize, number>> = {
  small: 0.028,
  medium: 0.042,
  large: 0.06,
};
const RADIUS_BY_SIZE = BUBBLE_RADIUS_BY_SIZE;
/** 大きい泡ほど重く、ゆっくり上昇する(/秒、正規化座標)。 */
const RISE_SPEED_BY_SIZE = { small: 0.34, medium: 0.27, large: 0.21 } as const;
const HAZARD_RADIUS = 0.034;

const STEER_ACCEL = 2.6;
const MAX_STEER_SPEED = 0.62;
const STEER_DRAG_PER_SECOND = 2.0;
/** ポインタで狙う位置と泡の距離がこの幅のとき、最大の力で寄せる。 */
const STEER_PROPORTIONAL_RANGE = 0.16;

const WIND_FREQUENCY = 0.5;
const BASE_WIND_ACCEL = 0.32;
const WIND_GROWTH_PER_BLOOM = 0.035;
const MAX_WIND_ACCEL = 0.9;

const MAX_BAND_HALF_WIDTH = 0.22;
const MIN_BAND_HALF_WIDTH = 0.095;
const BAND_SHRINK_PER_BLOOM = 0.011;
const PERFECT_BAND_RATIO = 0.35;

const BASE_HAZARD_SPEED = 0.17;
const HAZARD_SPEED_GROWTH_PER_BLOOM = 0.012;
const MAX_HAZARD_SPEED = 0.42;

const BASE_POINTS = 100;
const PERFECT_BONUS = 60;
const COMBO_BONUS_PER_STREAK = 10;
const MAX_COMBO_BONUS = 150;

const MISS_PENALTY = 16;
const HAZARD_PENALTY = 24;
const OVERCHARGE_PENALTY = 20;
const MATCH_RECOVER = 6;

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampVitality(value: number): number {
  return clamp(value, 0, START_VITALITY);
}

/** 現在の長押し量(0〜1)から確定するサイズを計算する。UIのプレビュー表示にも使う。 */
export function sizeForCharge(charge: number): BubbleSize {
  if (charge < SMALL_CHARGE_MAX) return "small";
  if (charge < MEDIUM_CHARGE_MAX) return "medium";
  return "large";
}

function randomSize(): BubbleSize {
  return BUBBLE_SIZES[Math.floor(Math.random() * BUBBLE_SIZES.length)];
}

/**
 * 泡を吹いて育てた花に届けるリアルタイム精度パズルの純粋ロジック層。
 * React / pixi.js には一切依存せず、座標はすべて 0〜1 の正規化空間で表現する
 * (画面サイズは描画側で乗算するだけなので、このクラスは resize を持たない)。
 *
 * 長押しで泡を育て(charge)、離すと大きさ(small/medium/large)が確定して泡が上昇する。
 * 上昇中は風(サイン波)が泡を左右に流すので、ドラッグ/矢印キーで打ち返して狙いを保つ。
 * 花の高さに届いたとき、花が求める大きさと中心からのズレの両方が許容帯に収まっていれば
 * 開花(得点)、そうでなければ失敗して庭の元気(vitality)が減る。虫(hazard)に触れても失敗する。
 * 長押しを粘りすぎると泡が暴発して失敗する(オーバーチャージ)。
 */
export class BubbleGardenWorld {
  score = 0;
  vitality = START_VITALITY;
  combo = 0;
  maxCombo = 0;
  bloomed = 0;
  elapsed = 0;
  isOver = false;

  isCharging = false;
  charge = 0;
  private overchargeTimer = 0;

  bubble: BubbleState | null = null;
  target: TargetFlower = {
    x: 0.5,
    y: TARGET_Y,
    size: "medium",
    bandHalfWidth: MAX_BAND_HALF_WIDTH,
  };
  hazard: HazardState = { x: 0.5, y: HAZARD_Y, vx: BASE_HAZARD_SPEED, radius: HAZARD_RADIUS };

  private steerDirKey = 0;
  private pointerSteerX: number | null = null;

  onFlowerMatched: ((event: FlowerMatchedEvent) => void) | null = null;
  onBubbleLost: ((event: BubbleLostEvent) => void) | null = null;
  onGardenWilted: ((event: GardenWiltedEvent) => void) | null = null;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.score = 0;
    this.vitality = START_VITALITY;
    this.combo = 0;
    this.maxCombo = 0;
    this.bloomed = 0;
    this.elapsed = 0;
    this.isOver = false;
    this.isCharging = false;
    this.charge = 0;
    this.overchargeTimer = 0;
    this.bubble = null;
    this.steerDirKey = 0;
    this.pointerSteerX = null;
    this.hazard = {
      x: randRange(0.3, 0.7),
      y: HAZARD_Y,
      vx: Math.random() < 0.5 ? -BASE_HAZARD_SPEED : BASE_HAZARD_SPEED,
      radius: HAZARD_RADIUS,
    };
    this.spawnTarget();
  }

  /** 風船の蔓(へた)の位置。常に画面下中央で固定。 */
  get wandPosition(): { x: number; y: number } {
    return { x: WAND_X, y: WAND_Y };
  }

  /** 現在の風の加速度(左右、正規化座標)。描画側の風向きインジケーターに使う。 */
  get windAccel(): number {
    return Math.sin(this.elapsed * WIND_FREQUENCY) * this.windAmplitude();
  }

  private bandHalfWidthForBloom(): number {
    return Math.max(
      MIN_BAND_HALF_WIDTH,
      MAX_BAND_HALF_WIDTH - this.bloomed * BAND_SHRINK_PER_BLOOM,
    );
  }

  private hazardSpeedForBloom(): number {
    return Math.min(
      MAX_HAZARD_SPEED,
      BASE_HAZARD_SPEED + this.bloomed * HAZARD_SPEED_GROWTH_PER_BLOOM,
    );
  }

  private windAmplitude(): number {
    return Math.min(MAX_WIND_ACCEL, BASE_WIND_ACCEL + this.bloomed * WIND_GROWTH_PER_BLOOM);
  }

  private spawnTarget(): void {
    const bandHalfWidth = this.bandHalfWidthForBloom();
    this.target = {
      x: randRange(bandHalfWidth, 1 - bandHalfWidth),
      y: TARGET_Y,
      size: randomSize(),
      bandHalfWidth,
    };
  }

  /** 長押しを開始する。既に泡が飛んでいる/既に長押し中なら無視。 */
  startCharging(): void {
    if (this.isOver || this.bubble || this.isCharging) return;
    this.isCharging = true;
    this.charge = 0;
    this.overchargeTimer = 0;
  }

  /** 長押しを離して泡を放つ。長押し中でなければ無視。 */
  releaseBubble(): void {
    if (!this.isCharging) return;
    const size = sizeForCharge(this.charge);
    this.isCharging = false;
    this.charge = 0;
    this.overchargeTimer = 0;
    this.bubble = {
      x: WAND_X,
      y: WAND_Y,
      vx: 0,
      vy: -RISE_SPEED_BY_SIZE[size],
      radius: RADIUS_BY_SIZE[size],
      size,
    };
  }

  /** キーボードの左右長押しで打ち返す方向(-1/0/1)。 */
  setSteerKey(direction: -1 | 0 | 1): void {
    this.steerDirKey = direction;
  }

  /** ドラッグ/タッチで狙う位置(正規化x)。null でキーボード入力に戻す。 */
  setPointerSteerTarget(x: number | null): void {
    this.pointerSteerX = x === null ? null : clamp(x, 0, 1);
  }

  private updateHazard(deltaSeconds: number): void {
    const speed = this.hazardSpeedForBloom();
    const direction = this.hazard.vx < 0 ? -1 : 1;
    this.hazard.vx = direction * speed;
    this.hazard.x += this.hazard.vx * deltaSeconds;

    const margin = this.hazard.radius;
    if (this.hazard.x <= margin) {
      this.hazard.x = margin;
      this.hazard.vx = speed;
    } else if (this.hazard.x >= 1 - margin) {
      this.hazard.x = 1 - margin;
      this.hazard.vx = -speed;
    }
  }

  private updateCharging(deltaSeconds: number): void {
    if (!this.isCharging) return;
    this.charge = Math.min(1, this.charge + deltaSeconds / CHARGE_MAX_SECONDS);
    if (this.charge < 1) {
      this.overchargeTimer = 0;
      return;
    }
    this.overchargeTimer += deltaSeconds;
    if (this.overchargeTimer >= OVERCHARGE_GRACE_SECONDS) {
      this.isCharging = false;
      this.charge = 0;
      this.overchargeTimer = 0;
      this.failRound("overcharge");
    }
  }

  private updateBubble(deltaSeconds: number): void {
    const bubble = this.bubble;
    if (!bubble) return;

    const windAccel = Math.sin(this.elapsed * WIND_FREQUENCY) * this.windAmplitude();
    const desiredDir =
      this.pointerSteerX === null
        ? this.steerDirKey
        : clamp((this.pointerSteerX - bubble.x) / STEER_PROPORTIONAL_RANGE, -1, 1);

    bubble.vx += (desiredDir * STEER_ACCEL + windAccel) * deltaSeconds;
    const dragFactor = Math.max(0, 1 - STEER_DRAG_PER_SECOND * deltaSeconds);
    bubble.vx = clamp(bubble.vx * dragFactor, -MAX_STEER_SPEED, MAX_STEER_SPEED);

    bubble.x += bubble.vx * deltaSeconds;
    bubble.y += bubble.vy * deltaSeconds;

    const margin = bubble.radius;
    if (bubble.x < margin) {
      bubble.x = margin;
      bubble.vx = Math.max(0, bubble.vx);
    } else if (bubble.x > 1 - margin) {
      bubble.x = 1 - margin;
      bubble.vx = Math.min(0, bubble.vx);
    }

    const hazardDist = Math.hypot(bubble.x - this.hazard.x, bubble.y - this.hazard.y);
    if (hazardDist < bubble.radius + this.hazard.radius) {
      this.failRound("hazard");
      return;
    }

    if (bubble.y <= this.target.y) {
      this.resolveArrival();
    }
  }

  private resolveArrival(): void {
    const bubble = this.bubble;
    if (!bubble) return;

    const sizeMatches = bubble.size === this.target.size;
    const offset = Math.abs(bubble.x - this.target.x);
    const isCentered = offset <= this.target.bandHalfWidth;

    if (sizeMatches && isCentered) {
      const isPerfect = offset <= this.target.bandHalfWidth * PERFECT_BAND_RATIO;
      this.combo += 1;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      const comboBonus = Math.min(MAX_COMBO_BONUS, this.combo * COMBO_BONUS_PER_STREAK);
      const perfectBonus = isPerfect ? PERFECT_BONUS : 0;
      const points = BASE_POINTS + comboBonus + perfectBonus;

      this.score += points;
      this.bloomed += 1;
      this.vitality = clampVitality(this.vitality + MATCH_RECOVER);
      this.bubble = null;
      this.onFlowerMatched?.({ size: bubble.size, isPerfect, points, combo: this.combo });
      this.spawnTarget();
      return;
    }

    this.failRound(sizeMatches ? "off-center" : "wrong-size");
  }

  private failRound(reason: BubbleLostReason): void {
    this.combo = 0;
    const penalty =
      reason === "hazard"
        ? HAZARD_PENALTY
        : reason === "overcharge"
          ? OVERCHARGE_PENALTY
          : MISS_PENALTY;
    this.vitality = clampVitality(this.vitality - penalty);
    this.bubble = null;
    this.onBubbleLost?.({ reason, vitality: this.vitality });

    if (this.vitality <= 0) {
      this.isOver = true;
      this.onGardenWilted?.({ score: this.score, maxCombo: this.maxCombo, bloomed: this.bloomed });
      return;
    }
    this.spawnTarget();
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;
    this.elapsed += deltaSeconds;
    this.updateHazard(deltaSeconds);
    this.updateCharging(deltaSeconds);
    this.updateBubble(deltaSeconds);
  }
}
