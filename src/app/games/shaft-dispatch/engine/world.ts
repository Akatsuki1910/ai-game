export const FLOOR_COUNT = 6;
export const CAR_CAPACITY = 4;
export const ROUND_SECONDS = 90;

const CAR_SPEED = 3; // フロア/秒
export const DWELL_SECONDS = 0.8; // 扉が開いている時間
export const PATIENCE_MAX = 16; // 待てる秒数
const SPAWN_MIN_SECONDS = 1.4;
const SPAWN_MAX_SECONDS = 2.6;
const MAX_DIFFICULTY = 2.2;
const DIFFICULTY_STEP = 0.05;
const BASE_POINTS = 60;
const PATIENCE_BONUS_MAX = 40;
const MISS_PENALTY = 25;
const ARRIVAL_EPSILON = 1e-3;

export interface WaitingPassenger {
  id: number;
  destinationFloor: number;
  patience: number;
}

export interface OnboardPassenger {
  id: number;
  destinationFloor: number;
  /** 乗車した瞬間の残り忍耐割合（0〜1）。降車ボーナスの算出に使う。 */
  boardedPatienceFraction: number;
}

export interface DeliveredEvent {
  floor: number;
  points: number;
}

export interface MissedEvent {
  floor: number;
}

let nextPassengerId = 1;

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomFloorExcept(exclude: number): number {
  let floor = Math.floor(Math.random() * FLOOR_COUNT);
  while (floor === exclude) {
    floor = Math.floor(Math.random() * FLOOR_COUNT);
  }
  return floor;
}

/**
 * 1台のエレベーターで複数階からの呼び出しを捌くディスパッチシミュレーター。
 * 座標やピクセルサイズを一切持たず、フロア番号と時間だけで状態を表す
 * （描画側がこの値を好きな画面サイズへマッピングする）。
 */
export class ShaftDispatchWorld {
  score = 0;
  deliveredCount = 0;
  missedCount = 0;
  timeRemaining = ROUND_SECONDS;
  isOver = false;

  carFloor = FLOOR_COUNT - 1;
  targetFloor: number | null = null;
  isDoorOpen = false;
  doorTimer = 0;

  onboard: OnboardPassenger[] = [];
  waitingByFloor: WaitingPassenger[][] = [];

  private difficulty = 1;
  private spawnTimer = 0;
  private nextSpawnInterval = 0;

  onDelivered: ((event: DeliveredEvent) => void) | null = null;
  onMissed: ((event: MissedEvent) => void) | null = null;

  constructor() {
    this.waitingByFloor = Array.from({ length: FLOOR_COUNT }, () => []);
    this.reset();
  }

  reset(): void {
    this.score = 0;
    this.deliveredCount = 0;
    this.missedCount = 0;
    this.timeRemaining = ROUND_SECONDS;
    this.isOver = false;

    this.carFloor = FLOOR_COUNT - 1;
    this.targetFloor = null;
    this.isDoorOpen = false;
    this.doorTimer = 0;

    this.onboard = [];
    this.waitingByFloor = Array.from({ length: FLOOR_COUNT }, () => []);

    this.difficulty = 1;
    this.spawnTimer = 0;
    this.nextSpawnInterval = randRange(SPAWN_MIN_SECONDS, SPAWN_MAX_SECONDS);

    // 1Fに最初の乗客を必ず置き、起動直後から行き先が分かる状態にする。
    this.waitingByFloor[0].push({
      id: nextPassengerId++,
      destinationFloor: randomFloorExcept(0),
      patience: PATIENCE_MAX,
    });
  }

  /** 指定階へ車を呼ぶ。扉が開いている間は到着済みの処理が終わるまで呼べない。 */
  requestCar(floor: number): void {
    if (this.isOver) return;
    if (floor < 0 || floor >= FLOOR_COUNT) return;
    if (this.isDoorOpen) return;

    if (Math.abs(this.carFloor - floor) < ARRIVAL_EPSILON) {
      this.carFloor = floor;
      this.openDoors(floor);
      return;
    }
    this.targetFloor = floor;
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    this.timeRemaining = Math.max(0, this.timeRemaining - deltaSeconds);
    if (this.timeRemaining <= 0) {
      this.isOver = true;
      return;
    }

    this.updateSpawns(deltaSeconds);
    this.updatePatience(deltaSeconds);
    this.updateCar(deltaSeconds);
  }

  private updateSpawns(deltaSeconds: number): void {
    this.spawnTimer += deltaSeconds;
    while (this.spawnTimer >= this.nextSpawnInterval) {
      this.spawnTimer -= this.nextSpawnInterval;
      this.spawnPassenger();
      this.difficulty = Math.min(MAX_DIFFICULTY, this.difficulty + DIFFICULTY_STEP);
      this.nextSpawnInterval = randRange(SPAWN_MIN_SECONDS, SPAWN_MAX_SECONDS) / this.difficulty;
    }
  }

  private spawnPassenger(): void {
    const originFloor = Math.floor(Math.random() * FLOOR_COUNT);
    this.waitingByFloor[originFloor].push({
      id: nextPassengerId++,
      destinationFloor: randomFloorExcept(originFloor),
      patience: PATIENCE_MAX,
    });
  }

  private updatePatience(deltaSeconds: number): void {
    for (let floor = 0; floor < this.waitingByFloor.length; floor++) {
      const queue = this.waitingByFloor[floor];
      for (let i = queue.length - 1; i >= 0; i--) {
        const passenger = queue[i];
        passenger.patience -= deltaSeconds;
        if (passenger.patience <= 0) {
          queue.splice(i, 1);
          this.missedCount++;
          this.score = Math.max(0, this.score - MISS_PENALTY);
          this.onMissed?.({ floor });
        }
      }
    }
  }

  private updateCar(deltaSeconds: number): void {
    if (this.isDoorOpen) {
      this.doorTimer -= deltaSeconds;
      if (this.doorTimer <= 0) {
        this.doorTimer = 0;
        this.isDoorOpen = false;
      }
      return;
    }

    if (this.targetFloor === null) return;

    const direction = Math.sign(this.targetFloor - this.carFloor);
    if (direction === 0) {
      const arrivedFloor = this.targetFloor;
      this.carFloor = arrivedFloor;
      this.targetFloor = null;
      this.openDoors(arrivedFloor);
      return;
    }

    this.carFloor += direction * CAR_SPEED * deltaSeconds;
    const overshot =
      (direction > 0 && this.carFloor >= this.targetFloor) ||
      (direction < 0 && this.carFloor <= this.targetFloor);
    if (overshot) {
      const arrivedFloor = this.targetFloor;
      this.carFloor = arrivedFloor;
      this.targetFloor = null;
      this.openDoors(arrivedFloor);
    }
  }

  private openDoors(floor: number): void {
    this.isDoorOpen = true;
    this.doorTimer = DWELL_SECONDS;

    for (let i = this.onboard.length - 1; i >= 0; i--) {
      const passenger = this.onboard[i];
      if (passenger.destinationFloor !== floor) continue;
      this.onboard.splice(i, 1);
      const bonus = Math.round(PATIENCE_BONUS_MAX * passenger.boardedPatienceFraction);
      const points = BASE_POINTS + bonus;
      this.score += points;
      this.deliveredCount++;
      this.onDelivered?.({ floor, points });
    }

    const queue = this.waitingByFloor[floor];
    while (this.onboard.length < CAR_CAPACITY && queue.length > 0) {
      const passenger = queue.shift();
      if (!passenger) break;
      this.onboard.push({
        id: passenger.id,
        destinationFloor: passenger.destinationFloor,
        boardedPatienceFraction: passenger.patience / PATIENCE_MAX,
      });
    }
  }
}
