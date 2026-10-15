export interface Rock {
  id: number;
  distance: number;
  x: number;
  radius: number;
  isResolved: boolean;
}

export interface Gate {
  id: number;
  distance: number;
  gapCenterX: number;
  gapHalfWidth: number;
  isResolved: boolean;
  wasSuccess: boolean;
}

export interface HitEvent {
  reason: "rock" | "bank";
  livesRemaining: number;
}

export interface GateResultEvent {
  isSuccess: boolean;
  combo: number;
  points: number;
}

/** 川幅の基準となる、ワールド座標系の横幅。実際のキャンバス幅とは独立した論理単位。 */
export const LOGICAL_WIDTH = 600;
export const KAYAK_RADIUS = 14;
export const MAX_LIVES = 3;

const RIVER_BASE_CENTER = LOGICAL_WIDTH / 2;
const CENTER_AMPLITUDE_1 = 70;
const CENTER_FREQ_1 = 0.006;
const CENTER_AMPLITUDE_2 = 30;
const CENTER_FREQ_2 = 0.013;
const CENTER_PHASE_2 = 1.7;

const BANK_HALF_WIDTH_BASE = 130;
const BANK_HALF_WIDTH_MIN = 60;
const BANK_NARROW_PER_UNIT = 0.015;

const GATE_HALF_WIDTH_BASE = 55;
const GATE_HALF_WIDTH_MIN = 32;
const GATE_NARROW_PER_UNIT = 0.01;

const LATERAL_ACCEL = 340;
// 1フレーム呼び出しごとに速度へ掛ける減衰係数(高頻度呼び出し前提。他ゲームの ANGULAR_DAMPING と同じ流儀)。
const LATERAL_DAMPING = 0.9;
const BANK_BOUNCE_VELOCITY_KEEP = 0.4;
const BANK_BOUNCE_MIN_KICK = 40;

const BASE_FORWARD_SPEED = 150;
const MAX_FORWARD_SPEED = 430;
const FORWARD_SPEED_RAMP_PER_SECOND = 5.2;

const HIT_INVULNERABLE_SECONDS = 1.1;

const ROCK_SPACING_MIN = 170;
const ROCK_SPACING_MAX = 320;
const ROCK_RADIUS_MIN = 16;
const ROCK_RADIUS_MAX = 24;

const GATE_SPACING_MIN = 260;
const GATE_SPACING_MAX = 420;
const GATE_BASE_SCORE = 40;
const GATE_COMBO_BONUS_RATE = 0.35;

const SCORE_DISTANCE_DIVISOR = 14;

const SPAWN_LOOKAHEAD_DISTANCE = 1400;
const PRUNE_BEHIND_DISTANCE = 260;

const INITIAL_ROCK_CLEARANCE = 240;
const INITIAL_GATE_CLEARANCE = 320;

let nextEntityId = 1;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** 流れ下った距離に対する川の中心線(うねり)。 */
export function riverCenterX(distance: number): number {
  return (
    RIVER_BASE_CENTER +
    Math.sin(distance * CENTER_FREQ_1) * CENTER_AMPLITUDE_1 +
    Math.sin(distance * CENTER_FREQ_2 + CENTER_PHASE_2) * CENTER_AMPLITUDE_2
  );
}

/** 流れ下った距離に対する川幅の半分。先に進むほど急流になって狭くなる。 */
export function riverHalfWidth(distance: number): number {
  return Math.max(BANK_HALF_WIDTH_MIN, BANK_HALF_WIDTH_BASE - distance * BANK_NARROW_PER_UNIT);
}

/** ゲートの通過口の半幅。先に進むほど狭くなる。 */
export function gateHalfWidthAt(distance: number): number {
  return Math.max(GATE_HALF_WIDTH_MIN, GATE_HALF_WIDTH_BASE - distance * GATE_NARROW_PER_UNIT);
}

/**
 * 急流を下るカヤックのワールド。
 * カヤックは常に川の流れで自動的に前進し(速度は時間とともに上がる)、
 * プレイヤーは左右への傾き(lean: -1〜1)だけを操作する。
 * 岸に当たる/岩に当たるとライフを失い、ゲートの間を通過するとコンボ付きで得点する。
 */
export class RapidsWeaveWorld {
  lateralX = 0;
  lateralVelocity = 0;
  private lean = 0;

  distance = 0;
  speed = BASE_FORWARD_SPEED;
  private elapsedSeconds = 0;

  lives = MAX_LIVES;
  combo = 0;
  score = 0;
  isOver = false;
  invulnerableSeconds = 0;

  rocks: Rock[] = [];
  gates: Gate[] = [];
  private lastRockSpawnDistance = 0;
  private lastGateSpawnDistance = 0;
  private gateScoreBonus = 0;

  onHit: ((event: HitEvent) => void) | null = null;
  onGateResult: ((event: GateResultEvent) => void) | null = null;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.lateralVelocity = 0;
    this.lean = 0;
    this.distance = 0;
    this.speed = BASE_FORWARD_SPEED;
    this.elapsedSeconds = 0;
    this.lives = MAX_LIVES;
    this.combo = 0;
    this.score = 0;
    this.isOver = false;
    this.invulnerableSeconds = 0;
    this.rocks = [];
    this.gates = [];
    this.lastRockSpawnDistance = INITIAL_ROCK_CLEARANCE;
    this.lastGateSpawnDistance = INITIAL_GATE_CLEARANCE;
    this.gateScoreBonus = 0;
    this.lateralX = riverCenterX(0);
    this.ensureObstaclesAhead();
  }

  /** 左右の傾き。-1(左)〜1(右)。毎フレーム呼ぶ想定で、次の step() にのみ効く。 */
  setLean(value: number): void {
    this.lean = clamp(value, -1, 1);
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    this.elapsedSeconds += deltaSeconds;
    this.speed = Math.min(
      MAX_FORWARD_SPEED,
      BASE_FORWARD_SPEED + this.elapsedSeconds * FORWARD_SPEED_RAMP_PER_SECOND,
    );
    this.distance += this.speed * deltaSeconds;

    this.lateralVelocity += this.lean * LATERAL_ACCEL * deltaSeconds;
    this.lateralVelocity *= LATERAL_DAMPING;
    this.lateralX += this.lateralVelocity * deltaSeconds;

    if (this.invulnerableSeconds > 0) {
      this.invulnerableSeconds = Math.max(0, this.invulnerableSeconds - deltaSeconds);
    }

    this.resolveBankCollision();
    if (!this.isOver) this.resolveRocks();
    if (!this.isOver) this.resolveGates();

    this.score = Math.floor(this.distance / SCORE_DISTANCE_DIVISOR) + this.gateScoreBonus;

    this.ensureObstaclesAhead();
    this.pruneBehind();
  }

  private resolveBankCollision(): void {
    const center = riverCenterX(this.distance);
    const halfWidth = riverHalfWidth(this.distance);
    const min = center - halfWidth + KAYAK_RADIUS;
    const max = center + halfWidth - KAYAK_RADIUS;

    if (this.lateralX < min) {
      this.lateralX = min;
      this.lateralVelocity =
        Math.abs(this.lateralVelocity) * BANK_BOUNCE_VELOCITY_KEEP + BANK_BOUNCE_MIN_KICK;
      if (this.invulnerableSeconds <= 0) this.registerHit("bank");
    } else if (this.lateralX > max) {
      this.lateralX = max;
      this.lateralVelocity = -(
        Math.abs(this.lateralVelocity) * BANK_BOUNCE_VELOCITY_KEEP +
        BANK_BOUNCE_MIN_KICK
      );
      if (this.invulnerableSeconds <= 0) this.registerHit("bank");
    }
  }

  private resolveRocks(): void {
    for (const rock of this.rocks) {
      if (rock.isResolved || this.distance < rock.distance) continue;
      rock.isResolved = true;
      if (this.invulnerableSeconds > 0) continue;
      const dx = this.lateralX - rock.x;
      if (Math.abs(dx) <= rock.radius + KAYAK_RADIUS) {
        this.registerHit("rock");
        if (this.isOver) return;
      }
    }
  }

  private resolveGates(): void {
    for (const gate of this.gates) {
      if (gate.isResolved || this.distance < gate.distance) continue;
      gate.isResolved = true;
      const isSuccess = Math.abs(this.lateralX - gate.gapCenterX) <= gate.gapHalfWidth;
      gate.wasSuccess = isSuccess;

      if (isSuccess) {
        this.combo += 1;
        const points = Math.round(GATE_BASE_SCORE * (1 + (this.combo - 1) * GATE_COMBO_BONUS_RATE));
        this.gateScoreBonus += points;
        this.onGateResult?.({ isSuccess: true, combo: this.combo, points });
      } else {
        this.combo = 0;
        this.onGateResult?.({ isSuccess: false, combo: 0, points: 0 });
      }
    }
  }

  private registerHit(reason: HitEvent["reason"]): void {
    this.lives -= 1;
    this.combo = 0;
    this.invulnerableSeconds = HIT_INVULNERABLE_SECONDS;
    if (this.lives <= 0) {
      this.lives = 0;
      this.isOver = true;
    }
    this.onHit?.({ reason, livesRemaining: this.lives });
  }

  private ensureObstaclesAhead(): void {
    const horizon = this.distance + SPAWN_LOOKAHEAD_DISTANCE;

    while (this.lastRockSpawnDistance < horizon) {
      this.lastRockSpawnDistance += randRange(ROCK_SPACING_MIN, ROCK_SPACING_MAX);
      const spawnDistance = this.lastRockSpawnDistance;
      const center = riverCenterX(spawnDistance);
      const halfWidth = riverHalfWidth(spawnDistance);
      const radius = randRange(ROCK_RADIUS_MIN, ROCK_RADIUS_MAX);
      const maxOffset = Math.max(0, halfWidth - radius - KAYAK_RADIUS * 0.5);
      const offset = randRange(-maxOffset, maxOffset);
      this.rocks.push({
        id: nextEntityId++,
        distance: spawnDistance,
        x: center + offset,
        radius,
        isResolved: false,
      });
    }

    while (this.lastGateSpawnDistance < horizon) {
      this.lastGateSpawnDistance += randRange(GATE_SPACING_MIN, GATE_SPACING_MAX);
      const spawnDistance = this.lastGateSpawnDistance;
      const center = riverCenterX(spawnDistance);
      const halfWidth = riverHalfWidth(spawnDistance);
      const gapHalfWidth = gateHalfWidthAt(spawnDistance);
      const maxOffset = Math.max(0, halfWidth - gapHalfWidth - 6);
      const offset = randRange(-maxOffset, maxOffset);
      this.gates.push({
        id: nextEntityId++,
        distance: spawnDistance,
        gapCenterX: center + offset,
        gapHalfWidth,
        isResolved: false,
        wasSuccess: false,
      });
    }
  }

  private pruneBehind(): void {
    const cutoff = this.distance - PRUNE_BEHIND_DISTANCE;
    while (this.rocks.length > 0 && this.rocks[0].distance < cutoff) this.rocks.shift();
    while (this.gates.length > 0 && this.gates[0].distance < cutoff) this.gates.shift();
  }
}
