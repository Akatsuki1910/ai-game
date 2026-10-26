export interface Truffle {
  id: number;
  x: number;
  y: number;
  totalLifeSeconds: number;
  remainingSeconds: number;
  isLocated: boolean;
  digProgress: number;
}

export interface TruffleDugEvent {
  truffle: Truffle;
  points: number;
  freshnessRatio: number;
}

export interface TruffleLostEvent {
  truffle: Truffle;
}

export const DOG_SPEED = 240; // px/秒
const LOCATE_RADIUS = 56;
const DIG_RADIUS = 30;
const SCENT_RANGE = 460;
const DIG_DURATION_SECONDS = 1.1;
const DIG_DECAY_PER_SECOND = 0.6;
// ワールドは最初 1x1 のプレースホルダーで生成され、実寸が分かった時点で resize()
// によって拡大される。resize() は既存の座標を倍率で引き伸ばすだけなので、
// 生成時の座標は比率(width/heightに対する割合)で決めないと、プレースホルダー時の
// 絶対px値がそのまま巨大な倍率で引き伸ばされて画面外(あるいは角に固定)になってしまう。
const MARGIN_RATIO = 0.08;
const MIN_SPAWN_DISTANCE_FROM_DOG_RATIO = 0.18;
const MIN_SPAWN_DISTANCE_FROM_OTHERS_RATIO = 0.1;
const SPAWN_ATTEMPTS = 12;

const BASE_POINTS = 100;
const FRESHNESS_BONUS_MAX = 80;
export const MISS_LIMIT = 5;

const INITIAL_ACTIVE_TRUFFLES = 2;
export const MAX_ACTIVE_TRUFFLES = 4;
const DUGS_PER_EXTRA_TRUFFLE = 3;
const DIFFICULTY_RAMP_DUGS = 12;
const TRUFFLE_LIFE_MIN_START = 20;
const TRUFFLE_LIFE_MAX_START = 30;
const TRUFFLE_LIFE_MIN_END = 10;
const TRUFFLE_LIFE_MAX_END = 15;

let nextId = 1;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * 森で犬を誘導し、匂いの強さだけを頼りに埋まったトリュフを探して掘り出すワールド。
 * トリュフの正確な位置は `isLocated` が true になるまでUI側には出さない想定
 * （実際に近づいて見つけることが核になるゲーム性のため）。
 */
export class TruffleTrailWorld {
  width = 0;
  height = 0;
  dogX = 0;
  dogY = 0;
  targetX = 0;
  targetY = 0;
  digHeld = false;
  truffles: Truffle[] = [];
  score = 0;
  missed = 0;
  dugCount = 0;
  isOver = false;
  readonly missLimit = MISS_LIMIT;

  onTruffleDug: ((event: TruffleDugEvent) => void) | null = null;
  onTruffleLost: ((event: TruffleLostEvent) => void) | null = null;

  constructor(width: number, height: number) {
    this.resize(width, height);
    this.reset();
  }

  reset(): void {
    this.score = 0;
    this.missed = 0;
    this.dugCount = 0;
    this.isOver = false;
    this.digHeld = false;
    this.dogX = this.width / 2;
    this.dogY = this.height * 0.85;
    this.targetX = this.dogX;
    this.targetY = this.dogY;
    this.truffles = [];
    const initialCount = this.activeCountForDifficulty();
    for (let i = 0; i < initialCount; i++) {
      this.truffles.push(this.spawnTruffle());
    }
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const scaleX = this.width > 0 ? width / this.width : 1;
    const scaleY = this.height > 0 ? height / this.height : 1;
    if (this.width > 0 && this.height > 0) {
      this.dogX *= scaleX;
      this.dogY *= scaleY;
      this.targetX *= scaleX;
      this.targetY *= scaleY;
      for (const truffle of this.truffles) {
        truffle.x *= scaleX;
        truffle.y *= scaleY;
      }
    }
    this.width = width;
    this.height = height;
  }

  setMoveTarget(x: number, y: number): void {
    this.targetX = clamp(x, 0, this.width);
    this.targetY = clamp(y, 0, this.height);
  }

  setDigHeld(held: boolean): void {
    this.digHeld = held;
  }

  get nearestTruffleDistance(): number {
    const nearest = this.nearestTruffle();
    if (!nearest) return Number.POSITIVE_INFINITY;
    return Math.hypot(nearest.x - this.dogX, nearest.y - this.dogY);
  }

  get scentStrength(): number {
    const distance = this.nearestTruffleDistance;
    if (!Number.isFinite(distance)) return 0;
    return clamp(1 - distance / SCENT_RANGE, 0, 1);
  }

  private nearestTruffle(): Truffle | undefined {
    let best: Truffle | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const truffle of this.truffles) {
      const distance = Math.hypot(truffle.x - this.dogX, truffle.y - this.dogY);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = truffle;
      }
    }
    return best;
  }

  private activeCountForDifficulty(): number {
    return Math.min(
      MAX_ACTIVE_TRUFFLES,
      INITIAL_ACTIVE_TRUFFLES + Math.floor(this.dugCount / DUGS_PER_EXTRA_TRUFFLE),
    );
  }

  private currentLifeSeconds(): number {
    const t = clamp(this.dugCount / DIFFICULTY_RAMP_DUGS, 0, 1);
    const min = lerp(TRUFFLE_LIFE_MIN_START, TRUFFLE_LIFE_MIN_END, t);
    const max = lerp(TRUFFLE_LIFE_MAX_START, TRUFFLE_LIFE_MAX_END, t);
    return randRange(min, Math.max(min, max));
  }

  private spawnTruffle(): Truffle {
    const minX = this.width * MARGIN_RATIO;
    const maxX = this.width * (1 - MARGIN_RATIO);
    const minY = this.height * MARGIN_RATIO;
    const maxY = this.height * (1 - MARGIN_RATIO);
    const shorterSide = Math.min(this.width, this.height);
    const minDistanceFromDog = shorterSide * MIN_SPAWN_DISTANCE_FROM_DOG_RATIO;
    const minDistanceFromOthers = shorterSide * MIN_SPAWN_DISTANCE_FROM_OTHERS_RATIO;

    let x = randRange(minX, maxX);
    let y = randRange(minY, maxY);
    for (let attempt = 0; attempt < SPAWN_ATTEMPTS; attempt++) {
      const farFromDog = Math.hypot(x - this.dogX, y - this.dogY) >= minDistanceFromDog;
      const farFromOthers = this.truffles.every(
        (truffle) => Math.hypot(x - truffle.x, y - truffle.y) >= minDistanceFromOthers,
      );
      if (farFromDog && farFromOthers) break;
      x = randRange(minX, maxX);
      y = randRange(minY, maxY);
    }

    const life = this.currentLifeSeconds();
    return {
      id: nextId++,
      x,
      y,
      totalLifeSeconds: life,
      remainingSeconds: life,
      isLocated: false,
      digProgress: 0,
    };
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    const dx = this.targetX - this.dogX;
    const dy = this.targetY - this.dogY;
    const distance = Math.hypot(dx, dy);
    if (distance > 0.0001) {
      const move = Math.min(distance, DOG_SPEED * deltaSeconds);
      this.dogX += (dx / distance) * move;
      this.dogY += (dy / distance) * move;
    }
    this.dogX = clamp(this.dogX, 0, this.width);
    this.dogY = clamp(this.dogY, 0, this.height);

    for (let i = this.truffles.length - 1; i >= 0; i--) {
      const truffle = this.truffles[i];
      const distanceToDog = Math.hypot(truffle.x - this.dogX, truffle.y - this.dogY);

      if (!truffle.isLocated && distanceToDog <= LOCATE_RADIUS) {
        truffle.isLocated = true;
      }

      if (truffle.isLocated && this.digHeld && distanceToDog <= DIG_RADIUS) {
        truffle.digProgress = Math.min(
          1,
          truffle.digProgress + deltaSeconds / DIG_DURATION_SECONDS,
        );
      } else {
        truffle.digProgress = Math.max(
          0,
          truffle.digProgress - deltaSeconds * DIG_DECAY_PER_SECOND,
        );
      }

      if (truffle.digProgress >= 1) {
        const freshnessRatio = clamp(truffle.remainingSeconds / truffle.totalLifeSeconds, 0, 1);
        const points = Math.round(BASE_POINTS + FRESHNESS_BONUS_MAX * freshnessRatio);
        this.score += points;
        this.dugCount += 1;
        this.onTruffleDug?.({ truffle, points, freshnessRatio });
        this.truffles.splice(i, 1);
        continue;
      }

      truffle.remainingSeconds -= deltaSeconds;
      if (truffle.remainingSeconds <= 0) {
        this.missed += 1;
        this.onTruffleLost?.({ truffle });
        this.truffles.splice(i, 1);
        if (this.missed >= this.missLimit) {
          this.isOver = true;
        }
      }
    }

    const desired = this.activeCountForDifficulty();
    while (!this.isOver && this.truffles.length < desired) {
      this.truffles.push(this.spawnTruffle());
    }
  }
}
