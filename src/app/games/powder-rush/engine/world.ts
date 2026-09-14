export type ObstacleKind = "rock" | "tree";

export interface SnowPatch {
  id: number;
  x: number;
  z: number;
  radius: number;
}

export interface Obstacle {
  id: number;
  x: number;
  z: number;
  radius: number;
  kind: ObstacleKind;
}

export interface PatchCollectedEvent {
  x: number;
  points: number;
  combo: number;
}

export type ObstacleResolvedEvent =
  | { outcome: "crushed"; kind: ObstacleKind; x: number; points: number; combo: number }
  | { outcome: "hit"; kind: ObstacleKind; x: number };

export interface MeltedEvent {
  distance: number;
  score: number;
}

const BALL_RADIUS_START = 16;
const BALL_RADIUS_MAX = 46;
/** これ以下まで縮むと溶けてゲームオーバーになる半径。 */
const BALL_RADIUS_MELT = 6;
const GROWTH_PER_PATCH = 3;
const DAMAGE_PER_HIT = 8;
/** 何も集めずに放置していても陽射しで少しずつ縮んでいく速度(半径/秒)。 */
const SUN_MELT_RATE_PER_SECOND = 0.6;
/** 岩を押しつぶすには、自分の半径が岩の半径のこの倍率以上必要。 */
const CRUSH_RADIUS_RATIO = 1.15;

const BASE_SPEED = 220;
const SPEED_PER_RADIUS = 3.4;
const MAX_SPEED = 620;

const LATERAL_ACCEL = 900;
const LATERAL_MAX_SPEED = 420;
const LATERAL_DAMPING_PER_SECOND = 6;
const POINTER_STEER_SPEED = 620;

const SPAWN_AHEAD_DISTANCE = 900;
const SPAWN_INTERVAL_START = 0.85;
const SPAWN_INTERVAL_MIN = 0.32;
const SPAWN_INTERVAL_DECAY_PER_SECOND = 0.01;
const OBSTACLE_CHANCE_START = 0.45;
const OBSTACLE_CHANCE_MAX = 0.72;
const OBSTACLE_CHANCE_GROWTH_PER_SECOND = 0.004;

const PATCH_RADIUS = 22;
const ROCK_RADIUS_MIN = 15;
const ROCK_RADIUS_MAX = 28;
const TREE_RADIUS = 18;

/** 衝突判定に足す余裕(px)。厳密な当たり判定より「見た目で当たった」感を優先する。 */
const COLLISION_MARGIN = 6;
/** これより後方(ball基準)まで解決されずに残っていたアイテムは、通過扱いで消す。 */
const PASSED_MARGIN = 60;

const PATCH_BASE_SCORE = 15;
const CRUSH_BASE_SCORE = 40;
const COMBO_BONUS_PER_STREAK = 6;
const DISTANCE_SCORE_PER_UNIT = 0.05;

let nextItemId = 1;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * 雪山を転がり落ちるスノーボールを操るリアルタイム・エンドレスサバイバルの
 * 純粋ロジック層。React / three.js には一切依存しない。
 *
 * z は「obstacle/patch が this.distanceTraveled に到達する絶対距離」として持ち、
 * 描画側は (item.z - distanceTraveled) を奥行きに使う。ボール自体は常に z=0 の
 * 基準点に固定し、地形やアイテムの方が手前へ流れてくる見た目にする。
 */
export class PowderRushWorld {
  width = 0;
  height = 0;

  ballX = 0;
  ballRadius = BALL_RADIUS_START;
  private lateralVelocity = 0;
  private steeringInput: -1 | 0 | 1 = 0;
  private pointerTargetX: number | null = null;

  distanceTraveled = 0;
  speed = BASE_SPEED;
  score = 0;
  combo = 0;
  isOver = false;

  patches: SnowPatch[] = [];
  obstacles: Obstacle[] = [];

  private spawnTimer = SPAWN_INTERVAL_START;
  private elapsedSeconds = 0;

  onPatchCollected: ((event: PatchCollectedEvent) => void) | null = null;
  onObstacleResolved: ((event: ObstacleResolvedEvent) => void) | null = null;
  onMelted: ((event: MeltedEvent) => void) | null = null;

  constructor(width: number, height: number) {
    this.width = width > 0 ? width : 1;
    this.height = height > 0 ? height : 1;
    this.reset();
  }

  reset(): void {
    this.ballX = this.width / 2;
    this.ballRadius = BALL_RADIUS_START;
    this.lateralVelocity = 0;
    this.steeringInput = 0;
    this.pointerTargetX = null;
    this.distanceTraveled = 0;
    this.speed = BASE_SPEED;
    this.score = 0;
    this.combo = 0;
    this.isOver = false;
    this.patches = [];
    this.obstacles = [];
    this.spawnTimer = SPAWN_INTERVAL_START;
    this.elapsedSeconds = 0;
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const scaleX = this.width > 0 ? width / this.width : 1;
    if (this.width > 0) {
      this.ballX *= scaleX;
      for (const patch of this.patches) patch.x *= scaleX;
      for (const obstacle of this.obstacles) obstacle.x *= scaleX;
    }
    this.width = width;
    this.height = height;
    this.ballX = clamp(
      this.ballX,
      this.ballRadius,
      Math.max(this.ballRadius, this.width - this.ballRadius),
    );
  }

  /** キーボード等の連続的な左右入力(-1=左, 0=停止, 1=右)。押している間、毎フレーム呼ぶ想定。 */
  setSteeringInput(direction: -1 | 0 | 1): void {
    this.steeringInput = direction;
  }

  /** ポインタでドラッグ中の目標x座標。離したらnullに戻す想定。 */
  setPointerTarget(x: number | null): void {
    this.pointerTargetX = x;
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    this.elapsedSeconds += deltaSeconds;
    this.speed = clamp(
      BASE_SPEED + (this.ballRadius - BALL_RADIUS_START) * SPEED_PER_RADIUS,
      BASE_SPEED,
      MAX_SPEED,
    );
    this.distanceTraveled += this.speed * deltaSeconds;
    this.score += this.speed * deltaSeconds * DISTANCE_SCORE_PER_UNIT;

    this.ballRadius = Math.max(0, this.ballRadius - SUN_MELT_RATE_PER_SECOND * deltaSeconds);
    if (this.checkMelted()) return;

    this.updateLateralPosition(deltaSeconds);
    this.updateSpawning(deltaSeconds);
    this.resolvePatches();
    this.resolveObstacles();
  }

  /** 半径が溶ける閾値以下なら終了状態にし、まだなら false を返す。 */
  private checkMelted(): boolean {
    if (this.ballRadius > BALL_RADIUS_MELT) return false;
    this.isOver = true;
    this.onMelted?.({ distance: this.distanceTraveled, score: this.score });
    return true;
  }

  private updateLateralPosition(deltaSeconds: number): void {
    if (this.pointerTargetX !== null) {
      const delta = this.pointerTargetX - this.ballX;
      const maxStep = POINTER_STEER_SPEED * deltaSeconds;
      this.ballX += clamp(delta, -maxStep, maxStep);
      this.lateralVelocity = 0;
    } else {
      this.lateralVelocity += this.steeringInput * LATERAL_ACCEL * deltaSeconds;
      this.lateralVelocity = clamp(this.lateralVelocity, -LATERAL_MAX_SPEED, LATERAL_MAX_SPEED);
      if (this.steeringInput === 0) {
        const damping = Math.max(0, 1 - LATERAL_DAMPING_PER_SECOND * deltaSeconds);
        this.lateralVelocity *= damping;
      }
      this.ballX += this.lateralVelocity * deltaSeconds;
    }

    this.ballX = clamp(
      this.ballX,
      this.ballRadius,
      Math.max(this.ballRadius, this.width - this.ballRadius),
    );
  }

  private updateSpawning(deltaSeconds: number): void {
    this.spawnTimer -= deltaSeconds;
    if (this.spawnTimer > 0) return;

    const obstacleChance = Math.min(
      OBSTACLE_CHANCE_MAX,
      OBSTACLE_CHANCE_START + this.elapsedSeconds * OBSTACLE_CHANCE_GROWTH_PER_SECOND,
    );
    if (Math.random() < obstacleChance) {
      this.spawnObstacle();
    } else {
      this.spawnPatch();
    }

    const interval = Math.max(
      SPAWN_INTERVAL_MIN,
      SPAWN_INTERVAL_START - this.elapsedSeconds * SPAWN_INTERVAL_DECAY_PER_SECOND,
    );
    this.spawnTimer += interval;
  }

  private spawnPatch(): void {
    const margin = PATCH_RADIUS + 4;
    this.patches.push({
      id: nextItemId++,
      x: randRange(margin, Math.max(margin, this.width - margin)),
      z: this.distanceTraveled + SPAWN_AHEAD_DISTANCE,
      radius: PATCH_RADIUS,
    });
  }

  private spawnObstacle(): void {
    const kind: ObstacleKind = Math.random() < 0.5 ? "rock" : "tree";
    const radius = kind === "rock" ? randRange(ROCK_RADIUS_MIN, ROCK_RADIUS_MAX) : TREE_RADIUS;
    const margin = radius + 4;
    this.obstacles.push({
      id: nextItemId++,
      x: randRange(margin, Math.max(margin, this.width - margin)),
      z: this.distanceTraveled + SPAWN_AHEAD_DISTANCE,
      radius,
      kind,
    });
  }

  private resolvePatches(): void {
    for (let i = this.patches.length - 1; i >= 0; i--) {
      const patch = this.patches[i];
      const relativeZ = patch.z - this.distanceTraveled;

      if (Math.abs(relativeZ) <= this.ballRadius + patch.radius + COLLISION_MARGIN) {
        const lateralOverlap = Math.abs(this.ballX - patch.x) <= this.ballRadius + patch.radius;
        if (lateralOverlap) {
          this.patches.splice(i, 1);
          this.ballRadius = Math.min(BALL_RADIUS_MAX, this.ballRadius + GROWTH_PER_PATCH);
          this.combo += 1;
          const points = PATCH_BASE_SCORE + this.combo * COMBO_BONUS_PER_STREAK;
          this.score += points;
          this.onPatchCollected?.({ x: patch.x, points, combo: this.combo });
          continue;
        }
      }

      if (relativeZ < -PASSED_MARGIN) this.patches.splice(i, 1);
    }
  }

  private resolveObstacles(): void {
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const obstacle = this.obstacles[i];
      const relativeZ = obstacle.z - this.distanceTraveled;

      if (Math.abs(relativeZ) <= this.ballRadius + obstacle.radius + COLLISION_MARGIN) {
        const lateralOverlap =
          Math.abs(this.ballX - obstacle.x) <= this.ballRadius + obstacle.radius;
        if (lateralOverlap) {
          this.obstacles.splice(i, 1);
          this.resolveObstacleHit(obstacle);
          continue;
        }
      }

      if (relativeZ < -PASSED_MARGIN) this.obstacles.splice(i, 1);
    }
  }

  private resolveObstacleHit(obstacle: Obstacle): void {
    const canCrush =
      obstacle.kind === "rock" && this.ballRadius >= obstacle.radius * CRUSH_RADIUS_RATIO;

    if (canCrush) {
      this.combo += 1;
      const points = CRUSH_BASE_SCORE + this.combo * COMBO_BONUS_PER_STREAK;
      this.score += points;
      this.onObstacleResolved?.({
        outcome: "crushed",
        kind: obstacle.kind,
        x: obstacle.x,
        points,
        combo: this.combo,
      });
      return;
    }

    this.combo = 0;
    this.ballRadius = Math.max(0, this.ballRadius - DAMAGE_PER_HIT);
    this.onObstacleResolved?.({ outcome: "hit", kind: obstacle.kind, x: obstacle.x });
    this.checkMelted();
  }
}
