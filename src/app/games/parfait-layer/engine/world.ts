export const INGREDIENT_IDS = ["yogurt", "berry", "mango", "cocoa"] as const;
export type IngredientId = (typeof INGREDIENT_IDS)[number];

export interface RecipeLayer {
  readonly ingredientId: IngredientId;
  readonly minVolume: number;
  readonly maxVolume: number;
}

export interface CommittedLayer {
  readonly ingredientId: IngredientId;
  readonly volume: number;
  readonly quality: number;
}

export type PourFailureReason = "wrong-ingredient" | "overflow";

export interface LayerCommittedEvent {
  layerIndex: number;
  quality: number;
  totalScore: number;
}

export interface PourFailedEvent {
  reason: PourFailureReason;
  livesRemaining: number;
}

export interface ParfaitCompletedEvent {
  round: number;
  totalScore: number;
}

/** グラスの満量を1とした正規化容量。 */
export const GLASS_CAPACITY = 1;
export const INITIAL_LIVES = 3;
/** 注ぎ始めた瞬間の流量(容量/秒)。 */
export const BASE_FLOW_RATE = 0.16;
/** 長押しを続けるほど流量が増える加速度(容量/秒^2)。 */
export const FLOW_ACCEL_PER_SECOND = 0.34;
export const MAX_FLOW_RATE = 0.6;
/** レシピの合計目標量をグラス容量のこの割合までに抑え、溢れる前の余裕を残す。 */
const RECIPE_FILL_RATIO = 0.82;

const MIN_LAYERS = 3;
const MAX_LAYERS = 6;
const BASE_TOLERANCE = 0.035;
const MIN_TOLERANCE = 0.014;
const TOLERANCE_DECAY_PER_ROUND = 0.0025;
const MIN_LAYER_VOLUME = 0.05;
const LAYER_VOLUME_VARIANCE_RATIO = 0.3;
/** 目標の帯から外れたぶんがこの量を超えると部分点も0になる。 */
const QUALITY_FALLOFF_RANGE = 0.06;
/** 帯の外でも近ければ貰える部分点の上限(帯の内側は常に100)。 */
const QUALITY_PARTIAL_MAX = 70;
/** パルフェを1つ完成させたときの追加ボーナス。 */
const COMPLETION_BONUS = 20;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function layerCountForRound(round: number): number {
  return Math.min(MAX_LAYERS, MIN_LAYERS + Math.floor((round - 1) / 2));
}

function toleranceForRound(round: number): number {
  return Math.max(MIN_TOLERANCE, BASE_TOLERANCE - (round - 1) * TOLERANCE_DECAY_PER_ROUND);
}

function availableIngredientCountForRound(round: number): number {
  return round <= 2 ? 3 : INGREDIENT_IDS.length;
}

/**
 * ラウンドごとのレシピ(層の順番・材料・目標量)をランダム生成する。
 * randomFn を差し替えられるのはテストで決定的な結果を再現するため(本番は Math.random)。
 */
export function createRecipe(round: number, randomFn: () => number = Math.random): RecipeLayer[] {
  const layerCount = layerCountForRound(round);
  const ingredientCount = availableIngredientCountForRound(round);
  const tolerance = toleranceForRound(round);
  const baseVolume = (GLASS_CAPACITY * RECIPE_FILL_RATIO) / layerCount;

  const layers: RecipeLayer[] = [];
  let previousIndex = -1;
  for (let i = 0; i < layerCount; i++) {
    let ingredientIndex = Math.floor(randomFn() * ingredientCount);
    // 隣り合う層が同じ材料だと見分けづらいので、連続したら1つずらす(決定的randomFnでも無限ループしない)。
    if (ingredientIndex === previousIndex) {
      ingredientIndex = (ingredientIndex + 1) % ingredientCount;
    }
    previousIndex = ingredientIndex;

    const variance = baseVolume * LAYER_VOLUME_VARIANCE_RATIO;
    const target = Math.max(MIN_LAYER_VOLUME, baseVolume + (randomFn() * 2 - 1) * variance);
    layers.push({
      ingredientId: INGREDIENT_IDS[ingredientIndex],
      minVolume: Math.max(0.01, target - tolerance),
      maxVolume: target + tolerance,
    });
  }
  return layers;
}

/** 注いだ量が目標の帯にどれだけ近いかを 0〜100 の品質スコアに変換する。 */
export function computeLayerQuality(volume: number, layer: RecipeLayer): number {
  const center = (layer.minVolume + layer.maxVolume) / 2;
  const halfWidth = (layer.maxVolume - layer.minVolume) / 2;
  const distance = Math.abs(volume - center);
  if (distance <= halfWidth) return 100;

  const overshoot = distance - halfWidth;
  const ratio = clamp(1 - overshoot / QUALITY_FALLOFF_RANGE, 0, 1);
  return Math.round(ratio * QUALITY_PARTIAL_MAX);
}

/**
 * パルフェをレシピの順番通りに注ぎ重ねるリアルタイム調理パズルの純粋ロジック層。
 * React / pixi.js には一切依存しない。
 *
 * レシピは材料と目標量(帯)の順列。長押しで選択中の材料を注ぎ(長押しが続くほど
 * 流量が増える)、離した瞬間に「レシピ通りの材料か」を判定して層として確定する。
 * 違う材料だった場合、あるいは総量がグラス容量を超えてあふれた場合はライフが減り、
 * その層はやり直し。レシピを最後まで注ぎ切るとボーナスを得て次のラウンド(層が増え
 * 帯が狭まる、より難しいレシピ)へ進む。ライフが尽きるとゲームオーバー。
 */
export class ParfaitLayerWorld {
  round = 1;
  score = 0;
  lives = INITIAL_LIVES;
  recipe: RecipeLayer[] = [];
  recipeIndex = 0;
  committedLayers: CommittedLayer[] = [];
  selectedIngredientId: IngredientId = INGREDIENT_IDS[0];
  isPouring = false;
  currentPourVolume = 0;
  isGameOver = false;

  onLayerCommitted: ((event: LayerCommittedEvent) => void) | null = null;
  onPourFailed: ((event: PourFailedEvent) => void) | null = null;
  onParfaitCompleted: ((event: ParfaitCompletedEvent) => void) | null = null;

  private pourHoldSeconds = 0;
  private readonly randomFn: () => number;

  constructor(randomFn: () => number = Math.random) {
    this.randomFn = randomFn;
    this.reset();
  }

  reset(): void {
    this.round = 1;
    this.score = 0;
    this.lives = INITIAL_LIVES;
    this.recipe = createRecipe(this.round, this.randomFn);
    this.recipeIndex = 0;
    this.committedLayers = [];
    this.selectedIngredientId = INGREDIENT_IDS[0];
    this.isPouring = false;
    this.currentPourVolume = 0;
    this.pourHoldSeconds = 0;
    this.isGameOver = false;
  }

  get currentLayerTarget(): RecipeLayer {
    return this.recipe[this.recipeIndex];
  }

  get committedVolume(): number {
    return this.committedLayers.reduce((sum, layer) => sum + layer.volume, 0);
  }

  get glassFillRatio(): number {
    return (this.committedVolume + this.currentPourVolume) / GLASS_CAPACITY;
  }

  selectIngredient(ingredientId: IngredientId): void {
    this.selectedIngredientId = ingredientId;
  }

  startPour(): void {
    if (this.isGameOver || this.isPouring) return;
    this.isPouring = true;
    this.currentPourVolume = 0;
    this.pourHoldSeconds = 0;
  }

  stopPour(): void {
    if (!this.isPouring) return;
    this.isPouring = false;
    this.commitOrFail();
  }

  /** 採点せずに注ぎを中断する(一時停止など、ユーザーの選択ではない中断に使う)。 */
  cancelPour(): void {
    if (!this.isPouring) return;
    this.isPouring = false;
    this.currentPourVolume = 0;
  }

  step(deltaSeconds: number): void {
    if (this.isGameOver || deltaSeconds <= 0 || !this.isPouring) return;

    this.pourHoldSeconds += deltaSeconds;
    const flowRate = Math.min(
      MAX_FLOW_RATE,
      BASE_FLOW_RATE + this.pourHoldSeconds * FLOW_ACCEL_PER_SECOND,
    );
    this.currentPourVolume += flowRate * deltaSeconds;

    if (this.committedVolume + this.currentPourVolume >= GLASS_CAPACITY) {
      this.currentPourVolume = Math.max(0, GLASS_CAPACITY - this.committedVolume);
      this.isPouring = false;
      this.failPour("overflow");
    }
  }

  private commitOrFail(): void {
    const targetLayer = this.currentLayerTarget;
    if (this.selectedIngredientId !== targetLayer.ingredientId) {
      this.failPour("wrong-ingredient");
      return;
    }

    const quality = computeLayerQuality(this.currentPourVolume, targetLayer);
    this.committedLayers.push({
      ingredientId: targetLayer.ingredientId,
      volume: this.currentPourVolume,
      quality,
    });
    this.score += quality;
    this.currentPourVolume = 0;
    this.recipeIndex += 1;
    this.onLayerCommitted?.({ layerIndex: this.recipeIndex - 1, quality, totalScore: this.score });

    if (this.recipeIndex >= this.recipe.length) this.completeParfait();
  }

  private failPour(reason: PourFailureReason): void {
    this.currentPourVolume = 0;
    this.lives -= 1;
    if (this.lives <= 0) this.isGameOver = true;
    this.onPourFailed?.({ reason, livesRemaining: this.lives });
  }

  private completeParfait(): void {
    this.round += 1;
    this.score += COMPLETION_BONUS;
    this.committedLayers = [];
    this.recipeIndex = 0;
    this.recipe = createRecipe(this.round, this.randomFn);
    this.onParfaitCompleted?.({ round: this.round, totalScore: this.score });
  }
}
