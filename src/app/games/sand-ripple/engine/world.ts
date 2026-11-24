export const GRID_COLS = 32;
export const GRID_ROWS = 20;
export const ROUND_SECONDS = 75;

export const RAKE_RADIUS_RATIO = 0.055;
export const RING_BAND_RATIO = 0.045;

const DECAY_PER_SECOND = 0.045;
const RING_BONUS_MULTIPLIER = 2.2;
const SCORE_PER_WEIGHTED_CELL_PER_SECOND = 2;
const ROCK_COUNT = 4;
const ROCK_MIN_GAP = 0.06;
export const RAKED_THRESHOLD = 0.55;

export interface Rock {
  readonly nx: number;
  readonly ny: number;
  readonly nRadius: number;
}

export interface PixelCircle {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * 枯山水の砂を掃いて模様を描くリアルタイム・パズル。
 *
 * グリッドは画面サイズに依存しない正規化座標（0〜1）で管理するため、
 * ウィンドウリサイズやスマホの回転が起きても「かいた模様」自体は失われず、
 * 石の当たり判定・リングボーナスの範囲だけを現在のピクセルサイズに合わせて再計算する。
 */
export class SandRippleWorld {
  width = 0;
  height = 0;
  rocks: Rock[] = [];
  score = 0;
  timeRemaining = ROUND_SECONDS;
  elapsedSeconds = 0;
  isOver = false;
  coveragePercent = 0;

  private rakedLevel = new Float64Array(GRID_COLS * GRID_ROWS);
  private isRockCell = new Uint8Array(GRID_COLS * GRID_ROWS);
  private cellWeight = new Float64Array(GRID_COLS * GRID_ROWS);
  private nonRockCellCount = 0;

  constructor(width: number, height: number) {
    this.resize(width, height);
    this.reset();
  }

  reset(): void {
    this.score = 0;
    this.timeRemaining = ROUND_SECONDS;
    this.elapsedSeconds = 0;
    this.isOver = false;
    this.coveragePercent = 0;
    this.rakedLevel.fill(0);
    this.rocks = this.generateRocks();
    this.recomputeRockCellsAndWeights();
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.width = width;
    this.height = height;
    this.recomputeRockCellsAndWeights();
  }

  /** 正規化座標で保持している石の位置・半径を、現在の画面ピクセルに変換する。 */
  rockToPixel(rock: Rock): PixelCircle {
    const scale = Math.min(this.width, this.height);
    return { x: rock.nx * this.width, y: rock.ny * this.height, radius: rock.nRadius * scale };
  }

  /** グリッド全マスを走査する。描画側はこれだけを使い、内部配列には触れない。 */
  forEachCell(
    callback: (
      col: number,
      row: number,
      rakedLevel: number,
      isRock: boolean,
      isRingBonus: boolean,
    ) => void,
  ): void {
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const idx = row * GRID_COLS + col;
        callback(
          col,
          row,
          this.rakedLevel[idx],
          this.isRockCell[idx] === 1,
          this.cellWeight[idx] > 1,
        );
      }
    }
  }

  getCellRakedLevel(col: number, row: number): number {
    return this.rakedLevel[row * GRID_COLS + col] ?? 0;
  }

  isCellRock(col: number, row: number): boolean {
    return this.isRockCell[row * GRID_COLS + col] === 1;
  }

  /** ポインタの移動経路に沿って砂をかく。石の上は掃けない。 */
  rakeStroke(fromX: number, fromY: number, toX: number, toY: number): void {
    if (this.isOver || this.width <= 0 || this.height <= 0) return;
    const rakeRadiusPx = RAKE_RADIUS_RATIO * Math.min(this.width, this.height);
    const dist = Math.hypot(toX - fromX, toY - fromY);
    const steps = Math.max(1, Math.ceil(dist / Math.max(1, rakeRadiusPx * 0.6)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      this.rakeAtPoint(fromX + (toX - fromX) * t, fromY + (toY - fromY) * t, rakeRadiusPx);
    }
  }

  step(deltaSeconds: number): void {
    this.elapsedSeconds += deltaSeconds;
    if (this.isOver) return;

    this.timeRemaining = Math.max(0, this.timeRemaining - deltaSeconds);
    if (this.timeRemaining <= 0) {
      this.isOver = true;
    }

    let weightedSum = 0;
    let rakedCount = 0;
    for (let i = 0; i < this.rakedLevel.length; i++) {
      if (this.isRockCell[i]) continue;
      this.rakedLevel[i] = Math.max(0, this.rakedLevel[i] - DECAY_PER_SECOND * deltaSeconds);
      weightedSum += this.rakedLevel[i] * this.cellWeight[i];
      if (this.rakedLevel[i] >= RAKED_THRESHOLD) rakedCount++;
    }
    this.score += weightedSum * SCORE_PER_WEIGHTED_CELL_PER_SECOND * deltaSeconds;
    this.coveragePercent =
      this.nonRockCellCount > 0 ? (rakedCount / this.nonRockCellCount) * 100 : 0;
  }

  private rakeAtPoint(x: number, y: number, radiusPx: number): void {
    const colSpan = Math.ceil((radiusPx / this.width) * GRID_COLS) + 1;
    const rowSpan = Math.ceil((radiusPx / this.height) * GRID_ROWS) + 1;
    const centerCol = Math.floor((x / this.width) * GRID_COLS);
    const centerRow = Math.floor((y / this.height) * GRID_ROWS);

    for (let dr = -rowSpan; dr <= rowSpan; dr++) {
      const row = centerRow + dr;
      if (row < 0 || row >= GRID_ROWS) continue;
      for (let dc = -colSpan; dc <= colSpan; dc++) {
        const col = centerCol + dc;
        if (col < 0 || col >= GRID_COLS) continue;
        const idx = row * GRID_COLS + col;
        if (this.isRockCell[idx]) continue;
        const cx = ((col + 0.5) / GRID_COLS) * this.width;
        const cy = ((row + 0.5) / GRID_ROWS) * this.height;
        if (Math.hypot(cx - x, cy - y) <= radiusPx) {
          this.rakedLevel[idx] = 1;
        }
      }
    }
  }

  private generateRocks(): Rock[] {
    const rocks: Rock[] = [];
    for (let i = 0; i < ROCK_COUNT; i++) {
      for (let attempt = 0; attempt < 30; attempt++) {
        const candidate: Rock = {
          nx: randRange(0.14, 0.86),
          ny: randRange(0.18, 0.82),
          nRadius: randRange(0.045, 0.075),
        };
        const overlaps = rocks.some(
          (rock) =>
            Math.hypot(rock.nx - candidate.nx, rock.ny - candidate.ny) <
            rock.nRadius + candidate.nRadius + ROCK_MIN_GAP,
        );
        if (!overlaps) {
          rocks.push(candidate);
          break;
        }
      }
    }
    return rocks;
  }

  private recomputeRockCellsAndWeights(): void {
    this.isRockCell.fill(0);
    this.cellWeight.fill(1);
    if (this.width <= 0 || this.height <= 0) return;

    const rockCirclesPx = this.rocks.map((rock) => this.rockToPixel(rock));
    const ringBandPx = RING_BAND_RATIO * Math.min(this.width, this.height);

    this.nonRockCellCount = 0;
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const idx = row * GRID_COLS + col;
        const cx = ((col + 0.5) / GRID_COLS) * this.width;
        const cy = ((row + 0.5) / GRID_ROWS) * this.height;

        let isRock = false;
        let isRing = false;
        for (const circle of rockCirclesPx) {
          const dist = Math.hypot(cx - circle.x, cy - circle.y);
          if (dist <= circle.radius) {
            isRock = true;
            break;
          }
          if (dist <= circle.radius + ringBandPx) {
            isRing = true;
          }
        }

        if (isRock) {
          this.isRockCell[idx] = 1;
          this.cellWeight[idx] = 1;
          this.rakedLevel[idx] = 0;
        } else {
          this.nonRockCellCount++;
          this.cellWeight[idx] = isRing ? RING_BONUS_MULTIPLIER : 1;
        }
      }
    }
  }
}
