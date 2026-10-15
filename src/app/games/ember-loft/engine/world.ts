export interface Obstacle {
  id: number;
  x: number;
  altitude: number;
  kind: "cloud" | "bird";
}

export interface ThermalOrb {
  id: number;
  x: number;
  altitude: number;
}

export interface ObstacleHitEvent {
  obstacle: Obstacle;
}

export interface OrbCollectedEvent {
  orb: ThermalOrb;
  points: number;
}

/** ワールド座標系の基準となる縦幅(=高度の範囲)。画面サイズが変わっても物理法則はこの値で一定にする。 */
export const LOGICAL_HEIGHT = 600;
/** 高度0=地面。触れると即座に墜落する。 */
export const GROUND_ALTITUDE = 0;
/** 高度の上限(=天井/薄い空気の層)。壁として跳ね返るだけで墜落はしない。 */
export const CEILING_ALTITUDE = LOGICAL_HEIGHT;
/** 風の帯の数。低層・中層・高層の3層に分ける。 */
export const WIND_BAND_COUNT = 3;
const BAND_HEIGHT = LOGICAL_HEIGHT / WIND_BAND_COUNT;

// 釣り合いとなる熱量。これより熱ければ浮き、冷たければ沈む(重力を熱の calibrated point として表現)。
const NEUTRAL_HEAT = 0.42;
// 熱量ぶんの浮力がどれだけ強い上昇加速度になるか
const LIFT_FORCE = 220;
// バーナー点火中の熱量上昇速度(1秒あたり)
const HEAT_GAIN_PER_SECOND = 0.55;
// 常に働く放熱速度(1秒あたり)。バーナーを切ると正味で冷えていく。
const HEAT_LOSS_PER_SECOND = 0.32;
// この高度を超えると空気が薄く冷えやすくなり、追加の放熱が働く
const HIGH_ALTITUDE_COOLING_START = CEILING_ALTITUDE * 0.82;
const HIGH_ALTITUDE_COOLING_MAX = 0.5;
// 垂直速度の減衰(1秒あたりに残る割合)。バルーン特有のふわっとした動きを作る。
const VERTICAL_DAMPING_PER_SECOND = 0.22;
// 直立時の前進速度(px/秒、ロジカル座標)
const BASE_FORWARD_SPEED = 95;
// 風の帯ごとの振動数・位相(帯によって追い風/向かい風のタイミングがずれる)
const BAND_FREQUENCIES = [0.32, 0.47, 0.61];
const BAND_PHASES = [0, Math.PI / 2, Math.PI];
const WIND_MULTIPLIER_MIN = 0.12;
const WIND_MULTIPLIER_MAX = 1.9;
// 経過時間に応じて風の振れ幅(=帯ごとの速度差)が大きくなっていく
const WIND_AMPLITUDE_BASE = 0.55;
const WIND_AMPLITUDE_GROWTH_PER_SECOND = 0.008;
const WIND_AMPLITUDE_MAX = 0.92;

const INITIAL_INTEGRITY = 100;
const OBSTACLE_DAMAGE = 25;
const OBSTACLE_HIT_RADIUS_X = 34;
const OBSTACLE_HIT_RADIUS_ALTITUDE = 60;
const ORB_COLLECT_RADIUS_X = 32;
const ORB_COLLECT_RADIUS_ALTITUDE = 72;
const ORB_SCORE = 15;
const ALTITUDE_MARGIN = 60;

const OBSTACLE_SPACING_MIN = 260;
const OBSTACLE_SPACING_MAX = 430;
const OBSTACLE_SPACING_SHRINK_PER_SECOND = 0.0025;
const OBSTACLE_SPACING_MIN_FACTOR = 0.5;
const ORB_SPACING_MIN = 380;
const ORB_SPACING_MAX = 650;

const SPAWN_AHEAD_MULTIPLIER = 1.6;
const PRUNE_BEHIND_MARGIN = 300;
const DISTANCE_SCORE_DIVISOR = 6;

let nextObstacleId = 1;
let nextOrbId = 1;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * 熱気球で上昇気流を渡り歩くワールド。
 * プレイヤーはバーナーの点火/消火(=熱量の増減)だけを操作し、浮力(熱量-釣り合い点)を
 * 積分して高度を決める。高度によって3層の風の帯があり、帯ごとに時間で変化する
 * 追い風/向かい風の強さが前進速度を左右する(=同じ操作でも高度選びで進み方が変わる)。
 */
export class EmberLoftWorld {
  width = 0;
  height = 0;

  /** 高度(0=地面, CEILING_ALTITUDE=天井)。 */
  altitude = LOGICAL_HEIGHT * 0.4;
  /** 垂直速度(ロジカル座標/秒)。正で上昇。 */
  verticalVelocity = 0;
  /** 熱量(0〜1)。バーナーを点火している間だけ上昇する。 */
  heat = NEUTRAL_HEAT;
  private isBurnerOn = false;

  /** 進んだ距離(ロジカル座標のX)。 */
  distance = 0;
  /** 気球の外皮の耐久(0で墜落)。 */
  integrity = INITIAL_INTEGRITY;
  private elapsedSeconds = 0;

  obstacles: Obstacle[] = [];
  orbs: ThermalOrb[] = [];
  private lastObstacleSpawnX = 0;
  private lastOrbSpawnX = 0;
  private orbBonus = 0;

  score = 0;
  orbsCollected = 0;
  isOver = false;
  /** 墜落の原因。UI側で表示文言を出し分けるために公開する。 */
  crashReason: "ground" | "integrity" | null = null;

  onObstacleHit: ((event: ObstacleHitEvent) => void) | null = null;
  onOrbCollected: ((event: OrbCollectedEvent) => void) | null = null;

  constructor(width: number, height: number) {
    this.width = width > 0 ? width : 1;
    this.height = height > 0 ? height : 1;
    this.reset();
  }

  reset(): void {
    this.altitude = LOGICAL_HEIGHT * 0.4;
    this.verticalVelocity = 0;
    this.heat = NEUTRAL_HEAT;
    this.isBurnerOn = false;
    this.distance = 0;
    this.integrity = INITIAL_INTEGRITY;
    this.elapsedSeconds = 0;
    this.obstacles = [];
    this.orbs = [];
    this.lastObstacleSpawnX = 0;
    this.lastOrbSpawnX = 0;
    this.orbBonus = 0;
    this.score = 0;
    this.orbsCollected = 0;
    this.isOver = false;
    this.crashReason = null;
    this.ensureAhead();
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.width = width;
    this.height = height;
    this.ensureAhead();
  }

  /** 画面の縦幅に対する物理スケール(ロジカル座標→画面ピクセル)。 */
  get scale(): number {
    return this.height > 0 ? this.height / LOGICAL_HEIGHT : 1;
  }

  /** 現在の画面幅を、ロジカル座標の横幅に換算した値。 */
  get logicalViewWidth(): number {
    return this.scale > 0 ? this.width / this.scale : this.width;
  }

  /** 描画側が使う、追従カメラの左端のワールドX座標。プレイヤーは画面のやや左寄りに固定表示する。 */
  get cameraX(): number {
    return Math.max(0, this.distance - this.logicalViewWidth * 0.35);
  }

  /** 現在の風の振れ幅の上限。経過時間とともに大きくなる。 */
  get windAmplitude(): number {
    return Math.min(
      WIND_AMPLITUDE_MAX,
      WIND_AMPLITUDE_BASE + this.elapsedSeconds * WIND_AMPLITUDE_GROWTH_PER_SECOND,
    );
  }

  /** 高度から風の帯index(0=低層〜WIND_BAND_COUNT-1=高層)を求める。 */
  getBandIndex(altitude: number): number {
    return clamp(Math.floor(altitude / BAND_HEIGHT), 0, WIND_BAND_COUNT - 1);
  }

  /** 指定した帯の現在の前進倍率(1=平常。追い風で大きく、向かい風でほぼ0近くまで下がる)。 */
  getBandMultiplier(band: number): number {
    const freq = BAND_FREQUENCIES[band] ?? BAND_FREQUENCIES[0];
    const phase = BAND_PHASES[band] ?? 0;
    const wobble = this.windAmplitude * Math.sin(this.elapsedSeconds * freq + phase);
    return clamp(1 + wobble, WIND_MULTIPLIER_MIN, WIND_MULTIPLIER_MAX);
  }

  /** プレイヤーが現在いる帯の倍率。 */
  get currentBandMultiplier(): number {
    return this.getBandMultiplier(this.getBandIndex(this.altitude));
  }

  /** バーナーの点火/消火。押している間 true を渡し続ける想定。 */
  setBurner(isOn: boolean): void {
    this.isBurnerOn = isOn;
  }

  get burnerOn(): boolean {
    return this.isBurnerOn;
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    this.elapsedSeconds += deltaSeconds;

    const heatDelta = this.isBurnerOn ? HEAT_GAIN_PER_SECOND : -HEAT_LOSS_PER_SECOND;
    let nextHeat = this.heat + heatDelta * deltaSeconds;
    if (this.altitude > HIGH_ALTITUDE_COOLING_START) {
      const ratio =
        (this.altitude - HIGH_ALTITUDE_COOLING_START) /
        (CEILING_ALTITUDE - HIGH_ALTITUDE_COOLING_START);
      nextHeat -= HIGH_ALTITUDE_COOLING_MAX * ratio * deltaSeconds;
    }
    this.heat = clamp(nextHeat, 0, 1);

    const lift = (this.heat - NEUTRAL_HEAT) * LIFT_FORCE;
    this.verticalVelocity += lift * deltaSeconds;
    this.verticalVelocity *= VERTICAL_DAMPING_PER_SECOND ** deltaSeconds;
    this.altitude += this.verticalVelocity * deltaSeconds;

    if (this.altitude <= GROUND_ALTITUDE) {
      this.altitude = GROUND_ALTITUDE;
      this.verticalVelocity = 0;
      this.isOver = true;
      this.crashReason = "ground";
      return;
    }
    if (this.altitude >= CEILING_ALTITUDE) {
      this.altitude = CEILING_ALTITUDE;
      this.verticalVelocity = Math.min(this.verticalVelocity, 0);
    }

    this.distance += BASE_FORWARD_SPEED * this.currentBandMultiplier * deltaSeconds;

    this.collectOrbs();
    this.checkObstacleCollisions();
    if (this.integrity <= 0) {
      this.integrity = 0;
      this.isOver = true;
      this.crashReason = "integrity";
      return;
    }

    this.score = Math.floor(this.distance / DISTANCE_SCORE_DIVISOR) + this.orbBonus;
    this.ensureAhead();
  }

  private collectOrbs(): void {
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const orb = this.orbs[i];
      if (Math.abs(orb.x - this.distance) > ORB_COLLECT_RADIUS_X) continue;
      if (Math.abs(orb.altitude - this.altitude) > ORB_COLLECT_RADIUS_ALTITUDE) continue;

      this.orbs.splice(i, 1);
      this.orbsCollected += 1;
      this.orbBonus += ORB_SCORE;
      this.heat = Math.min(1, this.heat + 0.08);
      this.onOrbCollected?.({ orb, points: ORB_SCORE });
    }
  }

  private checkObstacleCollisions(): void {
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const obstacle = this.obstacles[i];
      if (Math.abs(obstacle.x - this.distance) > OBSTACLE_HIT_RADIUS_X) continue;
      if (Math.abs(obstacle.altitude - this.altitude) > OBSTACLE_HIT_RADIUS_ALTITUDE) continue;

      this.obstacles.splice(i, 1);
      this.integrity = Math.max(0, this.integrity - OBSTACLE_DAMAGE);
      this.onObstacleHit?.({ obstacle });
    }
  }

  private ensureAhead(): void {
    const horizon = this.cameraX + this.logicalViewWidth * SPAWN_AHEAD_MULTIPLIER;
    const spacingFactor = Math.max(
      OBSTACLE_SPACING_MIN_FACTOR,
      1 - this.elapsedSeconds * OBSTACLE_SPACING_SHRINK_PER_SECOND,
    );

    while (this.lastObstacleSpawnX < horizon) {
      this.lastObstacleSpawnX +=
        randRange(OBSTACLE_SPACING_MIN, OBSTACLE_SPACING_MAX) * spacingFactor;
      this.obstacles.push({
        id: nextObstacleId++,
        x: this.lastObstacleSpawnX,
        altitude: randRange(ALTITUDE_MARGIN, LOGICAL_HEIGHT - ALTITUDE_MARGIN),
        kind: Math.random() < 0.5 ? "cloud" : "bird",
      });
    }

    while (this.lastOrbSpawnX < horizon) {
      this.lastOrbSpawnX += randRange(ORB_SPACING_MIN, ORB_SPACING_MAX);
      this.orbs.push({
        id: nextOrbId++,
        x: this.lastOrbSpawnX,
        altitude: randRange(ALTITUDE_MARGIN, LOGICAL_HEIGHT - ALTITUDE_MARGIN),
      });
    }

    const pruneBefore = this.cameraX - PRUNE_BEHIND_MARGIN;
    while (this.obstacles.length > 0 && this.obstacles[0].x < pruneBefore) {
      this.obstacles.shift();
    }
    while (this.orbs.length > 0 && this.orbs[0].x < pruneBefore) {
      this.orbs.shift();
    }
  }
}
