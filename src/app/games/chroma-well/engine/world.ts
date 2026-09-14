export interface RGB {
  r: number;
  g: number;
  b: number;
}

export type PigmentIndex = 0 | 1 | 2;

export interface Blob {
  id: number;
  x: number;
  y: number;
  r: number;
  isGrowing: boolean;
  pigmentIndex: PigmentIndex;
}

export interface MatchSucceededEvent {
  target: RGB;
  points: number;
  streak: number;
}

/** 3原色のピグメント。混色はこの3色の凸結合（加重平均）としてのみ表現できる。 */
export const PIGMENTS: readonly RGB[] = [
  { r: 235, g: 64, b: 64 },
  { r: 72, g: 214, b: 120 },
  { r: 86, g: 140, b: 240 },
];

export const ROUND_SECONDS = 90;

const BASE_BLOB_RADIUS = 34;
const GROW_SPEED = BASE_BLOB_RADIUS / 0.25; // px/秒。約0.25秒でフルサイズに育つ
const BASE_EVAPORATE_RATE = 6; // px/秒
const MAX_EVAPORATE_RATE = 16;
const MAX_BLOBS = 70;
const REINFORCE_DISTANCE = BASE_BLOB_RADIUS * 0.65;
const HOLD_TO_MATCH_SECONDS = 0.6;
const BASE_TOLERANCE = 46;
const MIN_TOLERANCE = 20;
const TOLERANCE_STEP = 2;
const EVAPORATE_STEP = 0.5;
const SPEED_BONUS_WINDOW_SECONDS = 8;
const SPEED_BONUS_PER_SECOND = 20;
const BASE_MATCH_POINTS = 100;
const STREAK_BONUS_PER_STEP = 10;

let nextId = 1;

function clampChannel(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

export function rgbToHex(color: RGB): number {
  return (clampChannel(color.r) << 16) | (clampChannel(color.g) << 8) | clampChannel(color.b);
}

export function rgbToCssColor(color: RGB): string {
  return `rgb(${clampChannel(color.r)}, ${clampChannel(color.g)}, ${clampChannel(color.b)})`;
}

export function colorDistance(a: RGB, b: RGB): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

/** 3原色の凸結合（重み合計1のランダムな加重平均）で「必ず混色で作れる色」を作る。 */
export function randomAchievableColor(): RGB {
  const w0 = Math.random();
  const w1 = Math.random() * (1 - w0);
  const w2 = 1 - w0 - w1;
  const weights = [w0, w1, w2];
  return weights.reduce<RGB>(
    (acc, weight, index) => {
      const pigment = PIGMENTS[index];
      return {
        r: acc.r + pigment.r * weight,
        g: acc.g + pigment.g * weight,
        b: acc.b + pigment.b * weight,
      };
    },
    { r: 0, g: 0, b: 0 },
  );
}

/** 井戸に盛られたインクの総合色。面積（半径の2乗）で加重平均する。 */
export function mixColor(blobs: readonly Blob[]): RGB | null {
  let totalWeight = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  for (const blob of blobs) {
    const weight = blob.r * blob.r;
    if (weight <= 0) continue;
    const pigment = PIGMENTS[blob.pigmentIndex];
    totalWeight += weight;
    r += pigment.r * weight;
    g += pigment.g * weight;
    b += pigment.b * weight;
  }
  if (totalWeight <= 0) return null;
  return { r: r / totalWeight, g: g / totalWeight, b: b / totalWeight };
}

export class ChromaWellWorld {
  width = 0;
  height = 0;
  blobs: Blob[] = [];
  score = 0;
  timeRemaining = ROUND_SECONDS;
  isOver = false;
  target: RGB = PIGMENTS[0];
  currentColor: RGB | null = null;
  /** お題に近い色を維持できている割合（0〜1）。1に達すると成立する。 */
  matchProgress = 0;
  tolerance = BASE_TOLERANCE;
  streak = 0;

  onMatchSucceeded: ((event: MatchSucceededEvent) => void) | null = null;

  private targetElapsedSeconds = 0;
  private evaporateRate = BASE_EVAPORATE_RATE;

  constructor(width: number, height: number) {
    this.resize(width, height);
    this.reset();
  }

  reset(): void {
    this.blobs = [];
    this.score = 0;
    this.timeRemaining = ROUND_SECONDS;
    this.isOver = false;
    this.tolerance = BASE_TOLERANCE;
    this.evaporateRate = BASE_EVAPORATE_RATE;
    this.streak = 0;
    this.matchProgress = 0;
    this.targetElapsedSeconds = 0;
    this.currentColor = null;
    this.target = randomAchievableColor();
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const scaleX = this.width > 0 ? width / this.width : 1;
    const scaleY = this.height > 0 ? height / this.height : 1;
    if (this.width > 0 && this.height > 0) {
      for (const blob of this.blobs) {
        blob.x = Math.min(Math.max(blob.x * scaleX, 0), width);
        blob.y = Math.min(Math.max(blob.y * scaleY, 0), height);
      }
    }
    this.width = width;
    this.height = height;
  }

  /** 指定位置に選択中のピグメントを盛る。近くに同色の滴があれば育て直し、なければ新しく作る。 */
  applyPigment(x: number, y: number, pigmentIndex: PigmentIndex): void {
    if (this.isOver) return;
    const clampedX = Math.min(Math.max(x, 0), this.width);
    const clampedY = Math.min(Math.max(y, 0), this.height);

    const nearby = this.blobs.find(
      (blob) =>
        blob.pigmentIndex === pigmentIndex &&
        Math.hypot(blob.x - clampedX, blob.y - clampedY) <= REINFORCE_DISTANCE,
    );
    if (nearby) {
      nearby.isGrowing = true;
      nearby.x = clampedX;
      nearby.y = clampedY;
      return;
    }

    if (this.blobs.length >= MAX_BLOBS) {
      let smallestIndex = 0;
      for (let i = 1; i < this.blobs.length; i++) {
        if (this.blobs[i].r < this.blobs[smallestIndex].r) smallestIndex = i;
      }
      this.blobs.splice(smallestIndex, 1);
    }

    this.blobs.push({
      id: nextId++,
      x: clampedX,
      y: clampedY,
      r: 1,
      isGrowing: true,
      pigmentIndex,
    });
  }

  findBlobAt(x: number, y: number): Blob | undefined {
    return this.blobs.find((blob) => Math.hypot(blob.x - x, blob.y - y) <= blob.r);
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    this.timeRemaining = Math.max(0, this.timeRemaining - deltaSeconds);
    if (this.timeRemaining <= 0) {
      this.isOver = true;
      return;
    }

    for (let i = this.blobs.length - 1; i >= 0; i--) {
      const blob = this.blobs[i];
      if (blob.isGrowing) {
        blob.r = Math.min(BASE_BLOB_RADIUS, blob.r + GROW_SPEED * deltaSeconds);
        if (blob.r >= BASE_BLOB_RADIUS) blob.isGrowing = false;
      } else {
        blob.r = Math.max(0, blob.r - this.evaporateRate * deltaSeconds);
        if (blob.r <= 0) this.blobs.splice(i, 1);
      }
    }

    this.currentColor = mixColor(this.blobs);
    this.targetElapsedSeconds += deltaSeconds;

    const isWithinTolerance =
      this.currentColor !== null && colorDistance(this.currentColor, this.target) <= this.tolerance;

    if (isWithinTolerance) {
      this.matchProgress = Math.min(1, this.matchProgress + deltaSeconds / HOLD_TO_MATCH_SECONDS);
      if (this.matchProgress >= 1) this.completeMatch();
    } else {
      this.matchProgress = Math.max(0, this.matchProgress - deltaSeconds / HOLD_TO_MATCH_SECONDS);
    }
  }

  private completeMatch(): void {
    this.streak += 1;
    const speedBonusSeconds = Math.max(0, SPEED_BONUS_WINDOW_SECONDS - this.targetElapsedSeconds);
    const points = Math.round(
      BASE_MATCH_POINTS +
        speedBonusSeconds * SPEED_BONUS_PER_SECOND +
        this.streak * STREAK_BONUS_PER_STEP,
    );
    this.score += points;
    this.onMatchSucceeded?.({ target: this.target, points, streak: this.streak });

    this.tolerance = Math.max(MIN_TOLERANCE, this.tolerance - TOLERANCE_STEP);
    this.evaporateRate = Math.min(MAX_EVAPORATE_RATE, this.evaporateRate + EVAPORATE_STEP);
    this.target = randomAchievableColor();
    this.matchProgress = 0;
    this.targetElapsedSeconds = 0;
  }
}
