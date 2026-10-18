export interface RoundResolvedEvent {
  success: boolean;
  relicIndex: number;
  scoreGained: number;
}

export const GRID_COLS = 14;
export const GRID_ROWS = 9;
export const INTEGRITY_MAX = 100;
export const STAMINA_MAX = 100;
export const LIVES_START = 3;
export const COMPLETE_REVEAL_RATIO = 0.85;
export const CLEARED_SAND_THRESHOLD = 0.06;

const BASE_RELIC_RADIUS_X_CELLS = 2.1;
const RELIC_RADIUS_X_GROWTH = 0.12;
const RELIC_RADIUS_X_MAX = 4.6;
const BASE_RELIC_RADIUS_Y_CELLS = 1.5;
const RELIC_RADIUS_Y_GROWTH = 0.09;
const RELIC_RADIUS_Y_MAX = 3.3;

const CLEAR_RATE_PER_SECOND = 4.2; // 重なり率1(ブラシ中心)のとき、砂が1秒あたり減る量。
const BRUSH_RADIUS_RATIO = 0.14; // min(width, height) に対するブラシ半径の比率。

const BASE_ALLOWED_SPEED = 820; // px/秒。これを超えて脆い遺物セルを払うとヒビが入る。
const ALLOWED_SPEED_STEP = 48;
const MIN_ALLOWED_SPEED = 260;

export const CRACK_INTEGRITY_PENALTY = 22;

const BASE_ROUND_SECONDS = 24;
const ROUND_SECONDS_STEP = 1;
const MIN_ROUND_SECONDS = 11;

const STAMINA_DRAIN_PER_SECOND = 24;
const STAMINA_REGEN_PER_SECOND = 16;

const BASE_POINTS_PER_ROUND = 420;
const COMBO_STEP = 0.18;
const COMBO_CAP = 2.6;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * 発掘ゲーム「Relic Dust」の純粋ロジック。
 *
 * 画面をセルのグリッドに分け、各セルは砂の量(sand: 1=未発掘 → 0=発掘済み)を持つ。
 * 中央に遺物の形(楕円)が隠れており、そのセル(isRelic)だけ「脆さ」の判定を受ける:
 * まだ砂が残っている(発掘済みになっていない)遺物セルを許容速度を超える速さで払うと
 * ヒビが入り、耐久(integrity)が減る。周囲の土(isRelic=false)は速さに関係なく払える。
 * 払う(brush)動作は常時使えるわけではなくスタミナを消費するため、ペース配分が必要。
 */
export class RelicDustWorld {
  width = 0;
  height = 0;

  pointerX = 0;
  pointerY = 0;
  isBrushing = false;
  private hasLastBrushSample = false;
  private lastBrushX = 0;
  private lastBrushY = 0;
  lastBrushSpeed = 0;

  relicIndex = 0;
  integrity = INTEGRITY_MAX;
  stamina = STAMINA_MAX;
  lives = LIVES_START;
  score = 0;
  comboMultiplier = 1;
  roundDuration = BASE_ROUND_SECONDS;
  roundTimeLeft = BASE_ROUND_SECONDS;
  isOver = false;

  private sand = new Float32Array(GRID_COLS * GRID_ROWS);
  private relicMask = new Uint8Array(GRID_COLS * GRID_ROWS);
  private cracked = new Uint8Array(GRID_COLS * GRID_ROWS);
  private relicCellCount = 0;

  onRoundResolved: ((event: RoundResolvedEvent) => void) | null = null;

  constructor(width: number, height: number) {
    this.resize(width, height);
    this.reset();
  }

  reset(): void {
    this.lives = LIVES_START;
    this.score = 0;
    this.comboMultiplier = 1;
    this.relicIndex = 0;
    this.isOver = false;
    this.pointerX = this.width / 2;
    this.pointerY = this.height / 2;
    this.isBrushing = false;
    this.hasLastBrushSample = false;
    this.lastBrushSpeed = 0;
    this.spawnRelic(0);
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.width = width;
    this.height = height;
    this.pointerX = clamp(this.pointerX, 0, this.width);
    this.pointerY = clamp(this.pointerY, 0, this.height);
  }

  get cellWidth(): number {
    return this.width / GRID_COLS;
  }

  get cellHeight(): number {
    return this.height / GRID_ROWS;
  }

  get brushRadiusPx(): number {
    return Math.min(this.width, this.height) * BRUSH_RADIUS_RATIO;
  }

  get allowedSpeed(): number {
    return Math.max(MIN_ALLOWED_SPEED, BASE_ALLOWED_SPEED - this.relicIndex * ALLOWED_SPEED_STEP);
  }

  get revealRatio(): number {
    if (this.relicCellCount === 0) return 1;
    let cleared = 0;
    for (let i = 0; i < this.sand.length; i++) {
      if (this.relicMask[i] && this.sand[i] <= CLEARED_SAND_THRESHOLD) cleared++;
    }
    return cleared / this.relicCellCount;
  }

  /** レンダリング用に1セル分の状態を読み取る。 */
  getCell(col: number, row: number): { sand: number; isRelic: boolean; isCracked: boolean } {
    const i = row * GRID_COLS + col;
    return {
      sand: this.sand[i],
      isRelic: this.relicMask[i] === 1,
      isCracked: this.cracked[i] === 1,
    };
  }

  /** 遺物の形(楕円)を画面ピクセル座標で返す。描画に使う。 */
  getRelicBoundsPx(): { cx: number; cy: number; rx: number; ry: number } {
    return {
      cx: (GRID_COLS / 2) * this.cellWidth,
      cy: (GRID_ROWS / 2) * this.cellHeight,
      rx: this.currentRelicRadiusXCells() * this.cellWidth,
      ry: this.currentRelicRadiusYCells() * this.cellHeight,
    };
  }

  setPointerDown(x: number, y: number): void {
    this.pointerX = clamp(x, 0, this.width);
    this.pointerY = clamp(y, 0, this.height);
    this.isBrushing = true;
    this.hasLastBrushSample = false;
  }

  setPointerPosition(x: number, y: number): void {
    this.pointerX = clamp(x, 0, this.width);
    this.pointerY = clamp(y, 0, this.height);
  }

  setPointerUp(): void {
    this.isBrushing = false;
    this.hasLastBrushSample = false;
  }

  /** キーボード操作用。移動と同時にブラシを有効にするかは呼び出し側が setBrushing で決める。 */
  nudgePointer(dx: number, dy: number): void {
    this.setPointerPosition(this.pointerX + dx, this.pointerY + dy);
  }

  setBrushing(active: boolean): void {
    this.isBrushing = active;
    if (!active) this.hasLastBrushSample = false;
  }

  private currentRelicRadiusXCells(): number {
    return Math.min(
      RELIC_RADIUS_X_MAX,
      BASE_RELIC_RADIUS_X_CELLS + this.relicIndex * RELIC_RADIUS_X_GROWTH,
    );
  }

  private currentRelicRadiusYCells(): number {
    return Math.min(
      RELIC_RADIUS_Y_MAX,
      BASE_RELIC_RADIUS_Y_CELLS + this.relicIndex * RELIC_RADIUS_Y_GROWTH,
    );
  }

  private spawnRelic(index: number): void {
    this.sand.fill(1);
    this.relicMask.fill(0);
    this.cracked.fill(0);
    this.integrity = INTEGRITY_MAX;
    this.stamina = STAMINA_MAX;
    this.roundDuration = Math.max(
      MIN_ROUND_SECONDS,
      BASE_ROUND_SECONDS - index * ROUND_SECONDS_STEP,
    );
    this.roundTimeLeft = this.roundDuration;
    this.hasLastBrushSample = false;

    const rx = this.currentRelicRadiusXCells();
    const ry = this.currentRelicRadiusYCells();
    const cx = GRID_COLS / 2;
    const cy = GRID_ROWS / 2;
    let count = 0;
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const nx = (col + 0.5 - cx) / rx;
        const ny = (row + 0.5 - cy) / ry;
        if (nx * nx + ny * ny <= 1) {
          this.relicMask[row * GRID_COLS + col] = 1;
          count++;
        }
      }
    }
    this.relicCellCount = count;
  }

  private applyBrush(x: number, y: number, speed: number, deltaSeconds: number): void {
    const radius = this.brushRadiusPx;
    const cw = this.cellWidth;
    const ch = this.cellHeight;
    for (let row = 0; row < GRID_ROWS; row++) {
      const cellCy = (row + 0.5) * ch;
      for (let col = 0; col < GRID_COLS; col++) {
        const i = row * GRID_COLS + col;
        if (this.sand[i] <= 0) continue;
        const cellCx = (col + 0.5) * cw;
        const dist = Math.hypot(cellCx - x, cellCy - y);
        if (dist > radius) continue;
        const overlap = 1 - dist / radius;

        if (this.relicMask[i] === 1 && this.cracked[i] === 0 && speed > this.allowedSpeed) {
          this.cracked[i] = 1;
          this.integrity = Math.max(0, this.integrity - CRACK_INTEGRITY_PENALTY);
          continue;
        }

        this.sand[i] = Math.max(0, this.sand[i] - CLEAR_RATE_PER_SECOND * overlap * deltaSeconds);
      }
    }
  }

  private resolveRound(success: boolean): void {
    let scoreGained = 0;
    if (success) {
      this.comboMultiplier = Math.min(COMBO_CAP, this.comboMultiplier + COMBO_STEP);
      scoreGained = BASE_POINTS_PER_ROUND * (this.integrity / INTEGRITY_MAX) * this.comboMultiplier;
      this.score += scoreGained;
    } else {
      this.comboMultiplier = 1;
      this.lives -= 1;
      if (this.lives <= 0) {
        this.lives = 0;
        this.isOver = true;
        this.onRoundResolved?.({ success, relicIndex: this.relicIndex, scoreGained });
        return;
      }
    }

    const finishedIndex = this.relicIndex;
    this.relicIndex += 1;
    this.spawnRelic(this.relicIndex);
    this.onRoundResolved?.({ success, relicIndex: finishedIndex, scoreGained });
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    if (this.isBrushing && this.stamina > 0) {
      const speed = this.hasLastBrushSample
        ? Math.hypot(this.pointerX - this.lastBrushX, this.pointerY - this.lastBrushY) /
          Math.max(deltaSeconds, 1 / 1000)
        : 0;
      this.lastBrushSpeed = speed;
      this.applyBrush(this.pointerX, this.pointerY, speed, deltaSeconds);
      this.stamina = Math.max(0, this.stamina - STAMINA_DRAIN_PER_SECOND * deltaSeconds);
      this.lastBrushX = this.pointerX;
      this.lastBrushY = this.pointerY;
      this.hasLastBrushSample = true;
    } else if (!this.isBrushing) {
      // 離している間だけスタミナが回復する(ペース配分を要求する設計)。
      this.lastBrushSpeed = 0;
      this.hasLastBrushSample = false;
      this.stamina = Math.min(STAMINA_MAX, this.stamina + STAMINA_REGEN_PER_SECOND * deltaSeconds);
    } else {
      // 押し続けているがスタミナが尽きている: 払えないが回復もしない。
      this.lastBrushSpeed = 0;
      this.hasLastBrushSample = false;
    }

    if (this.integrity <= 0) {
      this.resolveRound(false);
      return;
    }

    if (this.revealRatio >= COMPLETE_REVEAL_RATIO) {
      this.resolveRound(true);
      return;
    }

    this.roundTimeLeft -= deltaSeconds;
    if (this.roundTimeLeft <= 0) {
      this.roundTimeLeft = 0;
      this.resolveRound(false);
    }
  }
}
