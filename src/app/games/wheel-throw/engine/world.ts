export type RoundEndReason = "dried" | "manual" | "collapsed";

export interface RoundResolvedEvent {
  round: number;
  roundScore: number;
  reason: RoundEndReason;
  totalScore: number;
}

/** 粘土の壁を輪切りにした本数。底(index 0)からふち(index BAND_COUNT-1)まで。 */
export const BAND_COUNT = 18;
export const MOISTURE_MAX = 100;
/** これより薄くなった帯があると壁が崩壊する下限半径(正規化済み, 0〜1)。 */
export const MIN_RADIUS = 0.05;
export const MAX_RADIUS = 1;

const INITIAL_RADIUS = 0.45;
/** 水分100%のときに1秒あたり動かせる半径の量。水分が減るほど遅くなる。 */
const SHAPE_SPEED_BASE = 1.5;
/** 水分が尽きても最低限これだけの速さは残る比率(0なら完全に動かせなくなる)。 */
const MOISTURE_SPEED_FLOOR_RATIO = 0.3;
/** 隣接する帯へ形をわずかに均す速さ。強くしすぎると作った形がすぐ溶けてしまう。 */
const SMOOTHING_RATE_PER_SECOND = 1.4;
const SMOOTHING_STRENGTH = 0.15;
const ROUND_DURATION_BASE_SECONDS = 14;
const ROUND_DURATION_MIN_SECONDS = 6;
const ROUND_DURATION_DECAY_PER_ROUND = 0.8;
/** ラウンド終了(仕上げ/崩壊/乾燥)の結果を見せてから次のラウンドへ移るまでの秒数。 */
export const ROUND_TRANSITION_SECONDS = 1.4;
const TARGET_MIN_RADIUS = 0.15;
const TARGET_MAX_RADIUS = 0.92;
const TARGET_BASE_RADIUS = 0.5;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function roundDurationSeconds(round: number): number {
  return Math.max(
    ROUND_DURATION_MIN_SECONDS,
    ROUND_DURATION_BASE_SECONDS - (round - 1) * ROUND_DURATION_DECAY_PER_ROUND,
  );
}

function controlPointCountForRound(round: number): number {
  return Math.min(7, 3 + Math.floor((round - 1) / 2));
}

function varianceForRound(round: number): number {
  return Math.min(0.4, 0.2 + (round - 1) * 0.02);
}

/** 少数の制御点を BAND_COUNT 個へ線形補間で引き伸ばす。 */
function resampleToBandCount(points: number[]): number[] {
  if (points.length === 1) return new Array(BAND_COUNT).fill(points[0]);

  const result: number[] = [];
  for (let i = 0; i < BAND_COUNT; i++) {
    const t = (i / (BAND_COUNT - 1)) * (points.length - 1);
    const lowIndex = Math.floor(t);
    const highIndex = Math.min(points.length - 1, lowIndex + 1);
    const frac = t - lowIndex;
    result.push(points[lowIndex] + (points[highIndex] - points[lowIndex]) * frac);
  }
  return result;
}

/**
 * ラウンドごとのお手本の壺の形をランダム生成する。randomFn を差し替えられるように
 * しているのはテストで決定的な形を再現するため(本番は Math.random)。
 */
export function createTargetProfile(round: number, randomFn: () => number = Math.random): number[] {
  const controlCount = controlPointCountForRound(round);
  const variance = varianceForRound(round);
  const controlPoints = Array.from({ length: controlCount }, () =>
    clamp(
      TARGET_BASE_RADIUS + (randomFn() * 2 - 1) * variance,
      TARGET_MIN_RADIUS,
      TARGET_MAX_RADIUS,
    ),
  );
  return resampleToBandCount(controlPoints);
}

/** 現在の壁の形とお手本の形の近さを 0〜100 のスコアに変換する。 */
export function computeScore(radii: readonly number[], target: readonly number[]): number {
  let totalDiff = 0;
  for (let i = 0; i < radii.length; i++) totalDiff += Math.abs(radii[i] - target[i]);
  const avgDiff = totalDiff / radii.length;
  const normalized = clamp(1 - avgDiff / (MAX_RADIUS - MIN_RADIUS), 0, 1);
  return Math.round(normalized * 100);
}

/**
 * 回転するろくろの上で粘土を形作るリアルタイム陶芸パズルの純粋ロジック層。
 * React / pixi.js には一切依存しない。
 *
 * 粘土は BAND_COUNT 本の高さバンド(半径のみを持つ1次元配列, 正規化済み 0〜1)として
 * モデル化する。プレイヤーは狙った高さの半径を目標値へ向けて動かして形を整え、
 * 水分(moisture)が尽きるか自分で「仕上げる」を選ぶとその形とお手本を比較して採点する。
 * 帯を薄くしすぎる(MIN_RADIUS以下)と崩壊し、そのラウンドは0点で終わる。
 * どちらの終わり方でも少し間を置いて次のラウンド(お手本と水分を一新)へ自動的に進む、
 * 終わりのないエンドレスモード。
 */
export class WheelThrowWorld {
  round = 1;
  score = 0;
  moisture = MOISTURE_MAX;
  radii: number[] = [];
  target: number[] = [];
  /** キーボード操作用の縦カーソル位置(小数)。ポインタ操作時もここが追従する。 */
  cursorPosition = (BAND_COUNT - 1) / 2;
  isRoundOver = false;
  roundOverReason: RoundEndReason | null = null;
  lastRoundScore = 0;

  onRoundResolved: ((event: RoundResolvedEvent) => void) | null = null;

  private roundOverElapsed = 0;
  private readonly randomFn: () => number;

  constructor(randomFn: () => number = Math.random) {
    this.randomFn = randomFn;
    this.reset();
  }

  reset(): void {
    this.round = 1;
    this.score = 0;
    this.moisture = MOISTURE_MAX;
    this.radii = new Array(BAND_COUNT).fill(INITIAL_RADIUS);
    this.target = createTargetProfile(this.round, this.randomFn);
    this.cursorPosition = (BAND_COUNT - 1) / 2;
    this.isRoundOver = false;
    this.roundOverReason = null;
    this.lastRoundScore = 0;
    this.roundOverElapsed = 0;
  }

  get cursorBandIndex(): number {
    return clamp(Math.round(this.cursorPosition), 0, BAND_COUNT - 1);
  }

  get moistureRatio(): number {
    return this.moisture / MOISTURE_MAX;
  }

  moveCursorBy(delta: number): void {
    this.cursorPosition = clamp(this.cursorPosition + delta, 0, BAND_COUNT - 1);
  }

  /** 指定した帯の半径を desiredRadius へ向けて、水分に応じた速さの上限つきで動かす。 */
  applyPressure(bandIndex: number, desiredRadius: number, deltaSeconds: number): void {
    if (this.isRoundOver || deltaSeconds <= 0) return;

    const index = clamp(Math.round(bandIndex), 0, BAND_COUNT - 1);
    this.cursorPosition = index;

    const speedRatio =
      MOISTURE_SPEED_FLOOR_RATIO + (1 - MOISTURE_SPEED_FLOOR_RATIO) * this.moistureRatio;
    const maxDelta = SHAPE_SPEED_BASE * speedRatio * deltaSeconds;
    const desired = clamp(desiredRadius, 0, MAX_RADIUS);
    const current = this.radii[index];
    this.radii[index] = current + clamp(desired - current, -maxDelta, maxDelta);

    if (this.radii[index] <= MIN_RADIUS) this.resolveRound("collapsed");
  }

  /** キーボード操作: カーソル位置の帯を、押した方向の限界値(0 or MAX_RADIUS)へ向けて押す。 */
  adjustRadiusAtCursor(direction: -1 | 1, deltaSeconds: number): void {
    this.applyPressure(this.cursorBandIndex, direction < 0 ? 0 : MAX_RADIUS, deltaSeconds);
  }

  /** 水分が残っているうちに自分の判断でラウンドを終わらせ、その時点の形で採点する。 */
  finishNow(): void {
    if (this.isRoundOver) return;
    this.resolveRound("manual");
  }

  step(deltaSeconds: number): void {
    if (deltaSeconds <= 0) return;

    if (this.isRoundOver) {
      this.roundOverElapsed += deltaSeconds;
      if (this.roundOverElapsed >= ROUND_TRANSITION_SECONDS) this.startNextRound();
      return;
    }

    this.applySmoothing(deltaSeconds);
    if (this.radii.some((radius) => radius <= MIN_RADIUS)) {
      this.resolveRound("collapsed");
      return;
    }

    const dryRate = MOISTURE_MAX / roundDurationSeconds(this.round);
    this.moisture = clamp(this.moisture - dryRate * deltaSeconds, 0, MOISTURE_MAX);
    if (this.moisture <= 0) this.resolveRound("dried");
  }

  private resolveRound(reason: RoundEndReason): void {
    if (this.isRoundOver) return;
    const roundScore = reason === "collapsed" ? 0 : computeScore(this.radii, this.target);
    this.score += roundScore;
    this.lastRoundScore = roundScore;
    this.isRoundOver = true;
    this.roundOverReason = reason;
    this.roundOverElapsed = 0;
    this.onRoundResolved?.({ round: this.round, roundScore, reason, totalScore: this.score });
  }

  private startNextRound(): void {
    this.round += 1;
    this.radii = new Array(BAND_COUNT).fill(INITIAL_RADIUS);
    this.target = createTargetProfile(this.round, this.randomFn);
    this.moisture = MOISTURE_MAX;
    this.isRoundOver = false;
    this.roundOverReason = null;
    this.roundOverElapsed = 0;
  }

  private applySmoothing(deltaSeconds: number): void {
    const rate = Math.min(1, SMOOTHING_RATE_PER_SECOND * deltaSeconds) * SMOOTHING_STRENGTH;
    const next = this.radii.slice();
    for (let i = 0; i < BAND_COUNT; i++) {
      const left = this.radii[Math.max(0, i - 1)];
      const right = this.radii[Math.min(BAND_COUNT - 1, i + 1)];
      const neighborAverage = (left + right) / 2;
      next[i] = this.radii[i] + (neighborAverage - this.radii[i]) * rate;
    }
    this.radii = next;
  }
}
