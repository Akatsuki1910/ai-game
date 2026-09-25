export interface Thermal {
  id: number;
  x: number;
  z: number;
}

export interface Bird {
  id: number;
  x: number;
  z: number;
  altitude: number;
}

export interface ThermalCaughtEvent {
  x: number;
  points: number;
  streak: number;
}

export interface BirdHitEvent {
  x: number;
  altitude: number;
}

export interface CrashedEvent {
  distance: number;
  score: number;
}

const ALTITUDE_START = 70;
const ALTITUDE_MAX = 100;
/** これ以下まで沈むと墜落してゲームオーバーになる高度。 */
const ALTITUDE_CRASH = 0;
/** 何も操作しなくても重力で常に失っていく高度(高度/秒)。 */
const SINK_RATE_PER_SECOND = 3;
/** 上昇入力(climbInput=1)を最大まで入れたときに得られる上昇力(高度/秒)。沈降より強いので、
 * 操作し続ければ沈降を相殺してわずかに上昇できる。 */
const CLIMB_RATE_PER_SECOND = 11;
/**
 * サーマル(上昇気流)に初めて入った瞬間に得られる高度ボーナス(1回だけ)。
 * 沈降のように継続的に効く力ではなく、パッチ取得のような一度きりの加算にすることで、
 * 何も操作しない放置プレイでも(サーマルを偶然拾い続けたとしても)沈降の方が長期的には
 * 必ず上回り、いずれ必ず墜落するという設計を保証する。
 */
const THERMAL_CATCH_ALTITUDE_BONUS = 6;

const FORWARD_SPEED_BASE = 260;
const FORWARD_SPEED_MAX = 420;
const FORWARD_SPEED_GROWTH_PER_SECOND = 4;

const LATERAL_ACCEL = 900;
const LATERAL_MAX_SPEED = 420;
const LATERAL_DAMPING_PER_SECOND = 6;
const POINTER_STEER_SPEED = 620;

const SPAWN_AHEAD_DISTANCE = 900;
const SPAWN_INTERVAL_START = 1.1;
const SPAWN_INTERVAL_MIN = 0.5;
const SPAWN_INTERVAL_DECAY_PER_SECOND = 0.012;
const BIRD_CHANCE_START = 0.4;
const BIRD_CHANCE_MAX = 0.68;
const BIRD_CHANCE_GROWTH_PER_SECOND = 0.005;

const THERMAL_LATERAL_RADIUS = 70;
/** サーマルの奥行き方向の厚み。この区間に重なった瞬間に捕捉判定が発生する。 */
const THERMAL_THICKNESS = 220;

const BIRD_LATERAL_RADIUS = 26;
const BIRD_ALTITUDE_RADIUS = 14;
const BIRD_ALTITUDE_MIN = 18;
const BIRD_ALTITUDE_MAX = ALTITUDE_MAX - 15;
/** 鳥に当たると失う高度。 */
const BIRD_HIT_ALTITUDE_LOSS = 18;

/** 当たり判定に足す余裕(px)。厳密な当たり判定より「見た目で当たった」感を優先する。 */
const COLLISION_MARGIN = 6;
/** これより後方(グライダー基準)まで解決されずに残っていたアイテムは、通過扱いで消す。 */
const PASSED_MARGIN = 60;

const DISTANCE_SCORE_PER_UNIT = 0.05;
const THERMAL_CATCH_BASE_SCORE = 50;
const STREAK_BONUS_PER = 8;

let nextItemId = 1;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * 紙飛行機で上昇気流(サーマル)を捕まえながら飛び続けるリアルタイム・エンドレス
 * グライダーの純粋ロジック層。React / three.js には一切依存しない。
 *
 * z は「thermal/bird が this.distanceTraveled に到達する絶対距離」として持ち、
 * 描画側は (item.z - distanceTraveled) を奥行きに使う。グライダー自体は常に z=0 の
 * 基準点に固定し、地形やアイテムの方が手前へ流れてくる見た目にする。
 *
 * 高度(altitude)は画面の縦ピクセルサイズとは独立した抽象値(0〜ALTITUDE_MAX)として持つ。
 * リサイズしても高度のスケールは変わらないため、resize() では横方向(x)だけを比例させる。
 */
export class ThermalGliderWorld {
  width = 0;
  height = 0;

  gliderX = 0;
  altitude = ALTITUDE_START;
  private lateralVelocity = 0;
  private steeringInput: -1 | 0 | 1 = 0;
  private pointerTargetX: number | null = null;
  private climbInput = 0;

  distanceTraveled = 0;
  speed = FORWARD_SPEED_BASE;
  score = 0;
  streak = 0;
  isOver = false;

  thermals: Thermal[] = [];
  birds: Bird[] = [];

  private spawnTimer = SPAWN_INTERVAL_START;
  private elapsedSeconds = 0;
  /** 現在ライド中(上昇気流の中に入っている)サーマルのid集合。新規捕捉の検出に使う。 */
  private activeThermalIds = new Set<number>();

  onThermalCaught: ((event: ThermalCaughtEvent) => void) | null = null;
  onBirdHit: ((event: BirdHitEvent) => void) | null = null;
  onCrashed: ((event: CrashedEvent) => void) | null = null;

  constructor(width: number, height: number) {
    this.width = width > 0 ? width : 1;
    this.height = height > 0 ? height : 1;
    this.reset();
  }

  reset(): void {
    this.gliderX = this.width / 2;
    this.altitude = ALTITUDE_START;
    this.lateralVelocity = 0;
    this.steeringInput = 0;
    this.pointerTargetX = null;
    this.climbInput = 0;
    this.distanceTraveled = 0;
    this.speed = FORWARD_SPEED_BASE;
    this.score = 0;
    this.streak = 0;
    this.isOver = false;
    this.thermals = [];
    this.birds = [];
    this.spawnTimer = SPAWN_INTERVAL_START;
    this.elapsedSeconds = 0;
    this.activeThermalIds.clear();
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const scaleX = this.width > 0 ? width / this.width : 1;
    if (this.width > 0) {
      this.gliderX *= scaleX;
      for (const thermal of this.thermals) thermal.x *= scaleX;
      for (const bird of this.birds) bird.x *= scaleX;
    }
    this.width = width;
    this.height = height;
    this.gliderX = clamp(this.gliderX, 0, this.width);
  }

  /** キーボード等の連続的な左右入力(-1=左, 0=停止, 1=右)。押している間、毎フレーム呼ぶ想定。 */
  setSteeringInput(direction: -1 | 0 | 1): void {
    this.steeringInput = direction;
  }

  /** ポインタでドラッグ中の目標x座標。離したらnullに戻す想定。 */
  setPointerTarget(x: number | null): void {
    this.pointerTargetX = x;
  }

  /** 上昇/降下の連続入力(-1=最大降下操作, 0=中立, 1=最大上昇操作)。キー/ポインタ共通。 */
  setClimbInput(value: number): void {
    this.climbInput = clamp(value, -1, 1);
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    this.elapsedSeconds += deltaSeconds;
    this.speed = clamp(
      FORWARD_SPEED_BASE + this.elapsedSeconds * FORWARD_SPEED_GROWTH_PER_SECOND,
      FORWARD_SPEED_BASE,
      FORWARD_SPEED_MAX,
    );
    this.distanceTraveled += this.speed * deltaSeconds;
    this.score += this.speed * deltaSeconds * DISTANCE_SCORE_PER_UNIT;

    this.updateLateralPosition(deltaSeconds);
    this.updateAltitude(deltaSeconds);
    if (this.checkCrashed()) return;

    this.updateSpawning(deltaSeconds);
    this.resolveThermals();
    this.resolveBirds();
  }

  /** 高度が墜落閾値以下なら終了状態にし、まだなら false を返す。 */
  private checkCrashed(): boolean {
    if (this.altitude > ALTITUDE_CRASH) return false;
    this.altitude = ALTITUDE_CRASH;
    this.isOver = true;
    this.onCrashed?.({ distance: this.distanceTraveled, score: this.score });
    return true;
  }

  private updateLateralPosition(deltaSeconds: number): void {
    if (this.pointerTargetX !== null) {
      const delta = this.pointerTargetX - this.gliderX;
      const maxStep = POINTER_STEER_SPEED * deltaSeconds;
      this.gliderX += clamp(delta, -maxStep, maxStep);
      this.lateralVelocity = 0;
    } else {
      this.lateralVelocity += this.steeringInput * LATERAL_ACCEL * deltaSeconds;
      this.lateralVelocity = clamp(this.lateralVelocity, -LATERAL_MAX_SPEED, LATERAL_MAX_SPEED);
      if (this.steeringInput === 0) {
        const damping = Math.max(0, 1 - LATERAL_DAMPING_PER_SECOND * deltaSeconds);
        this.lateralVelocity *= damping;
      }
      this.gliderX += this.lateralVelocity * deltaSeconds;
    }

    this.gliderX = clamp(this.gliderX, 0, this.width);
  }

  private updateAltitude(deltaSeconds: number): void {
    this.catchNewThermals();
    const verticalRate = -SINK_RATE_PER_SECOND + this.climbInput * CLIMB_RATE_PER_SECOND;
    this.altitude = clamp(this.altitude + verticalRate * deltaSeconds, 0, ALTITUDE_MAX);
  }

  /**
   * 今フレーム重なっているサーマルのうち、前フレームまで重なっていなかったものへ
   * 捕捉イベント(スコア/ストリーク/高度ボーナスを一度だけ加算)を発火する。
   * サーマルは通過し終えるまでワールドに残り続けるが、ボーナスは1つにつき1回だけ。
   */
  private catchNewThermals(): void {
    const currentlyInside = new Set<number>();
    for (const thermal of this.thermals) {
      if (!this.overlapsThermal(thermal)) continue;
      currentlyInside.add(thermal.id);
      if (!this.activeThermalIds.has(thermal.id)) {
        this.streak += 1;
        const points = THERMAL_CATCH_BASE_SCORE + this.streak * STREAK_BONUS_PER;
        this.score += points;
        this.altitude = clamp(this.altitude + THERMAL_CATCH_ALTITUDE_BONUS, 0, ALTITUDE_MAX);
        this.onThermalCaught?.({ x: thermal.x, points, streak: this.streak });
      }
    }
    this.activeThermalIds = currentlyInside;
  }

  private overlapsThermal(thermal: Thermal): boolean {
    const relativeZ = thermal.z - this.distanceTraveled;
    if (Math.abs(relativeZ) > THERMAL_THICKNESS / 2) return false;
    return Math.abs(this.gliderX - thermal.x) <= THERMAL_LATERAL_RADIUS;
  }

  private updateSpawning(deltaSeconds: number): void {
    this.spawnTimer -= deltaSeconds;
    if (this.spawnTimer > 0) return;

    const birdChance = Math.min(
      BIRD_CHANCE_MAX,
      BIRD_CHANCE_START + this.elapsedSeconds * BIRD_CHANCE_GROWTH_PER_SECOND,
    );
    if (Math.random() < birdChance) {
      this.spawnBird();
    } else {
      this.spawnThermal();
    }

    const interval = Math.max(
      SPAWN_INTERVAL_MIN,
      SPAWN_INTERVAL_START - this.elapsedSeconds * SPAWN_INTERVAL_DECAY_PER_SECOND,
    );
    this.spawnTimer += interval;
  }

  private spawnThermal(): void {
    const margin = THERMAL_LATERAL_RADIUS * 0.6;
    this.thermals.push({
      id: nextItemId++,
      x: randRange(margin, Math.max(margin, this.width - margin)),
      z: this.distanceTraveled + SPAWN_AHEAD_DISTANCE,
    });
  }

  private spawnBird(): void {
    const margin = BIRD_LATERAL_RADIUS + 4;
    this.birds.push({
      id: nextItemId++,
      x: randRange(margin, Math.max(margin, this.width - margin)),
      z: this.distanceTraveled + SPAWN_AHEAD_DISTANCE,
      altitude: randRange(BIRD_ALTITUDE_MIN, BIRD_ALTITUDE_MAX),
    });
  }

  private resolveThermals(): void {
    for (let i = this.thermals.length - 1; i >= 0; i--) {
      const thermal = this.thermals[i];
      const relativeZ = thermal.z - this.distanceTraveled;

      if (relativeZ < -(THERMAL_THICKNESS / 2 + PASSED_MARGIN)) {
        this.thermals.splice(i, 1);
      }
    }
  }

  private resolveBirds(): void {
    for (let i = this.birds.length - 1; i >= 0; i--) {
      const bird = this.birds[i];
      const relativeZ = bird.z - this.distanceTraveled;

      if (Math.abs(relativeZ) <= BIRD_LATERAL_RADIUS + COLLISION_MARGIN) {
        const lateralOverlap = Math.abs(this.gliderX - bird.x) <= BIRD_LATERAL_RADIUS;
        const altitudeOverlap = Math.abs(this.altitude - bird.altitude) <= BIRD_ALTITUDE_RADIUS;
        if (lateralOverlap && altitudeOverlap) {
          this.birds.splice(i, 1);
          this.streak = 0;
          this.altitude = Math.max(0, this.altitude - BIRD_HIT_ALTITUDE_LOSS);
          this.onBirdHit?.({ x: bird.x, altitude: bird.altitude });
          this.checkCrashed();
          continue;
        }
      }

      if (relativeZ < -PASSED_MARGIN) this.birds.splice(i, 1);
    }
  }
}
