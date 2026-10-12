export type RoundEndReason = "folded" | "weak" | "snapped" | "toughened";

export interface RoundResolvedEvent {
  round: number;
  reason: RoundEndReason;
  roundScore: number;
  totalScore: number;
  strandCount: number;
}

export const FRESHNESS_MAX = 100;
/** これ未満の伸びで離すと「まだ緩い」とみなし、何も起きない(空振り)。 */
export const MIN_FOLD_STRETCH = 0.12;
/** これ以上伸ばすと、離さなくてもその場で千切れる。 */
export const SNAP_STRETCH = 1.3;
/** 安全に伸ばせる上限の目安(的の範囲はここまでに収まる)。表示のスケール上限にも使う。 */
export const MAX_SAFE_STRETCH = 1;

/** 的を外したとき、的の端からどれだけ離れていると0点になるか。 */
const MISS_FALLOFF_RANGE = 0.45;
/** 1秒間に伸ばせる量(指/キーを押し続けている間、一定速度で伸びていく)。 */
const STRETCH_SPEED = 1;
const ROUND_TIME_BASE_SECONDS = 6;
const ROUND_TIME_MIN_SECONDS = 2.6;
const ROUND_TIME_DECAY_PER_ROUND = 0.25;
const ZONE_WIDTH_BASE = 0.34;
const ZONE_WIDTH_MIN = 0.16;
const ZONE_WIDTH_DECAY_PER_ROUND = 0.015;
const ZONE_CENTER_MIN = 0.35;
const ZONE_CENTER_MAX = 0.85;
/** ラウンド終了の結果を見せてから次のラウンドへ移るまでの秒数。 */
export const ROUND_TRANSITION_SECONDS = 1.2;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function roundTimeSeconds(round: number): number {
  return Math.max(
    ROUND_TIME_MIN_SECONDS,
    ROUND_TIME_BASE_SECONDS - (round - 1) * ROUND_TIME_DECAY_PER_ROUND,
  );
}

function zoneWidthForRound(round: number): number {
  return Math.max(ZONE_WIDTH_MIN, ZONE_WIDTH_BASE - (round - 1) * ZONE_WIDTH_DECAY_PER_ROUND);
}

export interface StretchZone {
  min: number;
  max: number;
}

/**
 * ラウンドごとの的(ちょうどいい伸び具合の範囲)をランダム生成する。
 * randomFn を差し替えられるのはテストで決定的な的を再現するため(本番は Math.random)。
 */
export function createStretchZone(
  round: number,
  randomFn: () => number = Math.random,
): StretchZone {
  const width = zoneWidthForRound(round);
  const center = ZONE_CENTER_MIN + randomFn() * (ZONE_CENTER_MAX - ZONE_CENTER_MIN);
  const min = clamp(center - width / 2, MIN_FOLD_STRETCH, MAX_SAFE_STRETCH - 0.05);
  const max = clamp(min + width, min + 0.05, MAX_SAFE_STRETCH);
  return { min, max };
}

/** 現在の伸びと的の近さを 0〜100 のスコアに変換する。的の中なら70〜100、外れても近ければ少し入る。 */
export function computeFoldScore(stretch: number, zone: StretchZone): number {
  if (stretch >= zone.min && stretch <= zone.max) {
    const center = (zone.min + zone.max) / 2;
    const halfWidth = (zone.max - zone.min) / 2;
    const precision = halfWidth <= 0 ? 1 : 1 - Math.abs(stretch - center) / halfWidth;
    return Math.round(70 + 30 * clamp(precision, 0, 1));
  }
  const edgeDistance = stretch < zone.min ? zone.min - stretch : stretch - zone.max;
  const falloff = clamp(1 - edgeDistance / MISS_FALLOFF_RANGE, 0, 1);
  return Math.round(60 * falloff);
}

/**
 * 麺を引き伸ばして畳むリアルタイム拉麺(ラーメン)職人パズルの純粋ロジック層。
 * React / pixi.js には一切依存しない。
 *
 * プレイヤーは指/キーを押し続けて麺を伸ばし(stretch, 0始まり)、的(stretchZone)の
 * 範囲内で離せば「畳み」成功となり、次の麺はより細く(strandCount が倍に)なって
 * 次のラウンドへ進む。的を外しても千切れない範囲なら軽い減点で次のラウンドへ進み、
 * 伸ばしすぎる(SNAP_STRETCH 超え)とその場で千切れて0点になる。何もせず時間(鮮度)が
 * 尽きても、その時点の伸びで採点されて次のラウンドへ進む。どの終わり方でも少し間を
 * 置いて次のラウンド(新しい的と満タンの鮮度)へ自動的に進む、終わりのないエンドレスモード。
 */
export class NoodlePullWorld {
  round = 1;
  score = 0;
  stretch = 0;
  freshness = FRESHNESS_MAX;
  successfulFolds = 0;
  zone: StretchZone;
  isRoundOver = false;
  roundOverReason: RoundEndReason | null = null;
  lastRoundScore = 0;

  onRoundResolved: ((event: RoundResolvedEvent) => void) | null = null;

  private roundOverElapsed = 0;
  private readonly randomFn: () => number;

  constructor(randomFn: () => number = Math.random) {
    this.randomFn = randomFn;
    this.zone = createStretchZone(1, randomFn);
  }

  reset(): void {
    this.round = 1;
    this.score = 0;
    this.stretch = 0;
    this.freshness = FRESHNESS_MAX;
    this.successfulFolds = 0;
    this.zone = createStretchZone(this.round, this.randomFn);
    this.isRoundOver = false;
    this.roundOverReason = null;
    this.lastRoundScore = 0;
    this.roundOverElapsed = 0;
  }

  get freshnessRatio(): number {
    return this.freshness / FRESHNESS_MAX;
  }

  get strandCount(): number {
    return 2 ** this.successfulFolds;
  }

  /** 指/キーを押している間、desiredStretch へ向けて一定速度で伸ばす(離している間は0へ戻す)。 */
  setStretchTarget(desiredStretch: number, deltaSeconds: number): void {
    if (this.isRoundOver || deltaSeconds <= 0) return;

    const desired = Math.max(0, desiredStretch);
    const maxDelta = STRETCH_SPEED * deltaSeconds;
    this.stretch += clamp(desired - this.stretch, -maxDelta, maxDelta);

    if (this.stretch >= SNAP_STRETCH) this.resolveRound("snapped", 0);
  }

  /** 指/キーを離した瞬間に呼ぶ。十分伸びていなければ何もしない(空振り)。 */
  attemptFold(): void {
    if (this.isRoundOver || this.stretch < MIN_FOLD_STRETCH) return;

    const isInZone = this.stretch >= this.zone.min && this.stretch <= this.zone.max;
    const roundScore = computeFoldScore(this.stretch, this.zone);
    this.resolveRound(isInZone ? "folded" : "weak", roundScore);
  }

  step(deltaSeconds: number): void {
    if (deltaSeconds <= 0) return;

    if (this.isRoundOver) {
      this.roundOverElapsed += deltaSeconds;
      if (this.roundOverElapsed >= ROUND_TRANSITION_SECONDS) this.startNextRound();
      return;
    }

    const decayRate = FRESHNESS_MAX / roundTimeSeconds(this.round);
    this.freshness = clamp(this.freshness - decayRate * deltaSeconds, 0, FRESHNESS_MAX);
    if (this.freshness <= 0) {
      this.resolveRound("toughened", computeFoldScore(this.stretch, this.zone));
    }
  }

  private resolveRound(reason: RoundEndReason, roundScore: number): void {
    if (this.isRoundOver) return;

    this.score += roundScore;
    this.lastRoundScore = roundScore;
    if (reason === "folded") this.successfulFolds += 1;
    this.isRoundOver = true;
    this.roundOverReason = reason;
    this.roundOverElapsed = 0;
    this.onRoundResolved?.({
      round: this.round,
      reason,
      roundScore,
      totalScore: this.score,
      strandCount: this.strandCount,
    });
  }

  private startNextRound(): void {
    this.round += 1;
    this.stretch = 0;
    this.freshness = FRESHNESS_MAX;
    this.zone = createStretchZone(this.round, this.randomFn);
    this.isRoundOver = false;
    this.roundOverReason = null;
    this.roundOverElapsed = 0;
  }
}
