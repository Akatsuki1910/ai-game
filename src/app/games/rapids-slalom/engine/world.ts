export type GateColor = "green" | "red";

export interface Kayak {
  x: number;
  vx: number;
}

export interface Gate {
  y: number;
  gapCenterX: number;
  gapHalfWidth: number;
  poleRadius: number;
  color: GateColor;
  resolved: boolean;
}

export interface Rock {
  x: number;
  y: number;
  radius: number;
  resolved: boolean;
}

export interface GateResolvedEvent {
  color: GateColor;
  isClean: boolean;
  combo: number;
  points: number;
}

export interface RockHitEvent {
  livesRemaining: number;
}

export const KAYAK_RADIUS = 16;
export const STARTING_LIVES = 3;
export const KAYAK_Y_RATIO = 0.78;

const BASE_SPEED = 150;
const SPEED_PER_COMBO = 7;
const SPEED_MAX = 420;

const STEER_ACCEL_PER_SECOND = 1400;
const STEER_MAX_SPEED = 520;

const GATE_HALF_WIDTH_START = 108;
const GATE_HALF_WIDTH_MIN = 52;
const GATE_HALF_WIDTH_STEP = 3;
const POLE_RADIUS = 9;
const GATE_SPACING_MIN = 420;
const GATE_SPACING_MAX = 560;
const FIRST_GATE_DISTANCE = 260;
const FORCED_GREEN_GATE_COUNT = 2;
const RED_GATE_CHANCE = 0.4;

const ROCK_RADIUS = 17;
const ROCK_SPACING_MIN = 520;
const ROCK_SPACING_MAX = 900;
const ROCK_SPACING_MAX_FLOOR = 340;
const ROCK_SPACING_STEP_PER_COMBO = 10;

export const BRACE_WINDOW_SECONDS = 0.55;
const GATE_BASE_POINTS = 150;
const GATE_COMBO_BONUS = 40;

const SPAWN_Y = -40;
const CLEANUP_MARGIN_BELOW = 80;

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * 急流を下るスラロームカヤックの純粋ロジック層。React / pixi.js には一切依存しない。
 * ゲート(緑=そのまま通過、赤=ブレース発動中に通過)を正しく通り続け、岩を避けるほど
 * スコアとコンボが伸び、流れも次第に速くゲートも狭くなる。
 */
export class RapidsSlalomWorld {
  width = 0;
  height = 0;
  kayak: Kayak = { x: 0, vx: 0 };
  targetX = 0;
  gates: Gate[] = [];
  rocks: Rock[] = [];
  score = 0;
  combo = 0;
  lives = STARTING_LIVES;
  isOver = false;
  braceUntil = Number.NEGATIVE_INFINITY;
  private elapsedSeconds = 0;
  private distanceUntilNextGate = 0;
  private distanceUntilNextRock = 0;
  private gatesSpawned = 0;

  onGateResolved: ((event: GateResolvedEvent) => void) | null = null;
  onRockHit: ((event: RockHitEvent) => void) | null = null;

  constructor(width: number, height: number) {
    this.resize(width, height);
    this.reset();
  }

  get kayakY(): number {
    return this.height * KAYAK_Y_RATIO;
  }

  get isBracing(): boolean {
    return this.elapsedSeconds < this.braceUntil;
  }

  /** 次に通過するべき(未解決の)ゲート。存在しなければ undefined。 */
  get nextGate(): Gate | undefined {
    return this.gates.find((gate) => !gate.resolved);
  }

  reset(): void {
    this.score = 0;
    this.combo = 0;
    this.lives = STARTING_LIVES;
    this.isOver = false;
    this.elapsedSeconds = 0;
    this.braceUntil = Number.NEGATIVE_INFINITY;
    this.gatesSpawned = 0;
    this.kayak = { x: this.width / 2, vx: 0 };
    this.targetX = this.kayak.x;
    this.gates = [];
    this.rocks = [];
    this.distanceUntilNextGate = FIRST_GATE_DISTANCE;
    this.distanceUntilNextRock = randRange(ROCK_SPACING_MIN, ROCK_SPACING_MAX);
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const scaleX = this.width > 0 ? width / this.width : 1;
    const scaleY = this.height > 0 ? height / this.height : 1;
    if (this.width > 0 && this.height > 0) {
      this.kayak.x *= scaleX;
      this.targetX *= scaleX;
      for (const gate of this.gates) {
        gate.gapCenterX *= scaleX;
        gate.y *= scaleY;
      }
      for (const rock of this.rocks) {
        rock.x *= scaleX;
        rock.y *= scaleY;
      }
    }
    this.width = width;
    this.height = height;
    this.kayak.x = Math.min(Math.max(this.kayak.x, KAYAK_RADIUS), this.width - KAYAK_RADIUS);
    this.targetX = Math.min(Math.max(this.targetX, KAYAK_RADIUS), this.width - KAYAK_RADIUS);
  }

  /** 操作: 狙う横位置(px)をセットする。ドラッグ位置やキー入力から呼ぶ。 */
  setSteerTarget(x: number): void {
    this.targetX = Math.min(Math.max(x, KAYAK_RADIUS), this.width - KAYAK_RADIUS);
  }

  /** 操作: パドルブレースを発動する。一定時間だけ有効で、赤ゲート通過に必要。 */
  brace(): void {
    this.braceUntil = this.elapsedSeconds + BRACE_WINDOW_SECONDS;
  }

  private currentSpeed(): number {
    return Math.min(SPEED_MAX, BASE_SPEED + this.combo * SPEED_PER_COMBO);
  }

  private spawnGate(): void {
    this.gatesSpawned += 1;
    const gapHalfWidth = Math.max(
      GATE_HALF_WIDTH_MIN,
      GATE_HALF_WIDTH_START - this.combo * GATE_HALF_WIDTH_STEP,
    );
    const marginRatio = this.width > 0 ? Math.min(0.4, (gapHalfWidth + 30) / this.width) : 0.25;
    const gapCenterX = randRange(this.width * marginRatio, this.width * (1 - marginRatio));
    const isForcedGreen = this.gatesSpawned <= FORCED_GREEN_GATE_COUNT;
    const color: GateColor = !isForcedGreen && Math.random() < RED_GATE_CHANCE ? "red" : "green";
    this.gates.push({
      y: SPAWN_Y,
      gapCenterX,
      gapHalfWidth,
      poleRadius: POLE_RADIUS,
      color,
      resolved: false,
    });
  }

  private spawnRock(): void {
    const x = randRange(ROCK_RADIUS * 1.5, this.width - ROCK_RADIUS * 1.5);
    this.rocks.push({ x, y: SPAWN_Y, radius: ROCK_RADIUS, resolved: false });
  }

  private resolveGate(gate: Gate): void {
    gate.resolved = true;
    const halfSpan = gate.gapHalfWidth - KAYAK_RADIUS;
    const withinGap = Math.abs(this.kayak.x - gate.gapCenterX) < halfSpan;
    const bracedOk = gate.color !== "red" || this.isBracing;
    const isClean = withinGap && bracedOk;

    if (isClean) {
      const points = GATE_BASE_POINTS + this.combo * GATE_COMBO_BONUS;
      this.score += points;
      this.combo += 1;
      this.onGateResolved?.({ color: gate.color, isClean: true, combo: this.combo, points });
    } else {
      this.combo = 0;
      this.lives -= 1;
      this.onGateResolved?.({ color: gate.color, isClean: false, combo: 0, points: 0 });
      if (this.lives <= 0) this.isOver = true;
    }
  }

  private resolveRockHit(rock: Rock): void {
    rock.resolved = true;
    this.combo = 0;
    this.lives -= 1;
    this.onRockHit?.({ livesRemaining: this.lives });
    if (this.lives <= 0) this.isOver = true;
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;
    this.elapsedSeconds += deltaSeconds;

    const dx = this.targetX - this.kayak.x;
    const desiredVx = Math.sign(dx) * Math.min(STEER_MAX_SPEED, Math.abs(dx) * 6);
    const vxDelta = desiredVx - this.kayak.vx;
    const maxVxDelta = STEER_ACCEL_PER_SECOND * deltaSeconds;
    this.kayak.vx += Math.abs(vxDelta) <= maxVxDelta ? vxDelta : Math.sign(vxDelta) * maxVxDelta;
    this.kayak.x += this.kayak.vx * deltaSeconds;
    this.kayak.x = Math.min(Math.max(this.kayak.x, KAYAK_RADIUS), this.width - KAYAK_RADIUS);

    const travel = this.currentSpeed() * deltaSeconds;

    this.distanceUntilNextGate -= travel;
    if (this.distanceUntilNextGate <= 0) {
      this.spawnGate();
      this.distanceUntilNextGate += randRange(GATE_SPACING_MIN, GATE_SPACING_MAX);
    }

    this.distanceUntilNextRock -= travel;
    if (this.distanceUntilNextRock <= 0) {
      this.spawnRock();
      const spacingMax = Math.max(
        ROCK_SPACING_MAX_FLOOR,
        ROCK_SPACING_MAX - this.combo * ROCK_SPACING_STEP_PER_COMBO,
      );
      const spacingMin = Math.min(ROCK_SPACING_MIN, spacingMax);
      this.distanceUntilNextRock += randRange(spacingMin, spacingMax);
    }

    const kayakY = this.kayakY;

    for (const gate of this.gates) {
      const previousY = gate.y;
      gate.y += travel;
      if (!gate.resolved && previousY < kayakY && gate.y >= kayakY) {
        this.resolveGate(gate);
        if (this.isOver) return;
      }
    }

    for (const rock of this.rocks) {
      rock.y += travel;
      if (!rock.resolved) {
        const dist = Math.hypot(this.kayak.x - rock.x, kayakY - rock.y);
        if (dist < KAYAK_RADIUS + rock.radius) {
          this.resolveRockHit(rock);
          if (this.isOver) return;
        }
      }
    }

    const cleanupY = this.height + CLEANUP_MARGIN_BELOW;
    this.gates = this.gates.filter((gate) => gate.y <= cleanupY);
    this.rocks = this.rocks.filter((rock) => rock.y <= cleanupY);
  }
}
