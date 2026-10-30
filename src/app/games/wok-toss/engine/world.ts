export type IngredientKind = "carrot" | "shrimp" | "egg";

export interface Ingredient {
  id: number;
  kind: IngredientKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

export interface WokBounds {
  centerX: number;
  bottomY: number;
  halfWidth: number;
  rimRaise: number;
}

export interface TossEvent {
  ingredient: Ingredient;
  points: number;
  combo: number;
}

export interface MissEvent {
  ingredient: Ingredient;
  livesRemaining: number;
}

const GRAVITY = 1600; // px/秒^2
const RESTITUTION = 0.72;
const BOUNCE_KICK = 60; // 弾むたびに加える上向きの追加速度（px/秒）
const TILT_PUSH = 420; // 傾き(rad)がバウンド時の横方向へ与える速度係数
const MAX_TILT = 0.5; // rad（約28.6度）
const TILT_SMOOTH_RATE = 6; // 傾きがtiltTargetへ追従する速さ（1/秒）
const START_LIVES = 3;
const BASE_BOUNCE_POINTS = 10;
const COMBO_BONUS_PER_HIT = 3;
const MAX_COMBO = 20;
const COMBO_WINDOW_SECONDS = 2.2;
const START_SPAWN_INTERVAL = 1.8;
const MIN_SPAWN_INTERVAL = 0.7;
const SPAWN_RAMP_RATE = 0.012; // 秒経過ごとに出現間隔が狭まる速さ
const MAX_INGREDIENTS = 6;
const INGREDIENT_RADIUS = 18;
const SPAWN_DRIFT_SPEED = 65; // 出現時に具材が持つ左右方向の初期速度の最大値(px/秒)
const MAX_INGREDIENT_SPEED = 240; // 具材の左右方向の速度の上限(px/秒)。傾きの連打で暴走しないようにする
const RIM_FORGIVENESS = INGREDIENT_RADIUS * 0.5; // 縁ぎりぎりでもすぐにはこぼれ落ちない猶予距離(px)
const INGREDIENT_KINDS: readonly IngredientKind[] = ["carrot", "shrimp", "egg"];

let nextId = 1;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export class WokTossWorld {
  width = 0;
  height = 0;
  ingredients: Ingredient[] = [];
  score = 0;
  lives = START_LIVES;
  combo = 0;
  tossCount = 0;
  tiltAngle = 0;
  tiltTarget = 0;
  elapsedSeconds = 0;
  isOver = false;

  private spawnTimer = 0;
  private lastBounceAt = Number.NEGATIVE_INFINITY;

  onToss: ((event: TossEvent) => void) | null = null;
  onMiss: ((event: MissEvent) => void) | null = null;

  constructor(width: number, height: number) {
    this.resize(width, height);
    this.reset();
  }

  reset(): void {
    this.ingredients = [];
    this.score = 0;
    this.lives = START_LIVES;
    this.combo = 0;
    this.tossCount = 0;
    this.tiltAngle = 0;
    this.tiltTarget = 0;
    this.elapsedSeconds = 0;
    this.isOver = false;
    this.lastBounceAt = Number.NEGATIVE_INFINITY;
    this.spawnTimer = START_SPAWN_INTERVAL * 0.4;
    this.spawnIngredient();
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const scaleX = this.width > 0 ? width / this.width : 1;
    const scaleY = this.height > 0 ? height / this.height : 1;
    if (this.width > 0 && this.height > 0) {
      for (const ingredient of this.ingredients) {
        ingredient.x *= scaleX;
        ingredient.y *= scaleY;
      }
    }
    this.width = width;
    this.height = height;
  }

  setTiltTarget(normalized: number): void {
    this.tiltTarget = clamp(normalized, -1, 1);
  }

  getWokBounds(): WokBounds {
    return {
      centerX: this.width * 0.5,
      bottomY: this.height * 0.82,
      halfWidth: this.width * 0.36,
      rimRaise: this.height * 0.15,
    };
  }

  /** ウォック中央を基準に、x位置での鍋面の高さ(y座標)を返す。中央が最も深く、縁に近づくほど浅くなる。 */
  surfaceYAt(x: number): number {
    const { centerX, bottomY, halfWidth, rimRaise } = this.getWokBounds();
    const dx = x - centerX;
    const ratio = clamp(Math.abs(dx) / halfWidth, 0, 1);
    return bottomY - rimRaise * ratio * ratio;
  }

  private spawnIngredient(): void {
    if (this.ingredients.length >= MAX_INGREDIENTS) return;
    const { centerX, halfWidth } = this.getWokBounds();
    const kindIndex = Math.floor(randRange(0, INGREDIENT_KINDS.length));
    this.ingredients.push({
      id: nextId++,
      kind: INGREDIENT_KINDS[kindIndex] ?? "carrot",
      x: centerX + randRange(-halfWidth * 0.5, halfWidth * 0.5),
      y: -INGREDIENT_RADIUS * 2,
      vx: randRange(-SPAWN_DRIFT_SPEED, SPAWN_DRIFT_SPEED),
      vy: 0,
      radius: INGREDIENT_RADIUS,
    });
  }

  private currentSpawnInterval(): number {
    return Math.max(
      MIN_SPAWN_INTERVAL,
      START_SPAWN_INTERVAL - this.elapsedSeconds * SPAWN_RAMP_RATE,
    );
  }

  private registerToss(ingredient: Ingredient): void {
    this.combo = Math.min(MAX_COMBO, this.combo + 1);
    this.lastBounceAt = this.elapsedSeconds;
    const points = BASE_BOUNCE_POINTS + this.combo * COMBO_BONUS_PER_HIT;
    this.score += points;
    this.tossCount += 1;
    this.onToss?.({ ingredient, points, combo: this.combo });
  }

  private registerMiss(ingredient: Ingredient, index: number): void {
    this.ingredients.splice(index, 1);
    this.combo = 0;
    this.lives = Math.max(0, this.lives - 1);
    this.onMiss?.({ ingredient, livesRemaining: this.lives });
    if (this.lives <= 0) this.isOver = true;
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;
    this.elapsedSeconds += deltaSeconds;

    const target = this.tiltTarget * MAX_TILT;
    this.tiltAngle += (target - this.tiltAngle) * Math.min(1, TILT_SMOOTH_RATE * deltaSeconds);

    this.spawnTimer -= deltaSeconds;
    if (this.spawnTimer <= 0) {
      this.spawnIngredient();
      this.spawnTimer = this.currentSpawnInterval();
    }

    const bounds = this.getWokBounds();
    for (let i = this.ingredients.length - 1; i >= 0; i--) {
      const ingredient = this.ingredients[i];
      ingredient.vy += GRAVITY * deltaSeconds;
      ingredient.x += ingredient.vx * deltaSeconds;
      ingredient.y += ingredient.vy * deltaSeconds;

      const dx = ingredient.x - bounds.centerX;
      const surfaceY = this.surfaceYAt(ingredient.x);

      if (ingredient.vy > 0 && ingredient.y + ingredient.radius >= surfaceY) {
        if (Math.abs(dx) <= bounds.halfWidth + RIM_FORGIVENESS) {
          ingredient.y = surfaceY - ingredient.radius;
          ingredient.vy = -(ingredient.vy * RESTITUTION + BOUNCE_KICK);
          ingredient.vx = clamp(
            ingredient.vx + this.tiltAngle * TILT_PUSH,
            -MAX_INGREDIENT_SPEED,
            MAX_INGREDIENT_SPEED,
          );
          this.registerToss(ingredient);
          continue;
        }
        this.registerMiss(ingredient, i);
        continue;
      }

      if (ingredient.y > this.height + ingredient.radius * 4) {
        this.registerMiss(ingredient, i);
      }
    }

    if (this.combo > 0 && this.elapsedSeconds - this.lastBounceAt > COMBO_WINDOW_SECONDS) {
      this.combo = 0;
    }
  }
}
