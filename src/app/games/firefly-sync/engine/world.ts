const TWO_PI = Math.PI * 2;

const ARENA_MARGIN = 0.94;

const BASE_FIREFLY_COUNT = 20;
const FIREFLIES_ADDED_PER_NIGHT = 5;
const MAX_FIREFLIES = 46;

const BASE_FREQUENCY = 0.55;
const BASE_FREQUENCY_SPREAD = 0.14;
const FREQUENCY_SPREAD_STEP = 0.03;
const MAX_FREQUENCY_SPREAD = 0.36;

const BASE_COUPLING = 0.4;
const COUPLING_STEP = 0.035;
const MAX_COUPLING = 0.65;

const BASE_TIME_LIMIT_SECONDS = 40;
const TIME_LIMIT_STEP_SECONDS = 2;
const MIN_TIME_LIMIT_SECONDS = 24;

/** 秩序変数(r)がこの値より上なら合唱計が満ち、下なら緩やかに減る。 */
const CHORUS_ZONE = 0.5;
/** 合唱計の増減速度(秩序変数がZONEからどれだけ離れているかに比例)。 */
const CHORUS_RATE = 1.0;

const ENERGY_REGEN_PER_SECOND = 0.5;
export const TAP_ENERGY_COST = 0.34;
const TAP_RADIUS_FRAC = 0.8;
const TAP_PULL_STRENGTH = 0.75;

const WANDER_AMPLITUDE_FRAC = 0.02;
const WANDER_SPEED = 0.15;

const NIGHT_CLEAR_BASE_SCORE = 500;
const NIGHT_CLEAR_TIME_BONUS_PER_SECOND = 10;
const NIGHT_CLEAR_NIGHT_BONUS = 50;

export interface FireflySnapshot {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  /** 0〜1(周回)。0に近いほど明滅のピーク。 */
  readonly phase: number;
}

export interface NightClearedEvent {
  night: number;
  scoreGained: number;
}

export type NightOutcome = "duskFaded" | null;

interface InternalFirefly {
  id: number;
  baseX: number;
  baseY: number;
  driftSeed: number;
  phase: number;
  frequency: number;
}

function wrap01(value: number): number {
  const wrapped = value % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** phase を target(どちらも0〜1周回) へ最短弧で amount(0〜1) だけ引き寄せる。 */
function pullPhaseToward(phase: number, target: number, amount: number): number {
  let diff = target - phase;
  diff -= Math.round(diff);
  return wrap01(phase + diff * amount);
}

function wanderedX(firefly: InternalFirefly, elapsed: number, arenaSize: number): number {
  return (
    firefly.baseX +
    arenaSize *
      WANDER_AMPLITUDE_FRAC *
      Math.sin(elapsed * WANDER_SPEED * TWO_PI + firefly.driftSeed)
  );
}

function wanderedY(firefly: InternalFirefly, elapsed: number, arenaSize: number): number {
  return (
    firefly.baseY +
    arenaSize *
      WANDER_AMPLITUDE_FRAC *
      Math.cos(elapsed * WANDER_SPEED * TWO_PI + firefly.driftSeed)
  );
}

export interface FireflyWorldOptions {
  /** テスト用に乱数を差し替えるためのフック。省略時は Math.random。 */
  random?: () => number;
}

/**
 * 草原に散らばるホタルの群れ。各個体は Kuramoto モデルに基づく独立した明滅位相を持ち、
 * 全体平均(秩序変数 r)へ弱く引き寄せられる。プレイヤーはタップで局所的にパルスを送り、
 * 群れの現在の合意位相(psi)へ狙った個体を強く引き寄せることで、r を合唱の閾値まで
 * 押し上げる。r が高い状態を維持し続けると合唱計が満ちてその夜をクリアする。
 */
export class FireflyWorld {
  width = 0;
  height = 0;
  arenaSize = 0;
  offsetX = 0;
  offsetY = 0;

  night = 1;
  timeLimit = 0;
  timeRemaining = 0;
  energy = 1;
  chorusMeter = 0;
  orderParameter = 0;
  score = 0;
  isOver = false;
  outcome: NightOutcome = null;

  onNightCleared: ((event: NightClearedEvent) => void) | null = null;

  private readonly random: () => number;
  private _fireflies: InternalFirefly[] = [];
  private coupling = BASE_COUPLING;
  private elapsed = 0;
  private consensusPhase = 0;

  constructor(width: number, height: number, options: FireflyWorldOptions = {}) {
    this.random = options.random ?? Math.random;
    this.resize(width, height);
    this.reset();
  }

  get fireflies(): readonly FireflySnapshot[] {
    return this._fireflies.map((firefly) => ({
      id: firefly.id,
      x: wanderedX(firefly, this.elapsed, this.arenaSize),
      y: wanderedY(firefly, this.elapsed, this.arenaSize),
      phase: firefly.phase,
    }));
  }

  reset(): void {
    this.night = 1;
    this.score = 0;
    this.isOver = false;
    this.outcome = null;
    this.startNight();
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const newArenaSize = Math.min(width, height) * ARENA_MARGIN;
    const scale = this.arenaSize > 0 ? newArenaSize / this.arenaSize : 1;

    this.width = width;
    this.height = height;
    this.offsetX = (width - newArenaSize) / 2;
    this.offsetY = (height - newArenaSize) / 2;
    this.arenaSize = newArenaSize;

    if (scale !== 1) {
      for (const firefly of this._fireflies) {
        firefly.baseX *= scale;
        firefly.baseY *= scale;
      }
    }
  }

  private startNight(): void {
    const count = Math.min(
      MAX_FIREFLIES,
      BASE_FIREFLY_COUNT + (this.night - 1) * FIREFLIES_ADDED_PER_NIGHT,
    );
    const spread = Math.min(
      MAX_FREQUENCY_SPREAD,
      BASE_FREQUENCY_SPREAD + (this.night - 1) * FREQUENCY_SPREAD_STEP,
    );
    this.coupling = Math.min(MAX_COUPLING, BASE_COUPLING + (this.night - 1) * COUPLING_STEP);
    this.timeLimit = Math.max(
      MIN_TIME_LIMIT_SECONDS,
      BASE_TIME_LIMIT_SECONDS - (this.night - 1) * TIME_LIMIT_STEP_SECONDS,
    );
    this.timeRemaining = this.timeLimit;
    this.energy = 1;
    this.chorusMeter = 0;
    this.orderParameter = 0;
    this.consensusPhase = 0;
    this.elapsed = 0;

    this._fireflies = Array.from({ length: count }, (_, id) => ({
      id,
      baseX: this.random() * this.arenaSize,
      baseY: this.random() * this.arenaSize,
      driftSeed: this.random() * TWO_PI,
      phase: this.random(),
      frequency: BASE_FREQUENCY + (this.random() * 2 - 1) * spread,
    }));
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    this.elapsed += deltaSeconds;
    this.timeRemaining = Math.max(0, this.timeRemaining - deltaSeconds);
    this.energy = Math.min(1, this.energy + ENERGY_REGEN_PER_SECOND * deltaSeconds);

    const count = this._fireflies.length;
    let sumSin = 0;
    let sumCos = 0;
    for (const firefly of this._fireflies) {
      const angle = firefly.phase * TWO_PI;
      sumSin += Math.sin(angle);
      sumCos += Math.cos(angle);
    }
    const meanSin = sumSin / count;
    const meanCos = sumCos / count;
    const orderParameter = Math.hypot(meanSin, meanCos);
    const consensusAngle = Math.atan2(meanSin, meanCos);
    this.orderParameter = orderParameter;
    this.consensusPhase = wrap01(consensusAngle / TWO_PI);

    for (const firefly of this._fireflies) {
      const angle = firefly.phase * TWO_PI;
      const dPhase =
        firefly.frequency +
        (this.coupling * orderParameter * Math.sin(consensusAngle - angle)) / TWO_PI;
      firefly.phase = wrap01(firefly.phase + dPhase * deltaSeconds);
    }

    this.chorusMeter = clamp01(
      this.chorusMeter + CHORUS_RATE * (orderParameter - CHORUS_ZONE) * deltaSeconds,
    );

    if (this.chorusMeter >= 1) {
      this.completeNight();
      return;
    }
    if (this.timeRemaining <= 0) {
      this.isOver = true;
      this.outcome = "duskFaded";
    }
  }

  private completeNight(): void {
    const scoreGained = Math.round(
      NIGHT_CLEAR_BASE_SCORE +
        this.timeRemaining * NIGHT_CLEAR_TIME_BONUS_PER_SECOND +
        this.night * NIGHT_CLEAR_NIGHT_BONUS,
    );
    this.score += scoreGained;
    this.onNightCleared?.({ night: this.night, scoreGained });
    this.night += 1;
    this.startNight();
  }

  /**
   * ステージ(canvas)座標へ光のパルスを送る。エネルギーが足りなければ何もせず false を返す。
   * 到達範囲内のホタルの位相を、群れの現在の合意位相へ引き寄せる。
   */
  applyPulseAtStagePoint(stageX: number, stageY: number): boolean {
    if (this.isOver) return false;
    if (this.energy < TAP_ENERGY_COST) return false;
    if (this._fireflies.length === 0) return false;

    this.energy -= TAP_ENERGY_COST;
    const localX = stageX - this.offsetX;
    const localY = stageY - this.offsetY;
    const radius = this.arenaSize * TAP_RADIUS_FRAC;
    if (radius <= 0) return true;

    for (const firefly of this._fireflies) {
      const fx = wanderedX(firefly, this.elapsed, this.arenaSize);
      const fy = wanderedY(firefly, this.elapsed, this.arenaSize);
      const dist = Math.hypot(fx - localX, fy - localY);
      const falloff = Math.max(0, 1 - dist / radius);
      if (falloff <= 0) continue;
      firefly.phase = pullPhaseToward(
        firefly.phase,
        this.consensusPhase,
        TAP_PULL_STRENGTH * falloff,
      );
    }
    return true;
  }
}
