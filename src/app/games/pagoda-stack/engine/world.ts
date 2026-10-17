export interface PlacedTier {
  x: number;
  width: number;
}

export interface TierPlacedEvent {
  height: number;
  points: number;
  overlapRatio: number;
  isPerfect: boolean;
  combo: number;
}

export type CollapseReason = "missed" | "tooNarrow";

export interface CollapseEvent {
  height: number;
  reason: CollapseReason;
}

const BASE_WIDTH_FRAC = 0.4;
const MIN_VIABLE_WIDTH_FRAC = 0.05;
const AMPLITUDE_FRAC = 0.4;
const WIND_AMPLITUDE_FRAC_MAX = 0.06;
const WIND_GROWTH_TIERS = 20;

const SWING_SPEED_BASE = 1.0;
const SWING_SPEED_GROWTH_PER_TIER = 0.045;
const SWING_SPEED_MAX = 3.0;
const WIND_SPEED = 0.33;

export const PERFECT_OVERLAP_RATIO = 0.94;
const BASE_POINTS = 100;
const COMBO_BONUS_RATIO = 0.15;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * 五重塔を一段ずつ積み上げるリアルタイム・スタッキングパズルの純粋ロジック層。
 * React / pixi.js には依存しない。
 *
 * 振り子状に往復する段をタイミングを見てリリースすると、直前の段との重なり幅が
 * そのまま新しい段の幅・位置になる(古典的な積み木ゲームと同じ規則)。ずらすほど
 * 次の段は狭くなり、完全に外すか狭すぎて崩れるとゲームオーバー。振れは積むほど
 * 速くなり、横風による揺らぎも次第に大きくなっていく。
 */
export class PagodaStackWorld {
  width = 0;
  height = 0;

  baseWidth = 0;
  minViableWidth = 0;
  amplitude = 0;

  /** 振れている(未リリースの)段の位相。テストから直接設定して狙った位置を作れる。 */
  swingPhase = 0;
  /** 横風による揺らぎの位相。0のままなら風の影響を無視できる。 */
  windPhase = 0;

  tiers: PlacedTier[] = [];
  score = 0;
  combo = 0;
  isOver = false;

  onTierPlaced: ((event: TierPlacedEvent) => void) | null = null;
  onCollapse: ((event: CollapseEvent) => void) | null = null;

  constructor(width: number, height: number) {
    this.resize(width, height);
    this.reset();
  }

  /** 積み上がっている段数(土台を除く)。スコア表示上の「高さ」。 */
  get stackHeight(): number {
    return this.tiers.length - 1;
  }

  get topTier(): PlacedTier {
    return this.tiers[this.tiers.length - 1];
  }

  get swingSpeed(): number {
    return Math.min(
      SWING_SPEED_MAX,
      SWING_SPEED_BASE + this.stackHeight * SWING_SPEED_GROWTH_PER_TIER,
    );
  }

  get windAmplitude(): number {
    return this.width * WIND_AMPLITUDE_FRAC_MAX * Math.min(1, this.stackHeight / WIND_GROWTH_TIERS);
  }

  /** 現在、振れている段の中心x座標。 */
  get currentX(): number {
    const raw =
      this.width / 2 +
      Math.sin(this.swingPhase) * this.amplitude +
      Math.sin(this.windPhase) * this.windAmplitude;
    return clamp(raw, 0, this.width);
  }

  /** 現在振れている段の幅(常に最上段と同じ幅から始まる)。 */
  get fallingWidth(): number {
    return this.topTier.width;
  }

  reset(): void {
    this.swingPhase = 0;
    this.windPhase = 0;
    this.score = 0;
    this.combo = 0;
    this.isOver = false;
    this.tiers = [{ x: this.width / 2, width: this.baseWidth }];
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const scaleX = this.width > 0 ? width / this.width : 1;

    if (this.width > 0 && scaleX !== 1) {
      for (const tier of this.tiers) {
        tier.x *= scaleX;
        tier.width *= scaleX;
      }
    }

    this.width = width;
    this.height = height;
    this.baseWidth = width * BASE_WIDTH_FRAC;
    this.minViableWidth = width * MIN_VIABLE_WIDTH_FRAC;
    this.amplitude = width * AMPLITUDE_FRAC;
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;
    this.swingPhase += this.swingSpeed * deltaSeconds;
    this.windPhase += WIND_SPEED * deltaSeconds;
  }

  private computeOverlap(): {
    left: number;
    right: number;
    overlapWidth: number;
    fallingWidth: number;
  } {
    const top = this.topTier;
    const fallingWidth = top.width;
    const fallingX = this.currentX;
    const left = Math.max(fallingX - fallingWidth / 2, top.x - top.width / 2);
    const right = Math.min(fallingX + fallingWidth / 2, top.x + top.width / 2);
    return { left, right, overlapWidth: right - left, fallingWidth };
  }

  /**
   * 今落としたら得られるであろう重なり比率(0〜1)。drop() せずに見た目や
   * テストから「今が狙い目かどうか」を判断するための読み取り専用プレビュー。
   */
  get previewOverlapRatio(): number {
    const { overlapWidth, fallingWidth } = this.computeOverlap();
    return clamp(overlapWidth / fallingWidth, 0, 1);
  }

  /**
   * 現在振れている段を落として積む。直前の段との重なりが無ければ(完全に外したら)
   * 塔が崩れてゲームオーバーになる。重なりはあっても狭すぎる場合は、積んだ後に
   * 「薄すぎて崩れる」形でゲームオーバーになる。
   */
  drop(): void {
    if (this.isOver) return;

    const { left, right, overlapWidth, fallingWidth } = this.computeOverlap();

    if (overlapWidth <= 0) {
      this.combo = 0;
      this.isOver = true;
      this.onCollapse?.({ height: this.stackHeight, reason: "missed" });
      return;
    }

    const newWidth = overlapWidth;
    const newX = (left + right) / 2;
    const overlapRatio = overlapWidth / fallingWidth;
    const isPerfect = overlapRatio >= PERFECT_OVERLAP_RATIO;

    this.combo = isPerfect ? this.combo + 1 : 0;
    const points = Math.max(
      1,
      Math.round(BASE_POINTS * overlapRatio * (1 + this.combo * COMBO_BONUS_RATIO)),
    );
    this.score += points;
    this.tiers.push({ x: newX, width: newWidth });

    this.onTierPlaced?.({
      height: this.stackHeight,
      points,
      overlapRatio,
      isPerfect,
      combo: this.combo,
    });

    if (newWidth < this.minViableWidth) {
      this.isOver = true;
      this.onCollapse?.({ height: this.stackHeight, reason: "tooNarrow" });
    }
  }
}
