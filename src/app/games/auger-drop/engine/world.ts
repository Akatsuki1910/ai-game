export type FishKind = "small" | "big";

export interface Fish {
  x: number;
  y: number;
  vx: number;
  vy: number;
  wanderAngle: number;
  kind: FishKind;
  interest: number;
}

export interface Hole {
  x: number;
  y: number;
}

export interface BiteEvent {
  kind: FishKind;
}

export interface CatchEvent {
  kind: FishKind;
  points: number;
  catches: number;
}

export interface LostEvent {
  kind: FishKind;
}

export interface FrozenEvent {
  score: number;
}

export const LURE_RADIUS = 10;
export const FISH_RADIUS: Record<FishKind, number> = { small: 10, big: 17 };
export const FISH_COUNT = 4;
export const CURIOUS_RADIUS = 140;
export const WARMTH_MAX = 100;
export const TENSION_MAX = 100;
export const REEL_PROGRESS_MAX = 100;
export const BIG_FISH_CHANCE = 0.3;
export const POINTS: Record<FishKind, number> = { small: 80, big: 260 };

const HOLE_Y_RATIO = 0.12;
const WATER_TOP_MARGIN = 44; // px。穴からこの分下まではルアーも魚も進入できない安全マージン
export const EDGE_MARGIN = 24;

const LURE_ACCEL = 1000;
const LURE_DAMPING_PER_SECOND = 2;
const LURE_MAX_SPEED = 260;
const JIG_MIN_SPEED = 55; // px/秒。これを超える速さで動かしていないと「誘い」とみなさない

const WANDER_SPEED = 30;
const WANDER_TURN_RATE = 1.4;

const INTEREST_GAIN_JIGGING = 48; // %/秒
const INTEREST_GAIN_IDLE = 10; // %/秒。誘わず近くにいるだけでもわずかに上がる
const INTEREST_DECAY = 35; // %/秒

const TENSION_START = 22;
const TENSION_RISE_RATE: Record<FishKind, number> = { small: 26, big: 58 };
const TENSION_FALL_RATE = 48; // %/秒。手を止めている間に落ち着く速さ
const REEL_RATE = 42; // %/秒

const WARMTH_DRAIN_PER_SECOND = 1.35;
const WARMTH_GAIN_ON_CATCH: Record<FishKind, number> = { small: 14, big: 26 };
const WARMTH_LOSS_ON_SNAP = 9;

const SPAWN_MAX_ATTEMPTS = 20;
const SPAWN_MIN_DIST_FROM_LURE = 120;

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function randomFishKind(): FishKind {
  return Math.random() < BIG_FISH_CHANCE ? "big" : "small";
}

/**
 * 凍った湖でルアーを操って魚を誘い、掛かったら糸のテンションを保ちながら
 * 釣り上げ続けるリアルタイム釣りシミュレーションの純粋ロジック層。
 * React / pixi.js には依存しない。
 *
 * 魚は氷の穴付近で群れ回遊しており、ルアーを素早く揺すり続ける(ジグ)と
 * 興味ゲージが上がって食いつく。掛かった後は長押し(リール)でテンションを
 * 上げながら引き寄せ、上げすぎる前に手を緩めて逃がしてやる駆け引きになる。
 */
export class AugerDropWorld {
  width = 0;
  height = 0;
  hole: Hole = { x: 0, y: 0 };
  lure = { x: 0, y: 0, vx: 0, vy: 0 };
  fish: Fish[] = [];
  hookedIndex: number | null = null;
  tension = 0;
  reelProgress = 0;
  warmth = WARMTH_MAX;
  score = 0;
  catches = 0;
  isOver = false;

  private isHolding = false;
  private steerTargetX = 0;
  private steerTargetY = 0;
  private hookOriginX = 0;
  private hookOriginY = 0;
  private elapsedSeconds = 0;

  onBite: ((event: BiteEvent) => void) | null = null;
  onCatch: ((event: CatchEvent) => void) | null = null;
  onLost: ((event: LostEvent) => void) | null = null;
  onFrozen: ((event: FrozenEvent) => void) | null = null;

  constructor(width: number, height: number) {
    this.resize(width, height);
    this.reset();
  }

  reset(): void {
    this.hole = { x: this.width / 2, y: this.height * HOLE_Y_RATIO };
    this.lure = { x: this.hole.x, y: this.hole.y + WATER_TOP_MARGIN, vx: 0, vy: 0 };
    this.steerTargetX = this.lure.x;
    this.steerTargetY = this.lure.y;
    this.hookedIndex = null;
    this.tension = 0;
    this.reelProgress = 0;
    this.warmth = WARMTH_MAX;
    this.score = 0;
    this.catches = 0;
    this.isOver = false;
    this.isHolding = false;
    this.elapsedSeconds = 0;
    this.fish = Array.from({ length: FISH_COUNT }, () => this.spawnFish());
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const scaleX = this.width > 0 ? width / this.width : 1;
    const scaleY = this.height > 0 ? height / this.height : 1;
    if (this.width > 0 && this.height > 0) {
      this.hole.x *= scaleX;
      this.hole.y *= scaleY;
      this.lure.x *= scaleX;
      this.lure.y *= scaleY;
      this.steerTargetX *= scaleX;
      this.steerTargetY *= scaleY;
      for (const f of this.fish) {
        f.x *= scaleX;
        f.y *= scaleY;
      }
    }
    this.width = width;
    this.height = height;
  }

  /** ドラッグ/長押し中のポインタ位置、またはキーボード入力から計算した狙点を渡す。 */
  setAimTarget(x: number, y: number): void {
    this.steerTargetX = clamp(x, EDGE_MARGIN, this.width - EDGE_MARGIN);
    this.steerTargetY = clamp(y, this.waterTopY(), this.height - EDGE_MARGIN);
  }

  /** ヒット前はルアーを狙点へ動かす「誘い」、ヒット後は糸を巻く「リール」を意味する。 */
  setHolding(isActive: boolean): void {
    this.isHolding = isActive;
  }

  private waterTopY(): number {
    return this.hole.y + WATER_TOP_MARGIN;
  }

  private randomWaterPosition(): { x: number; y: number } {
    const minY = this.waterTopY();
    const maxY = Math.max(minY, this.height - EDGE_MARGIN);
    return {
      x: randRange(EDGE_MARGIN, Math.max(EDGE_MARGIN, this.width - EDGE_MARGIN)),
      y: randRange(minY, maxY),
    };
  }

  private spawnFish(): Fish {
    let pos = this.randomWaterPosition();
    for (let attempt = 0; attempt < SPAWN_MAX_ATTEMPTS; attempt++) {
      const dist = Math.hypot(pos.x - this.lure.x, pos.y - this.lure.y);
      if (dist >= SPAWN_MIN_DIST_FROM_LURE) break;
      pos = this.randomWaterPosition();
    }
    return {
      x: pos.x,
      y: pos.y,
      vx: 0,
      vy: 0,
      wanderAngle: randRange(0, Math.PI * 2),
      kind: randomFishKind(),
      interest: 0,
    };
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;
    this.elapsedSeconds += deltaSeconds;

    this.stepLure(deltaSeconds);

    if (this.hookedIndex === null) {
      this.stepFreeFish(deltaSeconds);
    } else {
      this.stepReel(deltaSeconds);
    }

    if (this.warmth <= 0) {
      this.warmth = 0;
      this.isOver = true;
      this.onFrozen?.({ score: this.score });
    }
  }

  private stepLure(deltaSeconds: number): void {
    let ax = 0;
    let ay = 0;
    if (this.hookedIndex === null && this.isHolding) {
      const dx = this.steerTargetX - this.lure.x;
      const dy = this.steerTargetY - this.lure.y;
      const dist = Math.max(Math.hypot(dx, dy), 1);
      ax = (dx / dist) * LURE_ACCEL;
      ay = (dy / dist) * LURE_ACCEL;
    }

    const dampingFactor = Math.exp(-LURE_DAMPING_PER_SECOND * deltaSeconds);
    this.lure.vx = (this.lure.vx + ax * deltaSeconds) * dampingFactor;
    this.lure.vy = (this.lure.vy + ay * deltaSeconds) * dampingFactor;
    const speed = Math.hypot(this.lure.vx, this.lure.vy);
    if (speed > LURE_MAX_SPEED) {
      const scale = LURE_MAX_SPEED / speed;
      this.lure.vx *= scale;
      this.lure.vy *= scale;
    }

    if (this.hookedIndex === null) {
      this.lure.x += this.lure.vx * deltaSeconds;
      this.lure.y += this.lure.vy * deltaSeconds;
      this.lure.x = clamp(this.lure.x, EDGE_MARGIN, this.width - EDGE_MARGIN);
      this.lure.y = clamp(this.lure.y, this.waterTopY(), this.height - EDGE_MARGIN);
    }
  }

  private stepFreeFish(deltaSeconds: number): void {
    this.warmth -= WARMTH_DRAIN_PER_SECOND * deltaSeconds;

    const jigSpeed = Math.hypot(this.lure.vx, this.lure.vy);
    const minY = this.waterTopY();

    for (let i = 0; i < this.fish.length; i++) {
      const f = this.fish[i];
      f.wanderAngle += randRange(-1, 1) * WANDER_TURN_RATE * deltaSeconds;
      f.vx = Math.cos(f.wanderAngle) * WANDER_SPEED;
      f.vy = Math.sin(f.wanderAngle) * WANDER_SPEED;
      f.x += f.vx * deltaSeconds;
      f.y += f.vy * deltaSeconds;

      const radius = FISH_RADIUS[f.kind];
      if (f.x < radius + EDGE_MARGIN) {
        f.x = radius + EDGE_MARGIN;
        f.wanderAngle = Math.PI - f.wanderAngle;
      } else if (f.x > this.width - radius - EDGE_MARGIN) {
        f.x = this.width - radius - EDGE_MARGIN;
        f.wanderAngle = Math.PI - f.wanderAngle;
      }
      if (f.y < minY + radius) {
        f.y = minY + radius;
        f.wanderAngle = -f.wanderAngle;
      } else if (f.y > this.height - radius - EDGE_MARGIN) {
        f.y = this.height - radius - EDGE_MARGIN;
        f.wanderAngle = -f.wanderAngle;
      }

      const distToLure = Math.hypot(f.x - this.lure.x, f.y - this.lure.y);
      if (distToLure < CURIOUS_RADIUS) {
        const gain = jigSpeed > JIG_MIN_SPEED ? INTEREST_GAIN_JIGGING : INTEREST_GAIN_IDLE;
        f.interest = Math.min(100, f.interest + gain * deltaSeconds);
      } else {
        f.interest = Math.max(0, f.interest - INTEREST_DECAY * deltaSeconds);
      }

      if (f.interest >= 100 && this.hookedIndex === null) {
        this.hookedIndex = i;
        this.tension = TENSION_START;
        this.reelProgress = 0;
        this.hookOriginX = f.x;
        this.hookOriginY = f.y;
        this.lure.x = f.x;
        this.lure.y = f.y;
        this.lure.vx = 0;
        this.lure.vy = 0;
        this.onBite?.({ kind: f.kind });
      }
    }
  }

  private stepReel(deltaSeconds: number): void {
    const index = this.hookedIndex;
    if (index === null) return;
    const fish = this.fish[index];

    // 引き合っている間、魚はフック地点の周りで小刻みに暴れる(見た目の演出兼、糸を張ったままにする)。
    fish.x = this.hookOriginX + Math.sin(this.elapsedSeconds * 9) * 6;
    fish.y = this.hookOriginY + Math.cos(this.elapsedSeconds * 7) * 4;
    this.lure.x = fish.x;
    this.lure.y = fish.y;

    if (this.isHolding) {
      this.reelProgress = Math.min(REEL_PROGRESS_MAX, this.reelProgress + REEL_RATE * deltaSeconds);
      this.tension = Math.min(
        TENSION_MAX,
        this.tension + TENSION_RISE_RATE[fish.kind] * deltaSeconds,
      );
    } else {
      this.tension = Math.max(0, this.tension - TENSION_FALL_RATE * deltaSeconds);
    }

    if (this.tension >= TENSION_MAX) {
      this.onLost?.({ kind: fish.kind });
      this.warmth = Math.max(0, this.warmth - WARMTH_LOSS_ON_SNAP);
      this.fish[index] = this.spawnFish();
      this.hookedIndex = null;
      this.tension = 0;
      this.reelProgress = 0;
      return;
    }

    if (this.reelProgress >= REEL_PROGRESS_MAX) {
      const points = POINTS[fish.kind];
      this.score += points;
      this.catches += 1;
      this.warmth = Math.min(WARMTH_MAX, this.warmth + WARMTH_GAIN_ON_CATCH[fish.kind]);
      this.onCatch?.({ kind: fish.kind, points, catches: this.catches });
      this.fish[index] = this.spawnFish();
      this.hookedIndex = null;
      this.tension = 0;
      this.reelProgress = 0;
    }
  }
}
