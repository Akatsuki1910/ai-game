export type TowerSide = "left" | "right";

export interface Tower {
  id: number;
  side: TowerSide;
  x: number;
  y: number;
  baseAngle: number;
  sweepAmplitude: number;
  sweepSpeed: number;
  phase: number;
  range: number;
  halfAperture: number;
  /** このフレームで実際に照らしている角度。描画側の演出に使う。 */
  currentAngle: number;
}

export interface BoatState {
  x: number;
  y: number;
  radius: number;
}

export interface CrossingCompletedEvent {
  crossings: number;
  points: number;
  isClean: boolean;
}

const BOAT_RADIUS = 14;
const FORWARD_SPEED = 70; // px/秒（通常時の前進速度）
const BOOST_SPEED_MULT = 1.8;
const STEER_SPEED = 260; // px/秒。舟が操舵目標へ近づく速さ
const IDLE_DRIFT_SPEED = 40; // px/秒。無操作時に中央へ戻る速さ
const SUSPICION_RATE = 55; // %/秒（照射強度1.0のとき）
const SUSPICION_DECAY_RATE = 30; // %/秒
const BOOST_SUSPICION_MULT = 1.6; // ブースト中に照らされると疑心度が上がりやすくなる
const SUSPICION_MAX = 100;
const GRACE_SECONDS = 1.5; // 出航直後/やり直し直後は疑心度が溜まらない猶予
const CLEAN_SUSPICION_THRESHOLD = 20;
const BASE_POINTS = 100;
const CLEAN_BONUS = 80;
const LIVES_START = 3;
const TOWER_COUNT_START = 3;
const TOWER_COUNT_MAX = 7;
const ILLUMINATION_THRESHOLD = 0.12;

let nextTowerId = 1;

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** 角度差を [-π, π] に正規化する。 */
function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/**
 * 夜の海峡をサーチライトから隠れながら渡るリアルタイム潜入ゲームの純粋ロジック層。
 * React / pixi.js には一切依存しない。
 */
export class BlackoutFerryWorld {
  width = 0;
  height = 0;
  boat: BoatState = { x: 0, y: 0, radius: BOAT_RADIUS };
  towers: Tower[] = [];
  score = 0;
  crossings = 0;
  lives = LIVES_START;
  suspicion = 0;
  /** 現在の照射強度(0〜1)。HUDの警戒表示に使う。 */
  illumination = 0;
  isOver = false;
  isBoosting = false;
  private steerTargetX: number | null = null;
  private graceSecondsRemaining = 0;
  private elapsedSeconds = 0;

  onCrossingCompleted: ((event: CrossingCompletedEvent) => void) | null = null;
  onCaught: (() => void) | null = null;

  constructor(width: number, height: number) {
    this.resize(width, height);
    this.reset();
  }

  reset(): void {
    this.score = 0;
    this.crossings = 0;
    this.lives = LIVES_START;
    this.suspicion = 0;
    this.illumination = 0;
    this.isOver = false;
    this.isBoosting = false;
    this.steerTargetX = null;
    this.graceSecondsRemaining = GRACE_SECONDS;
    this.elapsedSeconds = 0;
    this.boat = { x: this.width / 2, y: 0, radius: BOAT_RADIUS };
    this.towers = this.spawnTowers(TOWER_COUNT_START);
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const scaleX = this.width > 0 ? width / this.width : 1;
    const scaleY = this.height > 0 ? height / this.height : 1;
    if (this.width > 0 && this.height > 0) {
      this.boat.x *= scaleX;
      this.boat.y *= scaleY;
      if (this.steerTargetX !== null) this.steerTargetX *= scaleX;
      for (const tower of this.towers) {
        // 岸(左端/右端)に固定されているタワーなので、幅そのものへ付け直す。
        tower.x = tower.side === "left" ? 0 : width;
        tower.y *= scaleY;
        tower.range *= scaleX;
      }
    }
    this.width = width;
    this.height = height;
  }

  /** ドラッグ/クリックで狙った位置(world座標のx)へ操舵目標を設定する。 */
  setSteerTarget(x: number): void {
    this.steerTargetX = this.clampBoatX(x);
  }

  clearSteerTarget(): void {
    this.steerTargetX = null;
  }

  /** キーボード操作用に、操舵目標を現在位置からの相対移動で動かす。 */
  nudgeSteerTarget(dx: number): void {
    const base = this.steerTargetX ?? this.boat.x;
    this.steerTargetX = this.clampBoatX(base + dx);
  }

  setBoosting(isBoosting: boolean): void {
    this.isBoosting = isBoosting;
  }

  private clampBoatX(x: number): number {
    return Math.min(Math.max(x, this.boat.radius), this.width - this.boat.radius);
  }

  private spawnTowers(count: number): Tower[] {
    const towers: Tower[] = [];
    for (let i = 0; i < count; i++) {
      const side: TowerSide = i % 2 === 0 ? "left" : "right";
      const heightRatio = (i + 1) / (count + 1);
      const y = this.height * heightRatio + randRange(-30, 30);
      const baseAngle = side === "left" ? 0 : Math.PI;
      towers.push({
        id: nextTowerId++,
        side,
        x: side === "left" ? 0 : this.width,
        y,
        baseAngle,
        sweepAmplitude: randRange(0.55, 0.95),
        sweepSpeed: randRange(0.5, 0.8) + this.crossings * 0.05,
        phase: randRange(0, Math.PI * 2),
        range: Math.max(this.width, this.height) * randRange(0.38, 0.48),
        halfAperture: randRange(0.22, 0.3),
        currentAngle: baseAngle,
      });
    }
    return towers;
  }

  private computeIllumination(): number {
    let maxIntensity = 0;
    for (const tower of this.towers) {
      const dx = this.boat.x - tower.x;
      const dy = this.boat.y - tower.y;
      const dist = Math.hypot(dx, dy);
      if (dist > tower.range) continue;
      const angleToBoat = Math.atan2(dy, dx);
      const angularDiff = Math.abs(wrapAngle(angleToBoat - tower.currentAngle));
      if (angularDiff > tower.halfAperture) continue;
      const distanceFactor = 1 - dist / tower.range;
      const angleFactor = 1 - angularDiff / tower.halfAperture;
      maxIntensity = Math.max(maxIntensity, distanceFactor * angleFactor);
    }
    return Math.min(1, maxIntensity);
  }

  private completeCrossing(): void {
    this.crossings += 1;
    const isClean = this.suspicion < CLEAN_SUSPICION_THRESHOLD;
    const points = BASE_POINTS + (isClean ? CLEAN_BONUS : 0);
    this.score += points;
    this.onCrossingCompleted?.({ crossings: this.crossings, points, isClean });

    this.boat.x = this.width / 2;
    this.boat.y = 0;
    this.steerTargetX = null;
    this.suspicion = 0;
    this.graceSecondsRemaining = GRACE_SECONDS;
    this.towers = this.spawnTowers(Math.min(TOWER_COUNT_MAX, TOWER_COUNT_START + this.crossings));
  }

  private handleCaught(): void {
    this.lives -= 1;
    this.onCaught?.();
    if (this.lives <= 0) {
      this.isOver = true;
      return;
    }
    this.boat.x = this.width / 2;
    this.boat.y = 0;
    this.steerTargetX = null;
    this.suspicion = 0;
    this.graceSecondsRemaining = GRACE_SECONDS;
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;
    this.elapsedSeconds += deltaSeconds;

    for (const tower of this.towers) {
      tower.currentAngle =
        tower.baseAngle +
        Math.sin(this.elapsedSeconds * tower.sweepSpeed + tower.phase) * tower.sweepAmplitude;
    }

    if (this.steerTargetX !== null) {
      const dx = this.steerTargetX - this.boat.x;
      const maxStep = STEER_SPEED * deltaSeconds;
      this.boat.x += Math.min(Math.max(dx, -maxStep), maxStep);
    } else {
      const dx = this.width / 2 - this.boat.x;
      const maxStep = IDLE_DRIFT_SPEED * deltaSeconds;
      this.boat.x += Math.min(Math.max(dx, -maxStep), maxStep);
    }
    this.boat.x = this.clampBoatX(this.boat.x);

    const speedMult = this.isBoosting ? BOOST_SPEED_MULT : 1;
    this.boat.y += FORWARD_SPEED * speedMult * deltaSeconds;

    this.illumination = this.computeIllumination();
    const isSpotted = this.illumination > ILLUMINATION_THRESHOLD;

    if (this.graceSecondsRemaining > 0) {
      this.graceSecondsRemaining = Math.max(0, this.graceSecondsRemaining - deltaSeconds);
    } else if (isSpotted) {
      const suspicionMult = this.isBoosting ? BOOST_SUSPICION_MULT : 1;
      this.suspicion = Math.min(
        SUSPICION_MAX,
        this.suspicion + SUSPICION_RATE * this.illumination * suspicionMult * deltaSeconds,
      );
      if (this.suspicion >= SUSPICION_MAX) {
        this.handleCaught();
        return;
      }
    } else {
      this.suspicion = Math.max(0, this.suspicion - SUSPICION_DECAY_RATE * deltaSeconds);
    }

    if (this.boat.y >= this.height) {
      this.completeCrossing();
    }
  }
}
