export interface FishCaughtEvent {
  round: number;
  points: number;
}

/**
 * 「待つ(リールを巻く)」のON/OFFだけで駆け引きが生まれるよう、当たり判定は
 * 魚との距離(distance)とラインの張り(tension)の2変量だけでモデル化する。
 * - リールを巻く(isReeling)と distance は減るが tension は目標値へ寄っていく。
 * - 魚が走る(isRunning)間は tension の目標値が跳ね上がるため、巻き続けるとラインが切れる。
 *   走っている間だけ手を止めて巻かない(＝張りを逃がす)のが本物の釣りのやり取りに近い。
 */
const START_LIVES = 3;
const DISTANCE_START = 1;
const DISTANCE_MAX = 1.3;
const TENSION_SNAP = 1;
const TENSION_SMOOTH_PER_SECOND = 4;
const REEL_TENSION_TARGET = 0.5;
const REEL_IN_RATE = 0.18;
const IDLE_DRIFT_RATE = 0.05;

// ラウンド2以降から魚が「走る」ようになる。1匹目はチュートリアル的に走らない。
const FIRST_RUN_ROUND = 2;
const RUN_INTERVAL_MIN_BASE = 1.4;
const RUN_INTERVAL_MAX_BASE = 2.2;
const RUN_INTERVAL_SHRINK_PER_ROUND = 0.06;
const RUN_INTERVAL_MIN_FLOOR = 0.7;
const RUN_INTERVAL_MAX_FLOOR = 1.1;
const RUN_DURATION_BASE = 0.9;
const RUN_DURATION_GROWTH_PER_ROUND = 0.05;
const RUN_DURATION_CAP = 1.6;
const RUN_TENSION_BONUS_BASE = 0.65;
const RUN_TENSION_BONUS_GROWTH_PER_ROUND = 0.04;
const RUN_TENSION_BONUS_CAP = 0.85;
const RUN_PULL_RATE_BASE = 0.12;
const RUN_PULL_RATE_GROWTH_PER_ROUND = 0.015;
const RUN_PULL_RATE_CAP = 0.3;

const BASE_CATCH_SCORE = 100;
const CATCH_SCORE_GROWTH_PER_ROUND = 25;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function roundsSinceFirstRun(round: number): number {
  return Math.max(0, round - FIRST_RUN_ROUND);
}

function runIntervalMin(round: number): number {
  return Math.max(
    RUN_INTERVAL_MIN_FLOOR,
    RUN_INTERVAL_MIN_BASE - roundsSinceFirstRun(round) * RUN_INTERVAL_SHRINK_PER_ROUND,
  );
}

function runIntervalMax(round: number): number {
  return Math.max(
    RUN_INTERVAL_MAX_FLOOR,
    RUN_INTERVAL_MAX_BASE - roundsSinceFirstRun(round) * RUN_INTERVAL_SHRINK_PER_ROUND,
  );
}

function runDuration(round: number): number {
  return Math.min(
    RUN_DURATION_CAP,
    RUN_DURATION_BASE + roundsSinceFirstRun(round) * RUN_DURATION_GROWTH_PER_ROUND,
  );
}

function runTensionBonus(round: number): number {
  return Math.min(
    RUN_TENSION_BONUS_CAP,
    RUN_TENSION_BONUS_BASE + roundsSinceFirstRun(round) * RUN_TENSION_BONUS_GROWTH_PER_ROUND,
  );
}

function runPullRate(round: number): number {
  return Math.min(
    RUN_PULL_RATE_CAP,
    RUN_PULL_RATE_BASE + roundsSinceFirstRun(round) * RUN_PULL_RATE_GROWTH_PER_ROUND,
  );
}

export class TautLineWorld {
  width = 0;
  height = 0;

  round = 1;
  lives = START_LIVES;
  score = 0;
  isOver = false;

  distance = DISTANCE_START;
  tension = 0;
  isReeling = false;
  isRunning = false;

  onCatch: ((event: FishCaughtEvent) => void) | null = null;
  onSnap: (() => void) | null = null;
  onEscape: (() => void) | null = null;

  private runTimer = Number.POSITIVE_INFINITY;
  private runElapsed = 0;

  constructor(width: number, height: number) {
    this.resize(width, height);
    this.reset();
  }

  reset(): void {
    this.round = 1;
    this.lives = START_LIVES;
    this.score = 0;
    this.isOver = false;
    this.setupFish(false);
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.width = width;
    this.height = height;
  }

  /** 0(釣り上げ寸前)〜1(逃げられる寸前)。HUD・魚の描画位置に使う。 */
  get distanceRatio(): number {
    return clamp(this.distance / DISTANCE_MAX, 0, 1);
  }

  /** 0(緩い)〜1(切れる寸前)。HUDのテンションゲージに使う。 */
  get tensionRatio(): number {
    return clamp(this.tension / TENSION_SNAP, 0, 1);
  }

  /**
   * 0(巻き始め)〜1(釣り上げ寸前)。HUDの「巻き具合」ゲージに使う。
   * distance は油断すると DISTANCE_START より伸びる(逃げられかけている状態)ため、
   * distanceRatio(逃走までの余裕)とは別に「巻き始めからどれだけ寄せたか」を示す値を分けて持つ。
   */
  get progressRatio(): number {
    return clamp(1 - this.distance / DISTANCE_START, 0, 1);
  }

  get isRunEnabledThisRound(): boolean {
    return this.round >= FIRST_RUN_ROUND;
  }

  startReeling(): void {
    if (this.isOver) return;
    this.isReeling = true;
  }

  stopReeling(): void {
    this.isReeling = false;
  }

  step(deltaSeconds: number): void {
    if (this.isOver || deltaSeconds <= 0) return;

    this.updateRunState(deltaSeconds);

    const targetTension =
      (this.isReeling ? REEL_TENSION_TARGET : 0) +
      (this.isRunning ? runTensionBonus(this.round) : 0);
    const smoothing = Math.min(1, TENSION_SMOOTH_PER_SECOND * deltaSeconds);
    this.tension = Math.max(0, this.tension + (targetTension - this.tension) * smoothing);

    if (this.tension >= TENSION_SNAP) {
      this.onSnap?.();
      this.loseLife();
      return;
    }

    let distanceRate = 0;
    if (this.isReeling) distanceRate -= REEL_IN_RATE;
    if (this.isRunning) distanceRate += runPullRate(this.round);
    if (!this.isReeling && !this.isRunning) distanceRate += IDLE_DRIFT_RATE;

    this.distance = clamp(this.distance + distanceRate * deltaSeconds, 0, DISTANCE_MAX);

    if (this.distance <= 0) {
      this.handleCatch();
      return;
    }
    if (this.distance >= DISTANCE_MAX) {
      this.onEscape?.();
      this.loseLife();
    }
  }

  private updateRunState(deltaSeconds: number): void {
    if (!this.isRunEnabledThisRound) return;

    if (this.isRunning) {
      this.runElapsed += deltaSeconds;
      if (this.runElapsed >= runDuration(this.round)) {
        this.isRunning = false;
        this.runTimer = randRange(runIntervalMin(this.round), runIntervalMax(this.round));
      }
      return;
    }

    this.runTimer -= deltaSeconds;
    if (this.runTimer <= 0) {
      this.isRunning = true;
      this.runElapsed = 0;
    }
  }

  private handleCatch(): void {
    const points = BASE_CATCH_SCORE + (this.round - 1) * CATCH_SCORE_GROWTH_PER_ROUND;
    this.score += points;
    this.onCatch?.({ round: this.round, points });
    this.round += 1;
    this.setupFish();
  }

  private loseLife(): void {
    this.lives -= 1;
    if (this.lives <= 0) {
      this.lives = 0;
      this.isOver = true;
      return;
    }
    this.setupFish();
  }

  /**
   * 次の魚の状態を初期化する。 isReeling は「今まさに押しっぱなしかどうか」という
   * 入力側の状態であって魚側の状態ではないため、既定では引き継ぐ
   * (押しっぱなしのまま釣れても、次の魚からリールが止まって見えるのを防ぐ)。
   * reset() からの呼び出しだけは明示的に false を渡し、入力状態もまっさらにする。
   */
  private setupFish(preserveReeling = true): void {
    this.distance = DISTANCE_START;
    this.tension = 0;
    this.isReeling = preserveReeling ? this.isReeling : false;
    this.isRunning = false;
    this.runElapsed = 0;
    this.runTimer = this.isRunEnabledThisRound
      ? randRange(runIntervalMin(this.round), runIntervalMax(this.round))
      : Number.POSITIVE_INFINITY;
  }
}

export const TAUT_LINE_START_LIVES = START_LIVES;
