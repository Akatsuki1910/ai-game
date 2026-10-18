export const FISH_SPECIES = ["minnow", "bass", "marlin"] as const;
export type FishSpecies = (typeof FISH_SPECIES)[number];

export const LINES_MAX = 3;
/** 0: 船(キャッチ成功) 〜 1: ラインの限界距離(逃げられる)。 */
export const MAX_DISTANCE = 1;
export const INITIAL_DISTANCE = 0.55;

export type LossReason = "escaped" | "snapped";

export interface CatchEvent {
  species: FishSpecies;
  points: number;
  catchCount: number;
}

export interface LossEvent {
  species: FishSpecies;
  reason: LossReason;
  linesRemaining: number;
}

const TENSION_MAX = 1;
const TENSION_DECAY_PER_SECOND = 0.22;

const REEL_DISTANCE_PER_POWER = 0.16;
const REEL_TENSION_PER_POWER = 0.16;
const RUN_TENSION_MULTIPLIER = 2.1;

const CALM_DURATION_SECONDS = 2.2;
const RUN_DURATION_BASE_SECONDS = 1.3;
const RUN_DURATION_MIN_SECONDS = 0.7;
const RUN_DURATION_SHRINK_PER_CATCH = 0.03;

const CALM_DRIFT_SPEED = 0.02;
const RUN_PULL_BASE_SPEED = 0.42;
const RUN_PULL_GROWTH_PER_CATCH = 0.02;
const RUN_PULL_MAX_SPEED = 0.85;

const SCORE_PER_CATCH = 100;
const COMBO_BONUS_PER_STREAK = 20;

export const SPECIES_SCORE_MULTIPLIER: Readonly<Record<FishSpecies, number>> = {
  minnow: 1,
  bass: 1.5,
  marlin: 2.5,
};

/** 釣果が増えるほど強い魚(bass/marlin)が出やすくなる重み付き抽選。 */
function pickSpecies(catchCount: number): FishSpecies {
  const marlinWeight = Math.min(0.45, 0.05 + catchCount * 0.025);
  const bassWeight = Math.min(0.4, 0.2 + catchCount * 0.015);
  const minnowWeight = Math.max(0.15, 1 - marlinWeight - bassWeight);
  const total = marlinWeight + bassWeight + minnowWeight;
  const roll = Math.random() * total;
  if (roll < marlinWeight) return "marlin";
  if (roll < marlinWeight + bassWeight) return "bass";
  return "minnow";
}

/**
 * 魚とのやり取りをテンション(ライン荷重)と距離(逃走度)の2軸で表す
 * リアルタイム釣りの純粋ロジック層。React / pixi.js には依存しない。
 *
 * 魚は一定周期で「calm(穏やか)」と「run(強く引く)」を交互に繰り返す。
 * calm中はゆっくりなら安全に巻き寄せられるが、run中に巻くとテンションが
 * 跳ね上がりラインが切れやすくなる。巻かずに耐えると距離が伸びて逃げられる。
 */
export class TautLinePumpWorld {
  private catchCount = 0;
  private stateTimer = CALM_DURATION_SECONDS;

  distance = INITIAL_DISTANCE;
  tension = 0;
  isRunning = false;
  species: FishSpecies = "minnow";
  score = 0;
  combo = 0;
  lines = LINES_MAX;
  isOver = false;

  onCatch: ((event: CatchEvent) => void) | null = null;
  onLoss: ((event: LossEvent) => void) | null = null;

  constructor() {
    this.reset();
  }

  get runPullSpeed(): number {
    return Math.min(
      RUN_PULL_MAX_SPEED,
      RUN_PULL_BASE_SPEED + this.catchCount * RUN_PULL_GROWTH_PER_CATCH,
    );
  }

  get runDuration(): number {
    return Math.max(
      RUN_DURATION_MIN_SECONDS,
      RUN_DURATION_BASE_SECONDS - this.catchCount * RUN_DURATION_SHRINK_PER_CATCH,
    );
  }

  reset(): void {
    this.catchCount = 0;
    this.score = 0;
    this.combo = 0;
    this.lines = LINES_MAX;
    this.isOver = false;
    this.spawnFish();
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    this.stateTimer -= deltaSeconds;
    if (this.stateTimer <= 0) {
      this.isRunning = !this.isRunning;
      this.stateTimer = this.isRunning ? this.runDuration : CALM_DURATION_SECONDS;
    }

    const pullSpeed = this.isRunning ? this.runPullSpeed : CALM_DRIFT_SPEED;
    this.distance += pullSpeed * deltaSeconds;
    this.tension = Math.max(0, this.tension - TENSION_DECAY_PER_SECOND * deltaSeconds);

    if (this.distance >= MAX_DISTANCE) {
      this.distance = MAX_DISTANCE;
      this.loseLine("escaped");
    }
  }

  /** ポインタの上方向ドラッグ量やキー入力から得たポンプの力(0〜1)でリールを巻く。 */
  reel(power: number): void {
    if (this.isOver || power <= 0) return;
    const clamped = Math.min(1, power);
    const tensionMultiplier = this.isRunning ? RUN_TENSION_MULTIPLIER : 1;

    this.distance = Math.max(0, this.distance - clamped * REEL_DISTANCE_PER_POWER);
    this.tension = Math.min(
      TENSION_MAX,
      this.tension + clamped * REEL_TENSION_PER_POWER * tensionMultiplier,
    );

    if (this.tension >= TENSION_MAX) {
      this.loseLine("snapped");
      return;
    }
    if (this.distance <= 0) {
      this.catchFish();
    }
  }

  private catchFish(): void {
    const points = Math.round(
      (SCORE_PER_CATCH + this.combo * COMBO_BONUS_PER_STREAK) *
        SPECIES_SCORE_MULTIPLIER[this.species],
    );
    this.score += points;
    this.combo += 1;
    this.catchCount += 1;
    this.onCatch?.({ species: this.species, points, catchCount: this.catchCount });
    this.spawnFish();
  }

  private loseLine(reason: LossReason): void {
    this.combo = 0;
    this.lines -= 1;
    this.onLoss?.({ species: this.species, reason, linesRemaining: this.lines });
    if (this.lines <= 0) {
      this.isOver = true;
      return;
    }
    this.spawnFish();
  }

  private spawnFish(): void {
    this.distance = INITIAL_DISTANCE;
    this.tension = 0;
    this.isRunning = false;
    this.stateTimer = CALM_DURATION_SECONDS;
    this.species = pickSpecies(this.catchCount);
  }
}
