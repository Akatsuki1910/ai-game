export interface Fish {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  /** 池の中での定位置(0〜1の比率)。リサイズ時にこの比率から実座標を再計算する。 */
  homeXRatio: number;
  homeYRatio: number;
  /** ゆらゆら泳ぐ動きの位相。個体ごとにずらして全員が同じ動きにならないようにする。 */
  phase: number;
}

export interface Poi {
  x: number;
  y: number;
  radius: number;
  durability: number;
  isDipped: boolean;
}

export interface CatchEvent {
  score: number;
}

export interface BreakEvent {
  score: number;
}

const FISH_RADIUS = 14;
const POI_RADIUS = 34;
export const START_DURABILITY = 100;
export const FISH_COUNT = 6;
export const CATCH_TIME = 0.5; // 秒。網を重ねたまま静止させ続ける必要がある時間。

const HOME_RADIUS_RATIO = 0.3; // 池の中心からの定位置の距離(幅/高さに対する比率)。
const BOB_AMPLITUDE = 18; // px。定位置を中心にゆらゆら泳ぐ範囲。
const BOB_FREQ_X = 0.8; // rad/s
const BOB_FREQ_Y = 1.1; // rad/s
const BASE_SOAK_RATE = 5; // durability/s。浸けているだけで進む紙の傷み。
const DRAG_SOAK_RATE = 0.04; // durability/(px/s)。浸けたまま動かす速さに応じて追加で傷む。
const CATCH_COST = 6; // durability。1匹すくうたびに消費する紙の傷み。
const MAX_CATCH_SPEED = 170; // px/s。これより速く網を動かしていると金魚に逃げられてすくえない。
const MAX_POI_TRACK_SPEED = 2600; // px/s。瞬間移動(リサイズ等)を傷みや失敗判定に使わない上限。

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export class KingyoScoopWorld {
  width = 0;
  height = 0;
  poi: Poi;
  fish: Fish[];
  score = 0;
  isOver = false;
  elapsedSeconds = 0;
  catchProgress = 0;

  onCatch: ((event: CatchEvent) => void) | null = null;
  onBreak: ((event: BreakEvent) => void) | null = null;

  private previousPoiX = 0;
  private previousPoiY = 0;
  private targetFishIndex: number | null = null;

  constructor(width: number, height: number) {
    this.poi = { x: 0, y: 0, radius: POI_RADIUS, durability: START_DURABILITY, isDipped: false };
    this.fish = [];
    this.resize(width, height);
    this.reset();
  }

  reset(): void {
    this.score = 0;
    this.isOver = false;
    this.elapsedSeconds = 0;
    this.catchProgress = 0;
    this.targetFishIndex = null;
    this.poi = {
      x: this.width / 2,
      y: this.height / 2,
      radius: POI_RADIUS,
      durability: START_DURABILITY,
      isDipped: false,
    };
    this.previousPoiX = this.poi.x;
    this.previousPoiY = this.poi.y;
    this.fish = Array.from({ length: FISH_COUNT }, (_, index) => this.spawnFish(index));
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const scaleX = this.width > 0 ? width / this.width : 1;
    const scaleY = this.height > 0 ? height / this.height : 1;
    if (this.width > 0 && this.height > 0) {
      this.poi.x *= scaleX;
      this.poi.y *= scaleY;
    }
    this.width = width;
    this.height = height;
    this.poi.x = clamp(this.poi.x, this.poi.radius, this.width - this.poi.radius);
    this.poi.y = clamp(this.poi.y, this.poi.radius, this.height - this.poi.radius);
    for (const fish of this.fish) {
      this.placeFishAtHome(fish);
    }
  }

  setPoiPosition(x: number, y: number): void {
    this.poi.x = clamp(x, this.poi.radius, this.width - this.poi.radius);
    this.poi.y = clamp(y, this.poi.radius, this.height - this.poi.radius);
  }

  movePoiBy(dx: number, dy: number): void {
    this.setPoiPosition(this.poi.x + dx, this.poi.y + dy);
  }

  setDipped(isDipped: boolean): void {
    this.poi.isDipped = isDipped;
  }

  private spawnFish(index: number): Fish {
    const angle = (index / FISH_COUNT) * Math.PI * 2;
    const fish: Fish = {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      radius: FISH_RADIUS,
      homeXRatio: 0.5 + Math.cos(angle) * HOME_RADIUS_RATIO,
      homeYRatio: 0.5 + Math.sin(angle) * HOME_RADIUS_RATIO,
      phase: (index / FISH_COUNT) * Math.PI * 2,
    };
    this.placeFishAtHome(fish, this.elapsedSeconds);
    return fish;
  }

  /** 定位置(ratio)と現在時刻から、ゆらゆら揺れている現在の座標を計算して反映する。 */
  private placeFishAtHome(fish: Fish, elapsedSeconds = this.elapsedSeconds): void {
    const homeX = this.width * fish.homeXRatio;
    const homeY = this.height * fish.homeYRatio;
    const bobXAngle = elapsedSeconds * BOB_FREQ_X + fish.phase;
    const bobYAngle = elapsedSeconds * BOB_FREQ_Y + fish.phase * 1.7;

    fish.vx = Math.cos(bobXAngle) * BOB_AMPLITUDE * BOB_FREQ_X;
    fish.vy = -Math.sin(bobYAngle) * BOB_AMPLITUDE * BOB_FREQ_Y;
    fish.x = clamp(
      homeX + Math.sin(bobXAngle) * BOB_AMPLITUDE,
      fish.radius,
      this.width - fish.radius,
    );
    fish.y = clamp(
      homeY + Math.cos(bobYAngle) * BOB_AMPLITUDE,
      fish.radius,
      this.height - fish.radius,
    );
  }

  step(deltaSeconds: number): void {
    if (this.isOver || deltaSeconds <= 0) return;
    this.elapsedSeconds += deltaSeconds;

    const poiSpeed = clamp(
      Math.hypot(this.poi.x - this.previousPoiX, this.poi.y - this.previousPoiY) / deltaSeconds,
      0,
      MAX_POI_TRACK_SPEED,
    );
    this.previousPoiX = this.poi.x;
    this.previousPoiY = this.poi.y;

    for (const fish of this.fish) this.placeFishAtHome(fish);

    if (this.poi.isDipped) {
      const soak = (BASE_SOAK_RATE + DRAG_SOAK_RATE * poiSpeed) * deltaSeconds;
      this.poi.durability = clamp(this.poi.durability - soak, 0, START_DURABILITY);
      if (this.poi.durability <= 0) {
        this.poi.durability = 0;
        this.isOver = true;
        this.onBreak?.({ score: this.score });
        return;
      }
    }

    this.updateCatchProgress(poiSpeed, deltaSeconds);
  }

  private updateCatchProgress(poiSpeed: number, deltaSeconds: number): void {
    const canAttemptCatch = this.poi.isDipped && poiSpeed <= MAX_CATCH_SPEED;
    const nearestIndex = canAttemptCatch ? this.findOverlappingFishIndex() : null;

    if (nearestIndex === null || nearestIndex !== this.targetFishIndex) {
      this.targetFishIndex = nearestIndex;
      this.catchProgress = nearestIndex === null ? 0 : deltaSeconds;
      return;
    }

    this.catchProgress += deltaSeconds;
    if (this.catchProgress < CATCH_TIME) return;

    this.catchFish(nearestIndex);
  }

  private findOverlappingFishIndex(): number | null {
    let closestIndex: number | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.fish.length; i++) {
      const fish = this.fish[i];
      const distance = Math.hypot(fish.x - this.poi.x, fish.y - this.poi.y);
      if (distance <= this.poi.radius + fish.radius && distance < closestDistance) {
        closestDistance = distance;
        closestIndex = i;
      }
    }
    return closestIndex;
  }

  private catchFish(index: number): void {
    this.fish[index] = this.spawnFish(index);
    this.score += 1;
    this.catchProgress = 0;
    this.targetFishIndex = null;
    this.poi.durability = clamp(this.poi.durability - CATCH_COST, 0, START_DURABILITY);
    this.onCatch?.({ score: this.score });
    if (this.poi.durability <= 0) {
      this.isOver = true;
      this.onBreak?.({ score: this.score });
    }
  }
}
