import { getPanelRects, type PanelId, toAbsolute, toLocalIfInside } from "./gardenLayout.ts";
import {
  type DifferenceSpot,
  type GardenElement,
  type GardenScene,
  generateGardenScene,
} from "./gardenScene.ts";

export type GuessResult = "found" | "cleared" | "miss";

export interface DifferenceFoundEvent {
  spot: DifferenceSpot;
  points: number;
  panel: PanelId;
}

export const INITIAL_LIVES = 3;

const BASE_ROUND_SECONDS = 16;
const MIN_ROUND_SECONDS = 7;
const ROUND_SECONDS_STEP = 0.6;

const BASE_HIT_RADIUS_FRACTION = 0.11;
const MIN_HIT_RADIUS_FRACTION = 0.065;
const HIT_RADIUS_FRACTION_STEP = 0.0035;

const WRONG_GUESS_PENALTY_SECONDS = 1.5;
const BASE_FIND_POINTS = 120;
const TIME_BONUS_PER_SECOND = 6;
const ROUND_CLEAR_BONUS = 200;

export function roundSeconds(round: number): number {
  return Math.max(MIN_ROUND_SECONDS, BASE_ROUND_SECONDS - (round - 1) * ROUND_SECONDS_STEP);
}

export function hitRadiusFraction(round: number): number {
  return Math.max(
    MIN_HIT_RADIUS_FRACTION,
    BASE_HIT_RADIUS_FRACTION - (round - 1) * HIT_RADIUS_FRACTION_STEP,
  );
}

function findElementById(elements: GardenElement[], id: number): GardenElement | undefined {
  return elements.find((element) => element.id === id);
}

/**
 * 「見比べの庭」のゲーム状態そのもの。
 * 座標はすべてステージの絶対ピクセルで受け取り、パネルの矩形(gardenLayout)経由で
 * 要素の正規化座標と相互変換することで、横長/縦長どちらのレイアウトでも同じAPIで扱える。
 */
export class GardenWorld {
  width = 0;
  height = 0;
  round = 1;
  score = 0;
  lives = INITIAL_LIVES;
  isOver = false;
  timeRemaining = roundSeconds(1);
  scene: GardenScene = { elementsA: [], elementsB: [], differences: [] };
  selectorX = 0;
  selectorY = 0;

  onRoundStarted: (() => void) | null = null;
  onDifferenceFound: ((event: DifferenceFoundEvent) => void) | null = null;
  onWrongGuess: (() => void) | null = null;
  onRoundCleared: ((clearedRound: number) => void) | null = null;
  onRoundTimedOut: ((round: number) => void) | null = null;

  constructor(width: number, height: number) {
    this.resize(width, height);
    this.selectorX = this.width / 2;
    this.selectorY = this.height / 2;
    this.reset();
  }

  reset(): void {
    this.round = 1;
    this.score = 0;
    this.lives = INITIAL_LIVES;
    this.isOver = false;
    this.startRound();
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    if (this.width > 0 && this.height > 0) {
      this.selectorX *= width / this.width;
      this.selectorY *= height / this.height;
    }
    this.width = width;
    this.height = height;
  }

  get remainingDifferenceCount(): number {
    return this.scene.differences.filter((spot) => !spot.isFound).length;
  }

  get totalDifferenceCount(): number {
    return this.scene.differences.length;
  }

  private startRound(): void {
    this.scene = generateGardenScene(this.round);
    this.timeRemaining = roundSeconds(this.round);
    this.onRoundStarted?.();
  }

  moveSelectorBy(dx: number, dy: number): void {
    this.selectorX = Math.min(Math.max(this.selectorX + dx, 0), this.width);
    this.selectorY = Math.min(Math.max(this.selectorY + dy, 0), this.height);
  }

  setSelectorPosition(x: number, y: number): void {
    this.selectorX = Math.min(Math.max(x, 0), this.width);
    this.selectorY = Math.min(Math.max(y, 0), this.height);
  }

  guessAtSelector(): GuessResult {
    return this.guessAt(this.selectorX, this.selectorY);
  }

  guessAt(x: number, y: number): GuessResult {
    if (this.isOver) return "miss";

    const rects = getPanelRects(this.width, this.height);
    let panel: PanelId | null = null;
    let radiusPx = 0;

    if (toLocalIfInside(rects.a, x, y)) {
      panel = "a";
      radiusPx = hitRadiusFraction(this.round) * Math.min(rects.a.width, rects.a.height);
    } else if (toLocalIfInside(rects.b, x, y)) {
      panel = "b";
      radiusPx = hitRadiusFraction(this.round) * Math.min(rects.b.width, rects.b.height);
    }

    if (!panel) {
      this.applyWrongGuessPenalty();
      return "miss";
    }

    const panelRect = panel === "a" ? rects.a : rects.b;
    const panelElements = panel === "a" ? this.scene.elementsA : this.scene.elementsB;

    let closestSpot: DifferenceSpot | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (const spot of this.scene.differences) {
      if (spot.isFound) continue;
      const element = findElementById(panelElements, spot.elementId);
      if (!element) continue;
      const abs = toAbsolute(panelRect, element);
      const distance = Math.hypot(abs.x - x, abs.y - y);
      if (distance <= radiusPx && distance < closestDistance) {
        closestSpot = spot;
        closestDistance = distance;
      }
    }

    if (!closestSpot) {
      this.applyWrongGuessPenalty();
      return "miss";
    }

    const foundSpot = closestSpot;
    foundSpot.isFound = true;
    const original = findElementById(this.scene.elementsA, foundSpot.elementId);
    if (original) {
      const mutatedIndex = this.scene.elementsB.findIndex((e) => e.id === foundSpot.elementId);
      if (mutatedIndex >= 0) this.scene.elementsB[mutatedIndex] = { ...original };
    }

    const points = BASE_FIND_POINTS + Math.round(this.timeRemaining * TIME_BONUS_PER_SECOND);
    this.score += points;
    this.onDifferenceFound?.({ spot: foundSpot, points, panel });

    if (this.scene.differences.every((spot) => spot.isFound)) {
      this.score += ROUND_CLEAR_BONUS;
      const clearedRound = this.round;
      this.round += 1;
      this.onRoundCleared?.(clearedRound);
      this.startRound();
      return "cleared";
    }

    return "found";
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    this.timeRemaining = Math.max(0, this.timeRemaining - deltaSeconds);
    if (this.timeRemaining <= 0) {
      const timedOutRound = this.round;
      this.lives -= 1;
      this.onRoundTimedOut?.(timedOutRound);
      if (this.lives <= 0) {
        this.isOver = true;
      } else {
        this.startRound();
      }
    }
  }

  private applyWrongGuessPenalty(): void {
    this.timeRemaining = Math.max(0, this.timeRemaining - WRONG_GUESS_PENALTY_SECONDS);
    this.onWrongGuess?.();
  }
}
