export type StoneOwner = "player" | "guard";

export interface Stone {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: 1 | -1;
  owner: StoneOwner;
  isMoving: boolean;
  /** 一度でも衝突した石はホグライン未達でもバーン(除去)されない。 */
  hasBeenHit: boolean;
}

export type StoneBurnReason = "hogline" | "boundary";

export interface StoneBurnedEvent {
  stone: Stone;
  reason: StoneBurnReason;
}

export interface EndCompleteEvent {
  /** 0始まりのエンド番号。 */
  endIndex: number;
  points: number;
  totalScore: number;
}

export const TOTAL_ENDS = 5;
export const STONES_PER_END = 2;
const MAX_GUARDS = 4;
const END_TRANSITION_SECONDS = 1.4;

const CURL_RATE = 0.18; // rad/秒。石の速度ベクトルを少しずつ曲げる。
const SWEEP_FRICTION_MULT = 0.55;
const SWEEP_CURL_MULT = 0.4;
const STONE_RESTITUTION = 0.82;

const PREVIEW_STEPS = 140;
const PREVIEW_DT = 1 / 60;

let nextStoneId = 1;

export class FrostCurlWorld {
  width = 0;
  height = 0;
  stones: Stone[] = [];
  score = 0;
  endIndex = 0;
  isOver = false;
  isSweeping = false;

  houseX = 0;
  houseY = 0;
  houseOuterRadius = 0;
  houseMidRadius = 0;
  houseInnerRadius = 0;
  houseButtonRadius = 0;
  hackX = 0;
  hackY = 0;
  hogLineY = 0;
  topBoundaryY = 0;
  sidelineLeft = 0;
  sidelineRight = 0;
  stoneRadius = 0;
  maxDrag = 0;
  maxSpeed = 0;

  private baseFriction = 0;
  private stopSpeed = 0;
  private thrownCount = 0;
  private endTransition: number | null = null;

  onStoneBurned: ((event: StoneBurnedEvent) => void) | null = null;
  onEndComplete: ((event: EndCompleteEvent) => void) | null = null;

  constructor(width: number, height: number) {
    this.resize(width, height);
    this.reset();
  }

  get totalEnds(): number {
    return TOTAL_ENDS;
  }

  get stonesPerEnd(): number {
    return STONES_PER_END;
  }

  get stonesThrownThisEnd(): number {
    return this.thrownCount;
  }

  get isEndTransitioning(): boolean {
    return this.endTransition !== null;
  }

  get isReadyToThrow(): boolean {
    return (
      !this.isOver &&
      this.endTransition === null &&
      this.thrownCount < STONES_PER_END &&
      this.stones.every((stone) => !stone.isMoving)
    );
  }

  reset(): void {
    this.score = 0;
    this.endIndex = 0;
    this.isOver = false;
    this.startEnd();
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const hasPrevSize = this.width > 0 && this.height > 0;
    const scaleX = hasPrevSize ? width / this.width : 1;
    const scaleY = hasPrevSize ? height / this.height : 1;

    this.width = width;
    this.height = height;
    this.applyGeometry();

    if (hasPrevSize && (scaleX !== 1 || scaleY !== 1)) {
      for (const stone of this.stones) {
        stone.x *= scaleX;
        stone.y *= scaleY;
      }
    }
  }

  /** ドラッグ量やキー入力から求めた発射速度で、摩擦とカールだけを反映した予測軌道を計算する(当たり判定なし)。 */
  previewTrajectory(vx: number, vy: number, spin: 1 | -1): { x: number; y: number }[] {
    const points: { x: number; y: number }[] = [];
    let x = this.hackX;
    let y = this.hackY;
    let cvx = vx;
    let cvy = vy;

    for (let i = 0; i < PREVIEW_STEPS; i++) {
      const speed = Math.hypot(cvx, cvy);
      if (speed <= this.stopSpeed) break;
      const nextSpeed = Math.max(0, speed - this.baseFriction * PREVIEW_DT);
      const angle = Math.atan2(cvy, cvx) + CURL_RATE * spin * PREVIEW_DT;
      cvx = Math.cos(angle) * nextSpeed;
      cvy = Math.sin(angle) * nextSpeed;
      x += cvx * PREVIEW_DT;
      y += cvy * PREVIEW_DT;
      points.push({ x, y });
      if (x < this.sidelineLeft - 40 || x > this.sidelineRight + 40 || y < this.topBoundaryY - 40) {
        break;
      }
    }
    return points;
  }

  launch(vx: number, vy: number, spin: 1 | -1): void {
    if (!this.isReadyToThrow) return;
    this.stones.push({
      id: nextStoneId++,
      x: this.hackX,
      y: this.hackY,
      vx,
      vy,
      spin,
      owner: "player",
      isMoving: true,
      hasBeenHit: false,
    });
    this.thrownCount += 1;
  }

  setSweeping(isActive: boolean): void {
    this.isSweeping = isActive;
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    for (const stone of this.stones) {
      if (stone.isMoving) this.integrateStone(stone, deltaSeconds);
    }

    this.resolveCollisions();
    this.filterStones();

    if (
      this.endTransition === null &&
      this.thrownCount >= STONES_PER_END &&
      this.stones.every((stone) => !stone.isMoving)
    ) {
      this.endTransition = END_TRANSITION_SECONDS;
    }

    if (this.endTransition !== null) {
      this.endTransition -= deltaSeconds;
      if (this.endTransition <= 0) {
        this.endTransition = null;
        this.finishEnd();
      }
    }
  }

  private applyGeometry(): void {
    const minDim = Math.min(this.width, this.height);
    const centerX = this.width / 2;
    const centerY = this.height / 2;
    const sheetLength = minDim * 1.05;

    this.stoneRadius = minDim * 0.028;
    this.houseX = centerX;
    this.houseY = centerY - sheetLength * 0.34;
    this.hackX = centerX;
    this.hackY = centerY + sheetLength * 0.4;
    this.hogLineY = centerY + sheetLength * 0.02;
    this.topBoundaryY = this.houseY - minDim * 0.22;
    this.sidelineLeft = centerX - minDim * 0.3;
    this.sidelineRight = centerX + minDim * 0.3;
    this.houseOuterRadius = minDim * 0.16;
    this.houseMidRadius = minDim * 0.105;
    this.houseInnerRadius = minDim * 0.055;
    this.houseButtonRadius = minDim * 0.022;
    this.maxDrag = minDim * 0.32;
    this.maxSpeed = minDim * 0.95;
    this.baseFriction = minDim * 0.34;
    this.stopSpeed = minDim * 0.045;
  }

  private startEnd(): void {
    this.stones = [];
    this.thrownCount = 0;
    this.endTransition = null;
    this.isSweeping = false;
    this.placeGuards();
  }

  private placeGuards(): void {
    const guardCount = Math.min(this.endIndex, MAX_GUARDS);
    const minDim = Math.min(this.width, this.height);
    for (let i = 0; i < guardCount; i++) {
      const side: 1 | -1 = i % 2 === 0 ? 1 : -1;
      const lateral = minDim * (0.09 + 0.05 * Math.floor(i / 2));
      const forward = minDim * (0.06 + 0.065 * i);
      this.stones.push({
        id: nextStoneId++,
        x: this.houseX + side * lateral,
        y: this.houseY + forward,
        vx: 0,
        vy: 0,
        spin: side,
        owner: "guard",
        isMoving: false,
        hasBeenHit: false,
      });
    }
  }

  private finishEnd(): void {
    const points = this.computeHouseScore();
    this.score += points;
    this.onEndComplete?.({ endIndex: this.endIndex, points, totalScore: this.score });
    if (this.endIndex + 1 >= TOTAL_ENDS) {
      this.isOver = true;
    } else {
      this.endIndex += 1;
      this.startEnd();
    }
  }

  private computeHouseScore(): number {
    return this.stones
      .filter((stone) => stone.owner === "player")
      .reduce((sum, stone) => sum + this.ringPoints(stone), 0);
  }

  private ringPoints(stone: Stone): number {
    const dist = Math.hypot(stone.x - this.houseX, stone.y - this.houseY);
    if (dist <= this.houseButtonRadius) return 6;
    if (dist <= this.houseInnerRadius) return 4;
    if (dist <= this.houseMidRadius) return 2;
    if (dist <= this.houseOuterRadius) return 1;
    return 0;
  }

  private integrateStone(stone: Stone, deltaSeconds: number): void {
    const speed = Math.hypot(stone.vx, stone.vy);
    if (speed <= this.stopSpeed) {
      stone.vx = 0;
      stone.vy = 0;
      stone.isMoving = false;
      return;
    }

    const frictionAccel = this.baseFriction * (this.isSweeping ? SWEEP_FRICTION_MULT : 1);
    const nextSpeed = Math.max(0, speed - frictionAccel * deltaSeconds);
    const curlRate = CURL_RATE * stone.spin * (this.isSweeping ? SWEEP_CURL_MULT : 1);
    const angle = Math.atan2(stone.vy, stone.vx) + curlRate * deltaSeconds;
    stone.vx = Math.cos(angle) * nextSpeed;
    stone.vy = Math.sin(angle) * nextSpeed;
    stone.x += stone.vx * deltaSeconds;
    stone.y += stone.vy * deltaSeconds;

    if (nextSpeed <= this.stopSpeed) {
      stone.vx = 0;
      stone.vy = 0;
      stone.isMoving = false;
    }
  }

  private resolveCollisions(): void {
    const minDist = this.stoneRadius * 2;
    for (let i = 0; i < this.stones.length; i++) {
      for (let j = i + 1; j < this.stones.length; j++) {
        const a = this.stones[i];
        const b = this.stones[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= 0 || dist >= minDist) continue;

        const nx = dx / dist;
        const ny = dy / dist;
        const overlap = minDist - dist;
        a.x -= (nx * overlap) / 2;
        a.y -= (ny * overlap) / 2;
        b.x += (nx * overlap) / 2;
        b.y += (ny * overlap) / 2;

        const rvx = b.vx - a.vx;
        const rvy = b.vy - a.vy;
        const velAlongNormal = rvx * nx + rvy * ny;
        if (velAlongNormal >= 0) continue;

        const impulse = -((1 + STONE_RESTITUTION) * velAlongNormal) / 2;
        a.vx -= impulse * nx;
        a.vy -= impulse * ny;
        b.vx += impulse * nx;
        b.vy += impulse * ny;
        a.isMoving = true;
        b.isMoving = true;
        a.hasBeenHit = true;
        b.hasBeenHit = true;
      }
    }
  }

  private filterStones(): void {
    const survivors: Stone[] = [];
    for (const stone of this.stones) {
      if (
        stone.x < this.sidelineLeft - this.stoneRadius ||
        stone.x > this.sidelineRight + this.stoneRadius
      ) {
        this.onStoneBurned?.({ stone, reason: "boundary" });
        continue;
      }
      if (stone.y < this.topBoundaryY) {
        this.onStoneBurned?.({ stone, reason: "boundary" });
        continue;
      }
      if (
        !stone.isMoving &&
        stone.owner === "player" &&
        !stone.hasBeenHit &&
        stone.y > this.hogLineY
      ) {
        this.onStoneBurned?.({ stone, reason: "hogline" });
        continue;
      }
      survivors.push(stone);
    }
    this.stones = survivors;
  }
}
