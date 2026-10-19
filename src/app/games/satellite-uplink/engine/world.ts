export const AZIMUTH_MAX = 360;
export const ELEVATION_MIN = 10;
export const ELEVATION_MAX = 80;
export const LOCK_TOLERANCE_DEG = 9;
export const STATIC_MAX = 100;
export const COMBO_CAP_SECONDS = 6;

const INITIAL_DISH_AZ = 40;
const INITIAL_DISH_EL = 25;
const INITIAL_SAT_AZ = 220;
const INITIAL_SAT_EL = 55;

const AZ_SPEED_BASE = 14;
const AZ_SPEED_VARIANCE = 10;
const AZ_SPEED_DIFFICULTY_GROWTH_PER_SEC = 0.6;
const MAX_DIFFICULTY_BONUS = 18;
const ELEVATION_APPROACH_RATE_DEG_PER_SEC = 10;
const ELEVATION_TARGET_MARGIN = 10;

const MANEUVER_INTERVAL_MIN = 2.5;
const MANEUVER_INTERVAL_MAX = 4.5;

const STATIC_GROWTH_PER_SEC = 14;
const STATIC_DECAY_PER_SEC = 20;
const DATA_RATE_BASE = 40;

/** 0..360の角度に正規化する(負数・360超も扱う)。 */
export function wrapDeg(value: number): number {
  const wrapped = value % AZIMUTH_MAX;
  return wrapped < 0 ? wrapped + AZIMUTH_MAX : wrapped;
}

/** 方位角どうしの最短角度差(0〜180)。0度と359度のような境界をまたぐ差を正しく扱う。 */
export function circularDistanceDeg(a: number, b: number): number {
  const diff = Math.abs(wrapDeg(a) - wrapDeg(b)) % AZIMUTH_MAX;
  return diff > AZIMUTH_MAX / 2 ? AZIMUTH_MAX - diff : diff;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * パラボラアンテナで夜空を横切る衛星を追尾するリアルタイム・トラッキングパズルの
 * 純粋ロジック層。React / pixi.js には依存しない。
 *
 * 方位角(azimuth, 0〜360度・周回)と高度角(elevation)の2軸でアンテナと衛星の
 * 位置を管理し、両者の角度差が許容範囲内ならロック成立とみなす。
 */
export class SatelliteUplinkWorld {
  dishAz = INITIAL_DISH_AZ;
  dishEl = INITIAL_DISH_EL;
  satAz = INITIAL_SAT_AZ;
  satEl = INITIAL_SAT_EL;

  score = 0;
  lockStreakSeconds = 0;
  staticLevel = 0;
  isOver = false;
  isLocked = false;

  private survivedSeconds = 0;
  private maneuverTimer = 0;
  private azVelocityDegPerSec = AZ_SPEED_BASE;
  private elTargetDeg = INITIAL_SAT_EL;
  private readonly randomFn: () => number;

  /** randomFn を差し替えられるのはテストで決定的な衛星の動きを再現するため(本番は Math.random)。 */
  constructor(randomFn: () => number = Math.random) {
    this.randomFn = randomFn;
    this.reset();
  }

  reset(): void {
    this.dishAz = INITIAL_DISH_AZ;
    this.dishEl = INITIAL_DISH_EL;
    this.satAz = INITIAL_SAT_AZ;
    this.satEl = INITIAL_SAT_EL;

    this.score = 0;
    this.lockStreakSeconds = 0;
    this.staticLevel = 0;
    this.isOver = false;
    this.isLocked = false;

    this.survivedSeconds = 0;
    this.azVelocityDegPerSec = AZ_SPEED_BASE;
    this.elTargetDeg = INITIAL_SAT_EL;
    this.maneuverTimer = MANEUVER_INTERVAL_MIN;
  }

  /** アンテナを指定の方位角・高度角へ直接向ける(ポインター操作用。絶対指定)。 */
  setDishAim(az: number, el: number): void {
    if (this.isOver) return;
    this.dishAz = wrapDeg(az);
    this.dishEl = clamp(el, ELEVATION_MIN, ELEVATION_MAX);
  }

  /** アンテナを現在の向きから相対的に動かす(キーボード操作用)。 */
  turnDish(deltaAzDeg: number, deltaElDeg: number): void {
    this.setDishAim(this.dishAz + deltaAzDeg, this.dishEl + deltaElDeg);
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    this.survivedSeconds += deltaSeconds;

    this.maneuverTimer -= deltaSeconds;
    if (this.maneuverTimer <= 0) {
      this.pickManeuver();
    }

    const difficultyBonus = Math.min(
      MAX_DIFFICULTY_BONUS,
      this.survivedSeconds * AZ_SPEED_DIFFICULTY_GROWTH_PER_SEC,
    );
    const azSign = this.azVelocityDegPerSec < 0 ? -1 : 1;
    const azSpeed = azSign * (Math.abs(this.azVelocityDegPerSec) + difficultyBonus);
    this.satAz = wrapDeg(this.satAz + azSpeed * deltaSeconds);

    const elDelta = this.elTargetDeg - this.satEl;
    const elStep =
      Math.sign(elDelta) *
      Math.min(Math.abs(elDelta), ELEVATION_APPROACH_RATE_DEG_PER_SEC * deltaSeconds);
    this.satEl = clamp(this.satEl + elStep, ELEVATION_MIN, ELEVATION_MAX);

    const azDist = circularDistanceDeg(this.dishAz, this.satAz);
    const elDist = Math.abs(this.dishEl - this.satEl);
    const combinedDist = Math.hypot(azDist, elDist);
    this.isLocked = combinedDist <= LOCK_TOLERANCE_DEG;

    if (this.isLocked) {
      this.lockStreakSeconds += deltaSeconds;
      this.staticLevel = Math.max(0, this.staticLevel - STATIC_DECAY_PER_SEC * deltaSeconds);
      const comboMultiplier =
        1 + Math.min(this.lockStreakSeconds, COMBO_CAP_SECONDS) / COMBO_CAP_SECONDS;
      this.score += DATA_RATE_BASE * comboMultiplier * deltaSeconds;
    } else {
      this.lockStreakSeconds = 0;
      this.staticLevel = Math.min(
        STATIC_MAX,
        this.staticLevel + STATIC_GROWTH_PER_SEC * deltaSeconds,
      );
      if (this.staticLevel >= STATIC_MAX) {
        this.staticLevel = STATIC_MAX;
        this.isOver = true;
      }
    }
  }

  private pickManeuver(): void {
    const sign = this.randomFn() < 0.5 ? -1 : 1;
    this.azVelocityDegPerSec = sign * (AZ_SPEED_BASE + this.randomFn() * AZ_SPEED_VARIANCE);
    this.elTargetDeg =
      ELEVATION_MIN +
      ELEVATION_TARGET_MARGIN +
      this.randomFn() * (ELEVATION_MAX - ELEVATION_MIN - ELEVATION_TARGET_MARGIN * 2);
    this.maneuverTimer =
      MANEUVER_INTERVAL_MIN + this.randomFn() * (MANEUVER_INTERVAL_MAX - MANEUVER_INTERVAL_MIN);
  }
}
