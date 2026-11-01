export type CoinKind = "standard" | "bonus";

export interface Coin {
  id: number;
  kind: CoinKind;
  x: number;
  y: number;
  radius: number;
}

export interface CoinScoredEvent {
  coin: Coin;
  points: number;
}

export const COIN_RADIUS = 14;
export const STOCK_MAX = 10;
export const MAX_ACTIVE_COINS = 60;
export const ROUND_SECONDS = 75;

const STANDARD_POINTS = 10;
const BONUS_POINTS = 50;
const BONUS_CHANCE = 0.12;
const REPLENISH_INTERVAL = 0.5; // 秒/個
const PUSHER_MIN_Y_RATIO = 0.14;
const PUSHER_MAX_Y_RATIO = 0.4;
const PERIOD_START = 2.4; // 秒（1往復ぶんの周期）
const PERIOD_MIN = 1.1;
const TIDE_RATE_RATIO = 0.08; // 1秒あたり画面高さの何割を押し流すか
const RELAXATION_ITERATIONS = 4;

let nextId = 1;

function randomKind(): CoinKind {
  return Math.random() < BONUS_CHANCE ? "bonus" : "standard";
}

/**
 * メダルゲーム風コインプッシャーのワールド。
 *
 * コイン同士の重なりを毎フレーム位置ベースで解消する簡易物理を使い、
 * 「プッシャーに触れたコインを前方へ退避させる」というルールだけで、
 * 奥で詰まったコインが連鎖的に手前のコインを押し出す挙動を再現する。
 * さらに全コインへ常時かかる緩やかな前進（タイド）を加えることで、
 * 積み方に関わらずいつか必ず前縁へ到達する（取りこぼしたコインが
 * 半永久的に奥で止まり続けない）ようにしている。
 */
export class CoinTideWorld {
  width = 0;
  height = 0;
  coins: Coin[] = [];
  score = 0;
  stock = STOCK_MAX;
  timeRemaining = ROUND_SECONDS;
  isOver = false;
  aimX = 0;
  pusherY = 0;
  pusherMinY = 0;
  pusherMaxY = 0;

  onCoinScored: ((event: CoinScoredEvent) => void) | null = null;

  private elapsedSeconds = 0;
  private stockTimer = 0;

  constructor(width: number, height: number) {
    this.resize(width, height);
    this.reset();
  }

  reset(): void {
    this.coins = [];
    this.score = 0;
    this.stock = STOCK_MAX;
    this.timeRemaining = ROUND_SECONDS;
    this.isOver = false;
    this.elapsedSeconds = 0;
    this.stockTimer = 0;
    this.updatePusherRange();
    this.pusherY = this.pusherMinY;
    this.aimX = this.clampX(this.width / 2);
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const scaleX = this.width > 0 ? width / this.width : 1;
    const scaleY = this.height > 0 ? height / this.height : 1;
    if (this.width > 0 && this.height > 0) {
      for (const coin of this.coins) {
        coin.x *= scaleX;
        coin.y *= scaleY;
      }
      this.aimX *= scaleX;
    }
    this.width = width;
    this.height = height;
    this.updatePusherRange();
    this.aimX = this.clampX(this.aimX);
  }

  setAim(x: number): void {
    this.aimX = this.clampX(x);
  }

  dropCoin(): boolean {
    if (this.isOver || this.stock <= 0 || this.coins.length >= MAX_ACTIVE_COINS) return false;
    this.stock -= 1;
    this.coins.push({
      id: nextId++,
      kind: randomKind(),
      x: this.clampX(this.aimX),
      y: this.pusherY + COIN_RADIUS * 0.1,
      radius: COIN_RADIUS,
    });
    return true;
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    this.elapsedSeconds += deltaSeconds;
    this.timeRemaining = Math.max(0, ROUND_SECONDS - this.elapsedSeconds);
    if (this.timeRemaining <= 0) {
      this.isOver = true;
      return;
    }

    // ストックが満タンの間は積算時間を貯め込まない。貯めてしまうと、
    // 満タンのまま待った後に1枚だけ投入した瞬間、貯まった分が一括放出されて
    // ストックが実質1フレームで満タンに戻ってしまう(減った演出が一切見えない)。
    this.stockTimer = this.stock >= STOCK_MAX ? 0 : this.stockTimer + deltaSeconds;
    while (this.stockTimer >= REPLENISH_INTERVAL && this.stock < STOCK_MAX) {
      this.stock += 1;
      this.stockTimer -= REPLENISH_INTERVAL;
    }

    const difficulty = Math.min(1, this.elapsedSeconds / ROUND_SECONDS);
    const period = PERIOD_START - (PERIOD_START - PERIOD_MIN) * difficulty;
    const phase = (this.elapsedSeconds % period) / period;
    const triangle = phase < 0.5 ? phase * 2 : 2 - phase * 2;
    this.pusherY = this.pusherMinY + triangle * (this.pusherMaxY - this.pusherMinY);

    const tideAdvance = this.height * TIDE_RATE_RATIO * deltaSeconds;
    for (const coin of this.coins) {
      coin.y += tideAdvance;
    }

    this.resolveCollisions();
    this.collectFallenCoins();
  }

  private resolveCollisions(): void {
    for (let iteration = 0; iteration < RELAXATION_ITERATIONS; iteration++) {
      for (const coin of this.coins) {
        coin.x = this.clampX(coin.x);
        coin.y = Math.max(coin.y, this.pusherY + coin.radius);
      }
      for (let i = 0; i < this.coins.length; i++) {
        for (let j = i + 1; j < this.coins.length; j++) {
          this.separate(this.coins[i], this.coins[j]);
        }
      }
    }
  }

  private separate(a: Coin, b: Coin): void {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    const minDist = a.radius + b.radius;
    if (dist <= 0) {
      // 完全に同じ座標に重なるのは稀だが、固着を防ぐためわずかに分裂させる。
      a.x -= 0.5;
      b.x += 0.5;
      return;
    }
    if (dist >= minDist) return;
    const overlap = (minDist - dist) / 2;
    const nx = dx / dist;
    const ny = dy / dist;
    a.x -= nx * overlap;
    a.y -= ny * overlap;
    b.x += nx * overlap;
    b.y += ny * overlap;
  }

  private collectFallenCoins(): void {
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const coin = this.coins[i];
      if (coin.y - coin.radius <= this.height) continue;
      this.coins.splice(i, 1);
      const points = coin.kind === "bonus" ? BONUS_POINTS : STANDARD_POINTS;
      this.score += points;
      this.onCoinScored?.({ coin, points });
    }
  }

  private updatePusherRange(): void {
    this.pusherMinY = this.height * PUSHER_MIN_Y_RATIO;
    this.pusherMaxY = this.height * PUSHER_MAX_Y_RATIO;
  }

  private clampX(x: number): number {
    const margin = COIN_RADIUS;
    if (this.width <= margin * 2) return this.width / 2;
    return Math.min(Math.max(x, margin), this.width - margin);
  }
}
