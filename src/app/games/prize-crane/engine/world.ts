export const PRIZE_TIERS = ["plush", "robot", "gem"] as const;
export type PrizeTier = (typeof PRIZE_TIERS)[number];

export const SLOT_X_RATIOS = [0.22, 0.39, 0.56, 0.73, 0.9] as const;
export const PRIZE_SLOT_COUNT = SLOT_X_RATIOS.length;

/** クレーンがこの範囲(レール左端)まで来ている間に置くと搬出成功になる。 */
export const CHUTE_X_MAX = 0.12;

export const ATTEMPTS_MAX = 8;

export type ClawPhase = "idle" | "descending" | "ascending" | "carrying";

export interface Prize {
  readonly id: number;
  readonly slotIndex: number;
  readonly tier: PrizeTier;
  readonly x: number;
}

export interface GrabEvent {
  success: boolean;
  tier: PrizeTier | null;
}

export type DropReason = "fumble" | "swing";

export interface DropEvent {
  reason: DropReason;
  tier: PrizeTier;
}

export interface DeliverEvent {
  tier: PrizeTier;
  points: number;
}

interface TierConfig {
  /** つかめる判定の許容距離(レール比率)。重い景品ほど狙いが厳しい。 */
  tolerance: number;
  value: number;
  /** 出現しやすさの重み。合計は1である必要はない(相対比として使う)。 */
  spawnWeight: number;
}

const TIER_CONFIG: Record<PrizeTier, TierConfig> = {
  plush: { tolerance: 0.09, value: 50, spawnWeight: 0.55 },
  robot: { tolerance: 0.06, value: 120, spawnWeight: 0.3 },
  gem: { tolerance: 0.035, value: 300, spawnWeight: 0.15 },
};

const DESCEND_DURATION = 0.6;
const ASCEND_DURATION = 0.6;
const MIN_DURATION_MULTIPLIER = 0.6;
const DURATION_DECAY_PER_SUCCESS = 0.07;

const MIN_TOLERANCE_MULTIPLIER = 0.55;
const TOLERANCE_DECAY_PER_SUCCESS = 0.08;

const SWING_MAX = 1;
// レール全幅(距離1.0)を一気に動かしても1回なら振り切れない(0.9 < SWING_MAX)が、
// 往復(シェイク)するとすぐ上限に達して取り落とす値にしてある。
const SWING_GROWTH_PER_UNIT_MOVE = 0.9;
const SWING_DECAY_PER_SECOND = 0.5;

const COMBO_BONUS_PER_STREAK = 20;

/** 景品tierの基礎点。UIのプレビュー表示やテストでも同じ値を使うための公開API。 */
export function getPrizeValue(tier: PrizeTier): number {
  return TIER_CONFIG[tier].value;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function pickRandomTier(): PrizeTier {
  const totalWeight = PRIZE_TIERS.reduce((sum, tier) => sum + TIER_CONFIG[tier].spawnWeight, 0);
  let roll = Math.random() * totalWeight;
  for (const tier of PRIZE_TIERS) {
    roll -= TIER_CONFIG[tier].spawnWeight;
    if (roll <= 0) return tier;
  }
  return PRIZE_TIERS[PRIZE_TIERS.length - 1];
}

/**
 * クレーンゲームの純粋ロジック層。React / pixi.js には依存しない。
 * アーム(クレーン)をレール上で左右に動かし、降ろして景品をつかみ、
 * 搬出口(レール左端)まで運んで置くと得点になる。
 */
export class PrizeCraneWorld {
  private _prizes: Prize[] = [];
  private nextId = 0;
  private successCount = 0;

  private _phase: ClawPhase = "idle";
  private phaseTimer = 0;
  private _clawX = 0.5;
  private grabTargetX = 0.5;
  private _carriedPrize: Prize | null = null;
  private _swing = 0;

  score = 0;
  combo = 0;
  attempts = ATTEMPTS_MAX;
  isOver = false;

  onGrab: ((event: GrabEvent) => void) | null = null;
  onDrop: ((event: DropEvent) => void) | null = null;
  onDeliver: ((event: DeliverEvent) => void) | null = null;

  constructor() {
    this.reset();
  }

  get prizes(): readonly Prize[] {
    return this._prizes;
  }

  get phase(): ClawPhase {
    return this._phase;
  }

  get clawX(): number {
    return this._clawX;
  }

  get carriedTier(): PrizeTier | null {
    return this._carriedPrize?.tier ?? null;
  }

  get swingRatio(): number {
    return this._swing / SWING_MAX;
  }

  /** 0: レール(上) 〜 1: 景品の高さ(下)。描画の補間用。 */
  get clawDepth(): number {
    if (this._phase === "descending") return this.phaseTimer / this.descendDuration;
    if (this._phase === "ascending") return 1 - this.phaseTimer / this.ascendDuration;
    return 0;
  }

  get toleranceMultiplier(): number {
    return Math.max(MIN_TOLERANCE_MULTIPLIER, 1 - this.successCount * TOLERANCE_DECAY_PER_SUCCESS);
  }

  get durationMultiplier(): number {
    return Math.max(MIN_DURATION_MULTIPLIER, 1 - this.successCount * DURATION_DECAY_PER_SUCCESS);
  }

  get descendDuration(): number {
    return DESCEND_DURATION * this.durationMultiplier;
  }

  get ascendDuration(): number {
    return ASCEND_DURATION * this.durationMultiplier;
  }

  reset(): void {
    this._prizes = Array.from({ length: PRIZE_SLOT_COUNT }, (_, slotIndex) =>
      this.spawnAt(slotIndex),
    );
    this.successCount = 0;
    this._phase = "idle";
    this.phaseTimer = 0;
    this._clawX = 0.5;
    this.grabTargetX = 0.5;
    this._carriedPrize = null;
    this._swing = 0;
    this.score = 0;
    this.combo = 0;
    this.attempts = ATTEMPTS_MAX;
    this.isOver = false;
  }

  /** クレーンをレール上で移動する。降下・上昇中は受け付けない。 */
  setClawX(x: number): void {
    if (this.isOver) return;
    if (this._phase === "descending" || this._phase === "ascending") return;

    const clamped = clamp01(x);
    if (this._phase === "carrying") {
      const delta = Math.abs(clamped - this._clawX);
      this._swing = Math.min(SWING_MAX, this._swing + delta * SWING_GROWTH_PER_UNIT_MOVE);
      this._clawX = clamped;
      if (this._swing >= SWING_MAX) this.dropCarriedPrize("swing");
      return;
    }

    this._clawX = clamped;
  }

  /**
   * 状況に応じて異なる意味を持つ単一アクション:
   * idle → 降下開始(1アテンプト消費) / carrying → 置く(搬出口内なら搬出、外なら取り落とし)。
   * descending / ascending 中は無視する。
   */
  triggerAction(): void {
    if (this.isOver) return;

    if (this._phase === "idle") {
      this.attempts -= 1;
      this.grabTargetX = this._clawX;
      this._phase = "descending";
      this.phaseTimer = 0;
      return;
    }

    if (this._phase === "carrying") {
      if (this._clawX <= CHUTE_X_MAX) {
        this.deliverCarriedPrize();
      } else {
        this.dropCarriedPrize("fumble");
      }
    }
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    if (this._phase === "descending") {
      this.phaseTimer += deltaSeconds;
      if (this.phaseTimer >= this.descendDuration) {
        this.resolveGrab();
        this.phaseTimer = 0;
        this._phase = "ascending";
      }
      return;
    }

    if (this._phase === "ascending") {
      this.phaseTimer += deltaSeconds;
      if (this.phaseTimer >= this.ascendDuration) {
        this.phaseTimer = 0;
        this._phase = this._carriedPrize ? "carrying" : "idle";
        this.endCycleIfOutOfAttempts();
      }
      return;
    }

    if (this._phase === "carrying") {
      this._swing = Math.max(0, this._swing - SWING_DECAY_PER_SECOND * deltaSeconds);
    }
  }

  private resolveGrab(): void {
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this._prizes.length; i++) {
      const prize = this._prizes[i];
      const distance = Math.abs(prize.x - this.grabTargetX);
      const tolerance = TIER_CONFIG[prize.tier].tolerance * this.toleranceMultiplier;
      if (distance <= tolerance && distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }

    if (bestIndex === -1) {
      this.combo = 0;
      this.onGrab?.({ success: false, tier: null });
      return;
    }

    const [prize] = this._prizes.splice(bestIndex, 1);
    this._carriedPrize = prize;
    this.onGrab?.({ success: true, tier: prize.tier });
  }

  private deliverCarriedPrize(): void {
    const prize = this._carriedPrize;
    if (!prize) return;

    const points = TIER_CONFIG[prize.tier].value + this.combo * COMBO_BONUS_PER_STREAK;
    this.score += points;
    this.combo += 1;
    this.successCount += 1;
    this._carriedPrize = null;
    this._swing = 0;
    this._prizes.push(this.spawnAt(prize.slotIndex));
    this._phase = "idle";
    this.onDeliver?.({ tier: prize.tier, points });
    this.endCycleIfOutOfAttempts();
  }

  private dropCarriedPrize(reason: DropReason): void {
    const prize = this._carriedPrize;
    if (!prize) return;

    this._carriedPrize = null;
    this._swing = 0;
    this.combo = 0;
    this._prizes.push(prize);
    this._phase = "idle";
    this.onDrop?.({ reason, tier: prize.tier });
    this.endCycleIfOutOfAttempts();
  }

  private endCycleIfOutOfAttempts(): void {
    if (this._phase === "idle" && this.attempts <= 0) this.isOver = true;
  }

  private spawnAt(slotIndex: number): Prize {
    return {
      id: this.nextId++,
      slotIndex,
      tier: pickRandomTier(),
      x: SLOT_X_RATIOS[slotIndex],
    };
  }
}
