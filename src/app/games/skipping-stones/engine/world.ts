export type ThrowPhase = "aiming" | "flying";
export type ThrowEndReason = "hazard" | "slow";
export type FlickTier = "none" | "ok" | "perfect";

export interface Hazard {
  id: number;
  zStart: number;
  zEnd: number;
  x: number;
  radius: number;
}

export interface BonusPad {
  id: number;
  zStart: number;
  zEnd: number;
  x: number;
  radius: number;
}

export interface SkipEvent {
  skipCount: number;
  points: number;
  flickTier: FlickTier;
  x: number;
  z: number;
}

export interface BonusEvent {
  points: number;
  x: number;
  z: number;
}

export interface ThrowEndedEvent {
  reason: ThrowEndReason;
  skipCount: number;
  stonesRemaining: number;
  isGameOver: boolean;
}

const GRAVITY = 18;
// 常に水面に対して浅い角度(約16度)で打ち出す。パワーは速度だけを変え、
// 角度は常に跳ねやすい範囲に保たれる(プロトタイプとして「角度調整」の
// 負担をプレイヤーに課さない代わりに、パワー・左右・着水タイミングで競わせる)。
const SKIP_LAUNCH_TAN = Math.tan((16 * Math.PI) / 180);
const BASE_VZ = 10;
const VZ_RANGE = 9;
const LATERAL_LAUNCH_SPEED = 7;
export const LANE_HALF_WIDTH = 8;
const SKIP_ANGLE_MAX_DEG = 34;
const MIN_SKIP_SPEED = 3.5;
const REBOUND_BASE = 0.6;
const REBOUND_OK_BONUS = 0.08;
const REBOUND_PERFECT_BONUS = 0.18;
const SPEED_RETENTION_BASE = 0.8;
const SPEED_RETENTION_OK_BONUS = 0.04;
const SPEED_RETENTION_PERFECT_BONUS = 0.09;
// 着水までの残り時間がこの範囲内にタップすると「はじき」が成立する。
const FLICK_PERFECT_WINDOW_SECONDS = 0.07;
const FLICK_OK_WINDOW_SECONDS = 0.22;
const BASE_SKIP_POINTS = 10;
const COMBO_STEP_POINTS = 3;
const OK_FLICK_BONUS_POINTS = 8;
const PERFECT_FLICK_BONUS_POINTS = 20;
const BONUS_PAD_POINTS = 40;
export const TOTAL_STONES = 8;
// 生涯スキップ数がこの値に達するまで障害物(浮き草の切れ目)は出現しない。
// 弱い・まっすぐな投げの最初の数投は必ず安全に跳ねられる。
const HAZARD_UNLOCK_TOTAL_SKIPS = 6;
const MIN_HAZARD_Z = 9;
const HAZARD_Z_STEP = 6;
const MAX_HAZARDS = 3;
const HAZARD_RADIUS = 1.6;
const MIN_BONUS_Z = 5;
const BONUS_Z_STEP = 7;
const MAX_BONUS_PADS = 2;
const BONUS_RADIUS = 1.4;
const LATERAL_STEER_ACCEL = 26;
const LATERAL_STEER_MAX_SPEED = 10;
const LATERAL_STEER_DAMPING_PER_SECOND = 5;
const POINTER_STEER_SPEED = 20;
const MIN_AIM_POWER = 0.1;
const MAX_AIM_LATERAL = 1;

let nextId = 1;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * 水面を切るように石を投げて跳ね続けさせるリアルタイム水切り物理の純粋ロジック層。
 * React / three.js には一切依存しない。
 *
 * 各スキップ(着水から次の着水まで)は打ち出し角と着水角が等しい対称な放物線になるため、
 * 区間ごとの飛行時間・落下地点を毎フレームの数値積分ではなく closed-form (解析解)で
 * 計算する。浮動小数点誤差が蓄積せず、同じ入力なら常に同じ軌道になるのでテストもしやすい。
 */
export class SkippingStonesWorld {
  width = 0;
  height = 0;

  phase: ThrowPhase = "aiming";
  isOver = false;
  score = 0;
  stonesRemaining = TOTAL_STONES;
  skipCount = 0;
  bestSkipChain = 0;
  totalSkips = 0;

  aimPower = 0.5;
  aimLateral = 0;

  /** 石の左右位置(水切り単位)。奥行き(z)は常に0から始まり、着水ごとに進む。 */
  x = 0;
  z = 0;

  hazards: Hazard[] = [];
  bonusPads: BonusPad[] = [];

  onSkip: ((event: SkipEvent) => void) | null = null;
  onBonus: ((event: BonusEvent) => void) | null = null;
  onThrowEnded: ((event: ThrowEndedEvent) => void) | null = null;

  private vz = 0;
  private vy0 = 0;
  private segmentElapsed = 0;
  private segmentDuration = 0;
  private lateralVelocity = 0;
  private steeringInput: -1 | 0 | 1 = 0;
  private pointerTargetX: number | null = null;
  private lastFlickElapsedInSegment: number | null = null;

  constructor(width: number, height: number) {
    this.resize(width, height);
    this.reset();
  }

  reset(): void {
    this.phase = "aiming";
    this.isOver = false;
    this.score = 0;
    this.stonesRemaining = TOTAL_STONES;
    this.skipCount = 0;
    this.bestSkipChain = 0;
    this.totalSkips = 0;
    this.aimPower = 0.5;
    this.aimLateral = 0;
    this.x = 0;
    this.z = 0;
    this.vz = 0;
    this.vy0 = 0;
    this.segmentElapsed = 0;
    this.segmentDuration = 0;
    this.lateralVelocity = 0;
    this.steeringInput = 0;
    this.pointerTargetX = null;
    this.lastFlickElapsedInSegment = null;
    this.spawnHazardsAndBonuses();
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.width = width;
    this.height = height;
  }

  /** 画面サイズに対する正規化スケール。ドラッグ量をパワーに変換する基準に使う。 */
  private get travelScale(): number {
    return Math.max(Math.min(this.width, this.height), 1);
  }

  /** 現在の飛行区間での水面からの高さ(0=水面)。aiming中/停止中は常に0。 */
  get airHeight(): number {
    if (this.phase !== "flying") return 0;
    const t = this.segmentElapsed;
    return Math.max(0, this.vy0 * t - 0.5 * GRAVITY * t * t);
  }

  /** 次の着水までの残り時間(秒)。aiming中は null。はじきタイミングのヒント表示に使う。 */
  get timeToNextContact(): number | null {
    if (this.phase !== "flying") return null;
    return Math.max(0, this.segmentDuration - this.segmentElapsed);
  }

  /** ドラッグ量(アンカーから引いた分, px)から狙いのパワー・左右を更新する。 */
  setAimFromDrag(dx: number, dy: number): void {
    if (this.isOver || this.phase !== "aiming") return;
    // 水面(奥)と逆方向=手前に引いた距離をパワーに変換する。
    const pull = Math.max(dy, 0);
    const maxPull = this.travelScale * 0.35;
    this.aimPower = clamp(pull / maxPull, MIN_AIM_POWER, 1);
    this.aimLateral = clamp(-dx / maxPull, -MAX_AIM_LATERAL, MAX_AIM_LATERAL);
  }

  adjustPower(delta: number): void {
    if (this.isOver || this.phase !== "aiming") return;
    this.aimPower = clamp(this.aimPower + delta, MIN_AIM_POWER, 1);
  }

  adjustAimLateral(delta: number): void {
    if (this.isOver || this.phase !== "aiming") return;
    this.aimLateral = clamp(this.aimLateral + delta, -MAX_AIM_LATERAL, MAX_AIM_LATERAL);
  }

  /** 飛行中のドラッグ操作の目標左右位置([-LANE_HALF_WIDTH, LANE_HALF_WIDTH])。 */
  setSteerTarget(targetX: number | null): void {
    this.pointerTargetX =
      targetX === null ? null : clamp(targetX, -LANE_HALF_WIDTH, LANE_HALF_WIDTH);
  }

  /** キーボードの連続的な左右入力(-1=左, 0=停止, 1=右)。 */
  setSteeringInput(direction: -1 | 0 | 1): void {
    this.steeringInput = direction;
  }

  /** 着水の直前にタップ/Enterすると「はじき」を狙える。判定は次の着水時に行う。 */
  requestFlick(): void {
    if (this.isOver || this.phase !== "flying") return;
    this.lastFlickElapsedInSegment = this.segmentElapsed;
  }

  releaseThrow(): void {
    if (this.isOver || this.phase !== "aiming" || this.stonesRemaining <= 0) return;
    this.stonesRemaining -= 1;
    this.skipCount = 0;
    this.x = 0;
    this.z = 0;
    this.lateralVelocity = this.aimLateral * LATERAL_LAUNCH_SPEED;
    this.pointerTargetX = null;
    this.steeringInput = 0;
    this.vz = BASE_VZ + this.aimPower * VZ_RANGE;
    this.vy0 = this.vz * SKIP_LAUNCH_TAN;
    this.segmentElapsed = 0;
    this.segmentDuration = (2 * this.vy0) / GRAVITY;
    this.lastFlickElapsedInSegment = null;
    this.phase = "flying";
  }

  step(deltaSeconds: number): void {
    if (this.isOver || this.phase !== "flying" || deltaSeconds <= 0) return;

    this.updateLateral(deltaSeconds);

    this.segmentElapsed += deltaSeconds;
    if (this.segmentElapsed < this.segmentDuration) return;

    this.z += this.vz * this.segmentDuration;
    this.resolveContact();
  }

  private updateLateral(deltaSeconds: number): void {
    if (this.pointerTargetX !== null) {
      const delta = this.pointerTargetX - this.x;
      const maxStep = POINTER_STEER_SPEED * deltaSeconds;
      this.x += clamp(delta, -maxStep, maxStep);
      this.lateralVelocity = 0;
    } else {
      this.lateralVelocity += this.steeringInput * LATERAL_STEER_ACCEL * deltaSeconds;
      this.lateralVelocity = clamp(
        this.lateralVelocity,
        -LATERAL_STEER_MAX_SPEED,
        LATERAL_STEER_MAX_SPEED,
      );
      if (this.steeringInput === 0) {
        const damping = Math.max(0, 1 - LATERAL_STEER_DAMPING_PER_SECOND * deltaSeconds);
        this.lateralVelocity *= damping;
      }
      this.x += this.lateralVelocity * deltaSeconds;
    }
    this.x = clamp(this.x, -LANE_HALF_WIDTH, LANE_HALF_WIDTH);
  }

  private resolveContact(): void {
    const hazard = this.hazards.find(
      (h) => this.z >= h.zStart && this.z <= h.zEnd && Math.abs(this.x - h.x) <= h.radius,
    );
    if (hazard) {
      this.endThrow("hazard");
      return;
    }

    const impactAngleDeg = (Math.atan2(this.vy0, this.vz) * 180) / Math.PI;
    if (impactAngleDeg > SKIP_ANGLE_MAX_DEG || this.vz < MIN_SKIP_SPEED) {
      this.endThrow("slow");
      return;
    }

    const flickTier = this.resolveFlickTier();
    this.lastFlickElapsedInSegment = null;

    const reboundFactor =
      REBOUND_BASE +
      (flickTier === "perfect" ? REBOUND_PERFECT_BONUS : flickTier === "ok" ? REBOUND_OK_BONUS : 0);
    const speedRetention =
      SPEED_RETENTION_BASE +
      (flickTier === "perfect"
        ? SPEED_RETENTION_PERFECT_BONUS
        : flickTier === "ok"
          ? SPEED_RETENTION_OK_BONUS
          : 0);

    this.vy0 *= reboundFactor;
    this.vz *= speedRetention;
    this.segmentElapsed = 0;
    this.segmentDuration = (2 * this.vy0) / GRAVITY;

    this.skipCount += 1;
    this.totalSkips += 1;
    this.bestSkipChain = Math.max(this.bestSkipChain, this.skipCount);

    const flickBonusPoints =
      flickTier === "perfect"
        ? PERFECT_FLICK_BONUS_POINTS
        : flickTier === "ok"
          ? OK_FLICK_BONUS_POINTS
          : 0;
    const points = BASE_SKIP_POINTS + this.skipCount * COMBO_STEP_POINTS + flickBonusPoints;
    this.score += points;
    this.onSkip?.({ skipCount: this.skipCount, points, flickTier, x: this.x, z: this.z });

    const bonus = this.bonusPads.find(
      (b) => this.z >= b.zStart && this.z <= b.zEnd && Math.abs(this.x - b.x) <= b.radius,
    );
    if (bonus) {
      this.bonusPads = this.bonusPads.filter((pad) => pad.id !== bonus.id);
      this.score += BONUS_PAD_POINTS;
      this.onBonus?.({ points: BONUS_PAD_POINTS, x: this.x, z: this.z });
    }
  }

  private resolveFlickTier(): FlickTier {
    if (this.lastFlickElapsedInSegment === null) return "none";
    const timingError = Math.abs(this.segmentDuration - this.lastFlickElapsedInSegment);
    if (timingError <= FLICK_PERFECT_WINDOW_SECONDS) return "perfect";
    if (timingError <= FLICK_OK_WINDOW_SECONDS) return "ok";
    return "none";
  }

  private endThrow(reason: ThrowEndReason): void {
    this.phase = "aiming";
    if (this.stonesRemaining <= 0) this.isOver = true;
    if (!this.isOver) this.spawnHazardsAndBonuses();

    this.onThrowEnded?.({
      reason,
      skipCount: this.skipCount,
      stonesRemaining: this.stonesRemaining,
      isGameOver: this.isOver,
    });
  }

  private spawnHazardsAndBonuses(): void {
    this.hazards = [];
    this.bonusPads = [];

    if (this.totalSkips >= HAZARD_UNLOCK_TOTAL_SKIPS) {
      const hazardCount = Math.min(
        MAX_HAZARDS,
        1 + Math.floor((this.totalSkips - HAZARD_UNLOCK_TOTAL_SKIPS) / 5),
      );
      for (let i = 0; i < hazardCount; i++) {
        const zStart = MIN_HAZARD_Z + i * HAZARD_Z_STEP + randRange(0, HAZARD_Z_STEP * 0.5);
        this.hazards.push({
          id: nextId++,
          zStart,
          zEnd: zStart + HAZARD_RADIUS * 2,
          x: randRange(-LANE_HALF_WIDTH * 0.8, LANE_HALF_WIDTH * 0.8),
          radius: HAZARD_RADIUS,
        });
      }
    }

    const bonusRoll = Math.random();
    const bonusCount = bonusRoll < 0.3 ? 2 : bonusRoll < 0.85 ? 1 : 0;
    for (let i = 0; i < Math.min(bonusCount, MAX_BONUS_PADS); i++) {
      const zStart = MIN_BONUS_Z + i * BONUS_Z_STEP + randRange(0, BONUS_Z_STEP * 0.5);
      this.bonusPads.push({
        id: nextId++,
        zStart,
        zEnd: zStart + BONUS_RADIUS * 2,
        x: randRange(-LANE_HALF_WIDTH * 0.6, LANE_HALF_WIDTH * 0.6),
        radius: BONUS_RADIUS,
      });
    }
  }
}
