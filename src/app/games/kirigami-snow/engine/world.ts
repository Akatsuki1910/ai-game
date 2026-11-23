import { findCellAtPoint } from "./wedgeGeometry.ts";

/** ウェッジ(折り紙の1/8切片)上の1マス。切り紙でいう「切る/残す」の最小単位。 */
export interface WedgeCell {
  readonly row: number;
  readonly col: number;
  /** 開いた(=仕上がりの)雪の結晶で、このマスの紙が残っているべきかどうか。 */
  readonly shouldKeep: boolean;
  /** プレイヤーが実際にこのマスを切ったかどうか。 */
  isCut: boolean;
}

export interface RoundCompletedEvent {
  round: number;
  accuracy: number;
  success: boolean;
  points: number;
  livesRemaining: number;
  /** 仕上げた瞬間のセル状態(再生成前のスナップショット)。開いた結晶の演出に使う。 */
  cells: readonly WedgeCell[];
  rowCount: number;
}

export const MAX_LIVES = 3;
export const SUCCESS_ACCURACY = 0.75;
export const MIN_ROW_COUNT = 3;
export const MAX_ROW_COUNT = 8;
export const BASE_ROUND_SECONDS = 20;
export const MIN_ROUND_SECONDS = 8;
const ROUND_SECONDS_SHRINK_PER_ROUND = 1.2;

/** ラウンドが進むほどウェッジの行数(=マス数)が増えて細かくなる。 */
export function rowCountForRound(round: number): number {
  return Math.min(MAX_ROW_COUNT, MIN_ROW_COUNT + Math.floor((round - 1) / 2));
}

/** ラウンドが進むほど制限時間が短くなる(下限あり)。 */
export function roundSecondsForRound(round: number): number {
  return Math.max(
    MIN_ROUND_SECONDS,
    BASE_ROUND_SECONDS - (round - 1) * ROUND_SECONDS_SHRINK_PER_ROUND,
  );
}

/**
 * ランダムな目標パターン(お手本の結晶の形)を生成する。
 * 内側のリングほど「残す」確率が高く、外側ほど低くなるようにして、
 * 中心でつながった雪の結晶らしい形になりやすくしている。
 * 全マス同じ(全部残す/全部切る)になると解く形自体が無いので、必ず両方を含むように調整する。
 */
export function generateWedgeCells(rowCount: number, rng: () => number = Math.random): WedgeCell[] {
  const cells: WedgeCell[] = [];
  for (let row = 0; row < rowCount; row++) {
    const keepProbability = Math.max(0.18, 0.82 - row * (0.6 / rowCount));
    for (let col = 0; col <= row; col++) {
      cells.push({ row, col, shouldKeep: rng() < keepProbability, isCut: false });
    }
  }

  const keepCount = cells.filter((cell) => cell.shouldKeep).length;
  if (keepCount === 0) {
    cells[0] = { ...cells[0], shouldKeep: true };
  } else if (keepCount === cells.length) {
    cells[cells.length - 1] = { ...cells[cells.length - 1], shouldKeep: false };
  }

  return cells;
}

/**
 * 折った紙(ウェッジ)を切って、開いたときに目標の結晶の形になるように仕上げるパズルの状態。
 * ラウンド中は純粋にタイマーと切った/残したの状態だけを持ち、見た目(開いた結晶の描画や
 * フェードアウトの演出)は呼び出し側(UIレイヤー)の責務とする。
 */
export class KirigamiSnowWorld {
  round = 1;
  lives = MAX_LIVES;
  score = 0;
  isOver = false;
  rowCount = rowCountForRound(1);
  timeRemaining = roundSecondsForRound(1);
  cells: WedgeCell[] = [];

  onRoundCompleted: ((event: RoundCompletedEvent) => void) | null = null;

  private readonly rng: () => number;

  constructor(rng: () => number = Math.random) {
    this.rng = rng;
    this.reset();
  }

  reset(): void {
    this.round = 1;
    this.lives = MAX_LIVES;
    this.score = 0;
    this.isOver = false;
    this.startRound();
  }

  private startRound(): void {
    this.rowCount = rowCountForRound(this.round);
    this.timeRemaining = roundSecondsForRound(this.round);
    this.cells = generateWedgeCells(this.rowCount, this.rng);
  }

  /** 現在の切った/残したの状態が、目標とどれだけ一致しているか(0〜1)。 */
  get liveAccuracy(): number {
    if (this.cells.length === 0) return 0;
    const correct = this.cells.filter((cell) => cell.isCut === !cell.shouldKeep).length;
    return correct / this.cells.length;
  }

  toggleCell(row: number, col: number): void {
    if (this.isOver) return;
    const cell = this.cells.find((c) => c.row === row && c.col === col);
    if (!cell) return;
    cell.isCut = !cell.isCut;
  }

  /** 正規化ローカル座標(折り目の中心基準、半径1が外周)でのクリック/タップを処理する。 */
  toggleCellAt(localX: number, localY: number): void {
    if (this.isOver) return;
    const hit = findCellAtPoint(localX, localY, this.rowCount);
    if (!hit) return;
    this.toggleCell(hit.row, hit.col);
  }

  /** ラウンドを仕上げる(制限時間切れでも、手動のFINISHでも呼ばれる)。 */
  finishRound(): void {
    if (this.isOver) return;

    const finishedCells = this.cells;
    const finishedRowCount = this.rowCount;
    const correct = finishedCells.filter((cell) => cell.isCut === !cell.shouldKeep).length;
    const accuracy = finishedCells.length > 0 ? correct / finishedCells.length : 0;
    const success = accuracy >= SUCCESS_ACCURACY;
    const points = success ? Math.round(accuracy * 120 * this.round) : Math.round(accuracy * 40);

    this.score += points;
    if (!success) this.lives -= 1;

    const finishedRound = this.round;
    const willBeOver = this.lives <= 0;
    if (willBeOver) this.lives = 0;

    this.onRoundCompleted?.({
      round: finishedRound,
      accuracy,
      success,
      points,
      livesRemaining: this.lives,
      cells: finishedCells,
      rowCount: finishedRowCount,
    });

    if (willBeOver) {
      this.isOver = true;
      return;
    }

    this.round += 1;
    this.startRound();
  }

  step(deltaSeconds: number): void {
    if (this.isOver || deltaSeconds <= 0) return;
    this.timeRemaining = Math.max(0, this.timeRemaining - deltaSeconds);
    if (this.timeRemaining <= 0) this.finishRound();
  }
}
