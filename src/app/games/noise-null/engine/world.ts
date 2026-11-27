export interface Vec2 {
  x: number;
  y: number;
}

export interface ActiveBurst {
  readonly offset: Vec2;
  readonly endsAt: number;
}

const TWO_PI = Math.PI * 2;
const MAX_AMPLITUDE = 1;

const BASE_QUIET_THRESHOLD = 0.55;
const MIN_QUIET_THRESHOLD = 0.28;
const QUIET_THRESHOLD_DECAY_PER_SECOND = 0.0025;

const CALM_CHARGE_RATE = 42; // %/秒（静かな間に回復）
const CALM_DRAIN_RATE = 12.5; // %/秒（うるさい間に減少。何も操作しなければ約8秒で尽きる）

const BASE_BURST_INTERVAL = 6; // 秒
const MIN_BURST_INTERVAL = 2.2;
const BURST_INTERVAL_DECAY_PER_SECOND = 0.015;
const BURST_DURATION = 0.45; // 秒
const GOLDEN_ANGLE = 2.399963; // 黄金角。バーストの方向を毎回均等に散らすための決定的な値。

const SCORE_RATE_PER_SECOND = 18;
const MAX_COMBO_MULTIPLIER = 2;
const COMBO_GROWTH_PER_SECOND = 0.15;

export const RESIDUAL_HISTORY_LENGTH = 180;

export function wrapPhase(phase: number): number {
  const wrapped = phase % TWO_PI;
  return wrapped < 0 ? wrapped + TWO_PI : wrapped;
}

export function toCartesian(amplitude: number, phase: number): Vec2 {
  return { x: amplitude * Math.cos(phase), y: amplitude * Math.sin(phase) };
}

export function vectorLength(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

/** 環境ノイズの振幅。滑らかに揺れ続ける決定的な関数（乱数に依存しないのでテストしやすい）。 */
export function targetAmplitudeAt(elapsedSeconds: number): number {
  const raw =
    0.5 + 0.22 * Math.sin(0.19 * elapsedSeconds) + 0.14 * Math.sin(0.41 * elapsedSeconds + 1.3);
  return Math.min(0.92, Math.max(0.12, raw));
}

/** 環境ノイズの位相。ゆっくり回転し続ける決定的な関数。 */
export function targetPhaseAt(elapsedSeconds: number): number {
  return wrapPhase(0.55 * elapsedSeconds + 0.8 * Math.sin(0.17 * elapsedSeconds));
}

/**
 * Noise Null のゲームロジック。
 *
 * 環境ノイズは振幅と位相を持つ1つのフェーザー（ベクトル）として表現され、時間とともに
 * 滑らかに揺れ動く（{@link targetAmplitudeAt} / {@link targetPhaseAt}）。プレイヤーは
 * 自分のフェーザー（振幅・位相）をドラッグやキー操作で動かし、ノイズとちょうど逆向き・
 * 同振幅（=合成すると打ち消し合う）の位置に重ね続けることを目指す。
 * 一定間隔で決定的に発生する「バースト」（突発的な外乱）が残差を一時的に跳ね上げる。
 */
export class NoiseNullWorld {
  playerAmplitude = 0;
  playerPhase = 0;

  elapsed = 0;
  score = 0;
  calm = 100;
  isOver = false;

  /** このフレームでの残差（ノイズ+プレイヤーの合成ベクトルの大きさ）。小さいほど静か。 */
  lastResidual = 1;
  /** 描画用に残しておく、このフレームのノイズフェーザー（バースト加算後）。 */
  lastTargetVector: Vec2 = { x: 0, y: 0 };
  lastBurstActive = false;
  readonly residualHistory: number[] = [];

  private quietStreak = 0;
  private burstCount = 0;
  private nextBurstAt = BASE_BURST_INTERVAL;
  private activeBurst: ActiveBurst | null = null;

  reset(): void {
    this.playerAmplitude = 0;
    this.playerPhase = 0;
    this.elapsed = 0;
    this.score = 0;
    this.calm = 100;
    this.isOver = false;
    this.lastResidual = 1;
    this.lastTargetVector = { x: 0, y: 0 };
    this.lastBurstActive = false;
    this.residualHistory.length = 0;
    this.quietStreak = 0;
    this.burstCount = 0;
    this.nextBurstAt = BASE_BURST_INTERVAL;
    this.activeBurst = null;
  }

  /** パッド中心からの相対座標とパッド半径から、プレイヤーのフェーザーを決める（ドラッグ操作用）。 */
  setPlayerFromPad(dx: number, dy: number, padRadius: number): void {
    if (padRadius <= 0) return;
    const amplitude = Math.min(MAX_AMPLITUDE, Math.hypot(dx, dy) / padRadius);
    this.playerAmplitude = amplitude;
    if (amplitude > 1e-4) {
      this.playerPhase = wrapPhase(Math.atan2(dy, dx));
    }
  }

  /** キーボード操作用。振幅を±方向に微調整する。 */
  nudgeAmplitude(delta: number): void {
    this.playerAmplitude = Math.min(MAX_AMPLITUDE, Math.max(0, this.playerAmplitude + delta));
  }

  /** キーボード操作用。位相を±方向に微調整する。 */
  nudgePhase(delta: number): void {
    this.playerPhase = wrapPhase(this.playerPhase + delta);
  }

  get quietThreshold(): number {
    return Math.max(
      MIN_QUIET_THRESHOLD,
      BASE_QUIET_THRESHOLD - this.elapsed * QUIET_THRESHOLD_DECAY_PER_SECOND,
    );
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;
    this.elapsed += deltaSeconds;

    this.updateBurst();

    const targetVector = toCartesian(targetAmplitudeAt(this.elapsed), targetPhaseAt(this.elapsed));
    if (this.activeBurst) {
      targetVector.x += this.activeBurst.offset.x;
      targetVector.y += this.activeBurst.offset.y;
    }
    this.lastTargetVector = targetVector;
    this.lastBurstActive = this.activeBurst !== null;

    const playerVector = toCartesian(this.playerAmplitude, this.playerPhase);
    const residual = vectorLength({
      x: playerVector.x + targetVector.x,
      y: playerVector.y + targetVector.y,
    });
    this.lastResidual = residual;

    this.residualHistory.push(residual);
    if (this.residualHistory.length > RESIDUAL_HISTORY_LENGTH) this.residualHistory.shift();

    const isQuiet = residual <= this.quietThreshold;
    if (isQuiet) {
      this.calm = Math.min(100, this.calm + CALM_CHARGE_RATE * deltaSeconds);
      this.quietStreak += deltaSeconds;
      const comboMultiplier = Math.min(
        MAX_COMBO_MULTIPLIER,
        1 + this.quietStreak * COMBO_GROWTH_PER_SECOND,
      );
      this.score += SCORE_RATE_PER_SECOND * comboMultiplier * deltaSeconds;
    } else {
      this.calm = Math.max(0, this.calm - CALM_DRAIN_RATE * deltaSeconds);
      this.quietStreak = 0;
    }

    if (this.calm <= 0) {
      this.calm = 0;
      this.isOver = true;
    }
  }

  private updateBurst(): void {
    if (this.activeBurst && this.elapsed >= this.activeBurst.endsAt) {
      this.activeBurst = null;
    }
    if (!this.activeBurst && this.elapsed >= this.nextBurstAt) {
      const angle = wrapPhase(this.burstCount * GOLDEN_ANGLE);
      const magnitude = 0.32 + 0.06 * (this.burstCount % 3);
      this.activeBurst = {
        offset: toCartesian(magnitude, angle),
        endsAt: this.elapsed + BURST_DURATION,
      };
      this.burstCount += 1;
      const interval = Math.max(
        MIN_BURST_INTERVAL,
        BASE_BURST_INTERVAL - this.elapsed * BURST_INTERVAL_DECAY_PER_SECOND,
      );
      this.nextBurstAt = this.elapsed + interval;
    }
  }
}
