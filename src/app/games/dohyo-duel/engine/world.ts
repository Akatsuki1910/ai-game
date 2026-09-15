export interface PlayerShoveEvent {
  power: number;
  isPoke: boolean;
  isCounterBonus: boolean;
}

export interface OpponentShoveEvent {
  power: number;
  caughtPlayerCharging: boolean;
}

export interface BoutEndEvent {
  round: number;
  didPlayerWin: boolean;
  winStreak: number;
  livesRemaining: number;
}

// ステージの短辺に対する「押し切られる」までの距離の割合。
// 本物の大相撲も決着は数秒〜十数秒と短いことが多いため、土俵は小さめにして
// 駆け引きのテンポを速くしている。
const RING_RADIUS_RATIO = 0.15;
const MIN_RING_RADIUS_PX = 46;

const MAX_CHARGE_SECONDS = 0.9; // ためを最大までためるのに必要な時間
const MIN_CHARGE_FOR_SHOVE_SECONDS = 0.15; // これ未満での離しは押し込みではなく軽い突きになる
const POKE_PUSH_PX = 8;
const MIN_SHOVE_PUSH_PX = 18;
const MAX_SHOVE_PUSH_PX = 48;
const COUNTER_BONUS_MULTIPLIER = 1.5; // 相手の突き直後に押し返すと効果が乗る
const COUNTER_WINDOW_SECONDS = 0.45;

const BASE_OPPONENT_PUSH_PX = 22;
const OPPONENT_PUSH_GROWTH_PX = 2; // ラウンドが進むごとの相手の一押しの強さの伸び
const MAX_OPPONENT_PUSH_PX = 40;
const BASE_OPPONENT_INTERVAL_SECONDS = 1.6;
const MIN_OPPONENT_INTERVAL_SECONDS = 0.5;
const OPPONENT_INTERVAL_SHRINK_SECONDS = 0.08; // ラウンドが進むごとに相手の攻撃間隔が縮む量
const OPPONENT_INTERVAL_JITTER_RATIO = 0.2;
const CAUGHT_CHARGING_MULTIPLIER = 1.5; // ため中に受けると効果が増す(構えが崩れているため)

const START_LIVES = 3;
const BASE_WIN_SCORE = 100;
const STREAK_BONUS_SCORE = 25;

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * 土俵の中心からの水平方向の「せめぎ合い位置」を1次元でモデル化する。
 * displacement が -ringRadius に達すると相手を押し出して勝ち、
 * +ringRadius に達すると自分が押し出されて負け。
 */
export class DohyoDuelWorld {
  width = 0;
  height = 0;
  ringRadius = MIN_RING_RADIUS_PX;

  displacement = 0;
  isCharging = false;
  chargeSeconds = 0;
  opponentTimer = 0;
  counterWindowSeconds = 0;

  round = 1;
  winStreak = 0;
  score = 0;
  lives = START_LIVES;
  isOver = false;

  onPlayerShove: ((event: PlayerShoveEvent) => void) | null = null;
  onOpponentShove: ((event: OpponentShoveEvent) => void) | null = null;
  onBoutEnd: ((event: BoutEndEvent) => void) | null = null;

  private opponentIntervalTotal = 1;

  constructor(width: number, height: number) {
    this.resize(width, height);
    this.reset();
  }

  reset(): void {
    this.round = 1;
    this.winStreak = 0;
    this.score = 0;
    this.lives = START_LIVES;
    this.isOver = false;
    this.startNextBout();
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const nextRingRadius = Math.max(
      MIN_RING_RADIUS_PX,
      Math.min(width, height) * RING_RADIUS_RATIO,
    );
    if (this.width > 0 && this.height > 0 && this.ringRadius > 0) {
      this.displacement *= nextRingRadius / this.ringRadius;
    }
    this.width = width;
    this.height = height;
    this.ringRadius = nextRingRadius;
  }

  /** 0(まだ静か)〜1(今にも突いてくる)の相手の気合いの溜まり具合。HUD表示用。 */
  get opponentTensionRatio(): number {
    if (this.opponentIntervalTotal <= 0) return 1;
    return clamp(1 - this.opponentTimer / this.opponentIntervalTotal, 0, 1);
  }

  /** 0〜1の自分のため割合。HUD表示用。 */
  get chargeRatio(): number {
    return clamp(this.chargeSeconds / MAX_CHARGE_SECONDS, 0, 1);
  }

  startCharging(): void {
    if (this.isOver || this.isCharging) return;
    this.isCharging = true;
    this.chargeSeconds = 0;
  }

  releaseCharge(): void {
    if (this.isOver || !this.isCharging) {
      this.isCharging = false;
      return;
    }
    this.isCharging = false;

    const isPoke = this.chargeSeconds < MIN_CHARGE_FOR_SHOVE_SECONDS;
    let power = isPoke
      ? POKE_PUSH_PX
      : lerp(MIN_SHOVE_PUSH_PX, MAX_SHOVE_PUSH_PX, this.chargeRatio);

    const isCounterBonus = !isPoke && this.counterWindowSeconds > 0;
    if (isCounterBonus) power *= COUNTER_BONUS_MULTIPLIER;

    this.displacement -= power;
    this.onPlayerShove?.({ power, isPoke, isCounterBonus });
    this.checkBoutEnd();
  }

  step(deltaSeconds: number): void {
    if (this.isOver || deltaSeconds <= 0) return;

    if (this.counterWindowSeconds > 0) {
      this.counterWindowSeconds = Math.max(0, this.counterWindowSeconds - deltaSeconds);
    }
    if (this.isCharging) {
      this.chargeSeconds = Math.min(MAX_CHARGE_SECONDS, this.chargeSeconds + deltaSeconds);
    }

    this.opponentTimer -= deltaSeconds;
    if (this.opponentTimer <= 0) {
      this.executeOpponentShove();
    }
  }

  private executeOpponentShove(): void {
    const caughtPlayerCharging = this.isCharging;
    const basePower = Math.min(
      MAX_OPPONENT_PUSH_PX,
      BASE_OPPONENT_PUSH_PX + (this.round - 1) * OPPONENT_PUSH_GROWTH_PX,
    );
    const power = caughtPlayerCharging ? basePower * CAUGHT_CHARGING_MULTIPLIER : basePower;

    this.displacement += power;
    this.counterWindowSeconds = COUNTER_WINDOW_SECONDS;
    this.onOpponentShove?.({ power, caughtPlayerCharging });
    this.opponentTimer = this.nextOpponentInterval();
    this.checkBoutEnd();
  }

  private nextOpponentInterval(): number {
    const base = Math.max(
      MIN_OPPONENT_INTERVAL_SECONDS,
      BASE_OPPONENT_INTERVAL_SECONDS - (this.round - 1) * OPPONENT_INTERVAL_SHRINK_SECONDS,
    );
    this.opponentIntervalTotal = randRange(
      base * (1 - OPPONENT_INTERVAL_JITTER_RATIO),
      base * (1 + OPPONENT_INTERVAL_JITTER_RATIO),
    );
    return this.opponentIntervalTotal;
  }

  private startNextBout(): void {
    this.displacement = 0;
    this.isCharging = false;
    this.chargeSeconds = 0;
    this.counterWindowSeconds = 0;
    this.opponentTimer = this.nextOpponentInterval();
  }

  private checkBoutEnd(): void {
    if (this.isOver) return;
    if (this.displacement <= -this.ringRadius) {
      this.finishBout(true);
    } else if (this.displacement >= this.ringRadius) {
      this.finishBout(false);
    }
  }

  private finishBout(didPlayerWin: boolean): void {
    const finishedRound = this.round;
    if (didPlayerWin) {
      this.winStreak += 1;
      this.score += BASE_WIN_SCORE + (this.winStreak - 1) * STREAK_BONUS_SCORE;
      this.round += 1;
    } else {
      this.winStreak = 0;
      this.lives -= 1;
    }

    if (this.lives <= 0) {
      this.lives = 0;
      this.isOver = true;
      this.onBoutEnd?.({
        round: finishedRound,
        didPlayerWin,
        winStreak: this.winStreak,
        livesRemaining: this.lives,
      });
      return;
    }

    this.startNextBout();
    this.onBoutEnd?.({
      round: finishedRound,
      didPlayerWin,
      winStreak: this.winStreak,
      livesRemaining: this.lives,
    });
  }
}

export const DOHYO_DUEL_START_LIVES = START_LIVES;
