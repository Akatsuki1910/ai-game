export interface Spindle {
  readonly id: number;
  hasPlate: boolean;
  /** 0(安定)〜1(落下)。1に達すると皿が落ちる。 */
  wobble: number;
  /** 視覚的な回転角(ラジアン)。[0, 2π)。安定しているほど速く回る演出用。 */
  spinAngle: number;
}

export interface PlateSpawnedEvent {
  spindleIndex: number;
}

export interface PlateFellEvent {
  spindleIndex: number;
  livesRemaining: number;
}

export interface PlateSpunEvent {
  spindleIndex: number;
  points: number;
  combo: number;
  /** スピンをかけ直した瞬間のぐらつき(0〜1)。大きいほど際どいタイミング。 */
  savedWobble: number;
}

const TAU = Math.PI * 2;

export const START_LIVES = 3;
export const SPINDLE_COUNT = 5;
/** UI側で「危険」表示に切り替える目安のぐらつき値。 */
export const DANGER_WOBBLE = 0.75;

const BASE_WOBBLE_GROWTH_PER_SECOND = 0.15;
const WOBBLE_GROWTH_RAMP_PER_SECOND = 0.003;
const MAX_WOBBLE_GROWTH_PER_SECOND = 0.45;

const BASE_SPAWN_INTERVAL_SECONDS = 2.2;
const SPAWN_INTERVAL_RAMP_PER_SECOND = 0.02;
const MIN_SPAWN_INTERVAL_SECONDS = 0.7;

const MAX_SPIN_ANGLE_SPEED = 6;
const MIN_SPIN_ANGLE_SPEED = 0.5;

const BASE_POINTS = 10;
const PRECISION_POINTS_MULTIPLIER = 2;
const COMBO_BONUS_PER_STREAK = 2;
const MAX_COMBO_BONUS = 30;

function normalizeAngle(angle: number): number {
  return ((angle % TAU) + TAU) % TAU;
}

function randomEmptyIndex(spindles: readonly Spindle[]): number | undefined {
  const emptyIndices = spindles.reduce<number[]>((acc, spindle, index) => {
    if (!spindle.hasPlate) acc.push(index);
    return acc;
  }, []);
  if (emptyIndices.length === 0) return undefined;
  return emptyIndices[Math.floor(Math.random() * emptyIndices.length)];
}

/**
 * 柱の上で回る皿を、落ちる前にタップしてスピンをかけ直し続ける
 * リアルタイム皿回しの純粋ロジック層。React / pixi.js には一切依存しない。
 */
export class SpindleCircusWorld {
  elapsedSeconds = 0;
  lives = START_LIVES;
  score = 0;
  combo = 0;
  isOver = false;
  spindles: Spindle[] = [];

  onPlateSpawned: ((event: PlateSpawnedEvent) => void) | null = null;
  onPlateFell: ((event: PlateFellEvent) => void) | null = null;
  onPlateSpun: ((event: PlateSpunEvent) => void) | null = null;

  private timeSinceLastSpawn = 0;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.elapsedSeconds = 0;
    this.lives = START_LIVES;
    this.score = 0;
    this.combo = 0;
    this.isOver = false;
    this.timeSinceLastSpawn = 0;
    this.spindles = Array.from({ length: SPINDLE_COUNT }, (_, id) => ({
      id,
      hasPlate: false,
      wobble: 0,
      spinAngle: 0,
    }));
    this.spawnPlate(0);
  }

  private wobbleGrowthPerSecond(): number {
    return Math.min(
      MAX_WOBBLE_GROWTH_PER_SECOND,
      BASE_WOBBLE_GROWTH_PER_SECOND + this.elapsedSeconds * WOBBLE_GROWTH_RAMP_PER_SECOND,
    );
  }

  private spawnIntervalSeconds(): number {
    return Math.max(
      MIN_SPAWN_INTERVAL_SECONDS,
      BASE_SPAWN_INTERVAL_SECONDS - this.elapsedSeconds * SPAWN_INTERVAL_RAMP_PER_SECOND,
    );
  }

  private spawnPlate(forcedIndex?: number): void {
    const targetIndex = forcedIndex ?? randomEmptyIndex(this.spindles);
    if (targetIndex === undefined) return;
    const spindle = this.spindles[targetIndex];
    if (!spindle || spindle.hasPlate) return;
    spindle.hasPlate = true;
    spindle.wobble = 0;
    spindle.spinAngle = 0;
    this.onPlateSpawned?.({ spindleIndex: targetIndex });
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;
    this.elapsedSeconds += deltaSeconds;

    this.timeSinceLastSpawn += deltaSeconds;
    if (this.timeSinceLastSpawn >= this.spawnIntervalSeconds()) {
      this.timeSinceLastSpawn = 0;
      this.spawnPlate();
    }

    const wobbleGrowth = this.wobbleGrowthPerSecond();
    for (let i = 0; i < this.spindles.length; i++) {
      const spindle = this.spindles[i];
      if (!spindle.hasPlate) continue;

      const spinSpeed =
        MAX_SPIN_ANGLE_SPEED - (MAX_SPIN_ANGLE_SPEED - MIN_SPIN_ANGLE_SPEED) * spindle.wobble;
      spindle.spinAngle = normalizeAngle(spindle.spinAngle + spinSpeed * deltaSeconds);
      spindle.wobble = Math.min(1, spindle.wobble + wobbleGrowth * deltaSeconds);

      if (spindle.wobble >= 1) {
        spindle.hasPlate = false;
        spindle.wobble = 0;
        this.combo = 0;
        this.lives = Math.max(0, this.lives - 1);
        this.onPlateFell?.({ spindleIndex: i, livesRemaining: this.lives });
        if (this.lives <= 0) {
          this.isOver = true;
          return;
        }
      }
    }
  }

  /** 指定した柱をタップ/クリックしたときに呼ぶ。皿が乗っていなければ何も起きない。 */
  spinSpindle(index: number): void {
    if (this.isOver) return;
    const spindle = this.spindles[index];
    if (!spindle?.hasPlate) return;

    const savedWobble = spindle.wobble;
    spindle.wobble = 0;
    this.combo += 1;
    const comboBonus = Math.min(MAX_COMBO_BONUS, this.combo * COMBO_BONUS_PER_STREAK);
    const points = Math.round(
      BASE_POINTS * (1 + savedWobble * PRECISION_POINTS_MULTIPLIER) + comboBonus,
    );
    this.score += points;
    this.onPlateSpun?.({ spindleIndex: index, points, combo: this.combo, savedWobble });
  }
}
