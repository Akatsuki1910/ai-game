export type PanSide = "left" | "right";

export interface GrainPouredEvent {
  x: number;
  pan: PanSide | "gap";
}

export interface RoundCompletedEvent {
  points: number;
  combo: number;
  target: number;
}

export interface SpillEvent {
  leftWeight: number;
  rightWeight: number;
}

export const ROUND_SECONDS = 75;
export const MAX_CAPACITY = 100;
export const TARGET_TOLERANCE = 6;

const SPAWN_INTERVAL = 0.05; // 秒。1粒あたりの注ぎ間隔（≒20粒/秒）。
const GRAIN_WEIGHT = 1;
const TIP_THRESHOLD = 30; // 左右の重さの差がこれを超えると傾きすぎとみなす。
const TIP_GRACE_SECONDS = 1.1; // 傾きすぎた状態がこの秒数続くとこぼれる。
const HOLD_SECONDS = 1.0; // 目標範囲に収まった状態をこの秒数維持すると成功。
const BASE_POINTS = 120;
const COMBO_BONUS_PER_STEP = 40;
const MAX_TILT_ANGLE = Math.PI / 10;

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export class GrainScaleWorld {
  width = 0;
  height = 0;
  spoutX = 0;
  leftWeight = 0;
  rightWeight = 0;
  beamAngle = 0;
  target = 0;
  holdProgress = 0;
  tiltTimer = 0;
  score = 0;
  combo = 0;
  timeRemaining = ROUND_SECONDS;
  isOver = false;
  private difficulty = 1;
  private spawnTimer = 0;

  onGrainPoured: ((event: GrainPouredEvent) => void) | null = null;
  onRoundCompleted: ((event: RoundCompletedEvent) => void) | null = null;
  onSpill: ((event: SpillEvent) => void) | null = null;

  constructor(width: number, height: number) {
    this.resize(width, height);
    this.reset();
  }

  reset(): void {
    this.leftWeight = 0;
    this.rightWeight = 0;
    this.beamAngle = 0;
    this.holdProgress = 0;
    this.tiltTimer = 0;
    this.score = 0;
    this.combo = 0;
    this.timeRemaining = ROUND_SECONDS;
    this.isOver = false;
    this.difficulty = 1;
    this.spawnTimer = 0;
    this.spoutX = this.width / 2;
    this.target = this.generateTarget();
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const scaleX = this.width > 0 ? width / this.width : 1;
    if (this.width > 0) {
      this.spoutX *= scaleX;
    } else {
      this.spoutX = width / 2;
    }
    this.width = width;
    this.height = height;
    this.spoutX = Math.min(Math.max(this.spoutX, 0), this.width);
  }

  setSpoutX(x: number): void {
    this.spoutX = Math.min(Math.max(x, 0), this.width);
  }

  moveSpout(deltaX: number): void {
    this.setSpoutX(this.spoutX + deltaX);
  }

  leftPanRange(): readonly [number, number] {
    const left = this.width * 0.07;
    return [left, left + this.width * 0.3];
  }

  rightPanRange(): readonly [number, number] {
    const left = this.width * 0.63;
    return [left, left + this.width * 0.3];
  }

  panAt(x: number): PanSide | null {
    const [leftMin, leftMax] = this.leftPanRange();
    if (x >= leftMin && x <= leftMax) return "left";
    const [rightMin, rightMax] = this.rightPanRange();
    if (x >= rightMin && x <= rightMax) return "right";
    return null;
  }

  private generateTarget(): number {
    const base = 35 + Math.min(45, this.difficulty * 6);
    return Math.round(randRange(base - 5, base + 5));
  }

  private pourGrain(): void {
    const pan = this.panAt(this.spoutX);
    this.onGrainPoured?.({ x: this.spoutX, pan: pan ?? "gap" });
    if (pan === "left" && this.leftWeight < MAX_CAPACITY) {
      this.leftWeight = Math.min(MAX_CAPACITY, this.leftWeight + GRAIN_WEIGHT);
    } else if (pan === "right" && this.rightWeight < MAX_CAPACITY) {
      this.rightWeight = Math.min(MAX_CAPACITY, this.rightWeight + GRAIN_WEIGHT);
    }
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    this.timeRemaining = Math.max(0, this.timeRemaining - deltaSeconds);
    if (this.timeRemaining <= 0) {
      this.isOver = true;
      return;
    }

    this.spawnTimer += deltaSeconds;
    while (this.spawnTimer >= SPAWN_INTERVAL) {
      this.spawnTimer -= SPAWN_INTERVAL;
      this.pourGrain();
    }

    const diff = this.rightWeight - this.leftWeight;
    this.beamAngle = Math.max(
      -MAX_TILT_ANGLE,
      Math.min(MAX_TILT_ANGLE, (diff / MAX_CAPACITY) * MAX_TILT_ANGLE * 2),
    );

    if (Math.abs(diff) > TIP_THRESHOLD) {
      this.tiltTimer += deltaSeconds;
      if (this.tiltTimer >= TIP_GRACE_SECONDS) {
        this.spillPans();
      }
    } else {
      this.tiltTimer = 0;
    }

    const leftInRange = Math.abs(this.leftWeight - this.target) <= TARGET_TOLERANCE;
    const rightInRange = Math.abs(this.rightWeight - this.target) <= TARGET_TOLERANCE;

    if (leftInRange && rightInRange) {
      this.holdProgress += deltaSeconds;
      if (this.holdProgress >= HOLD_SECONDS) {
        this.completeRound();
      }
    } else {
      this.holdProgress = 0;
    }
  }

  private spillPans(): void {
    this.onSpill?.({ leftWeight: this.leftWeight, rightWeight: this.rightWeight });
    this.leftWeight = 0;
    this.rightWeight = 0;
    this.beamAngle = 0;
    this.tiltTimer = 0;
    this.holdProgress = 0;
    this.combo = 0;
  }

  private completeRound(): void {
    const points = BASE_POINTS + this.combo * COMBO_BONUS_PER_STEP;
    this.score += points;
    this.onRoundCompleted?.({ points, combo: this.combo, target: this.target });

    this.combo += 1;
    this.difficulty = Math.min(6, this.difficulty + 1);
    this.leftWeight = 0;
    this.rightWeight = 0;
    this.beamAngle = 0;
    this.holdProgress = 0;
    this.tiltTimer = 0;
    this.target = this.generateTarget();
  }
}
