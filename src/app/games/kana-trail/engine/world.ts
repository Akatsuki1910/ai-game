import { buildSolvableGrid, isAdjacent, sameTile, type TileCoord } from "./grid.ts";
import { WORD_LIST } from "./wordList.ts";

export const ROUND_SECONDS = 90;
export const GRID_ROWS = 5;
export const GRID_COLS = 5;
export const MIN_WORD_LENGTH = 2;

const WORD_SET: ReadonlySet<string> = new Set(WORD_LIST);

export type WordSubmitStatus = "accepted" | "too-short" | "duplicate" | "invalid";

export interface WordSubmitResult {
  status: WordSubmitStatus;
  word: string;
  points: number;
}

export function isKnownWord(word: string): boolean {
  return WORD_SET.has(word);
}

export function scoreForWord(word: string): number {
  const length = word.length;
  if (length <= 2) return 1;
  if (length === 3) return 2;
  if (length === 4) return 4;
  if (length === 5) return 6;
  return 9;
}

/**
 * かなトレイルの盤面と進行状態。
 * 画面には依存しない純粋なロジックで、タイルの座標(行・列)だけを扱う。
 */
export class KanaTrailWorld {
  readonly rows = GRID_ROWS;
  readonly cols = GRID_COLS;
  grid: string[][] = [];
  chain: TileCoord[] = [];
  score = 0;
  timeRemaining = ROUND_SECONDS;
  isOver = false;
  foundWords: string[] = [];
  private readonly foundSet = new Set<string>();
  private readonly random: () => number;

  constructor(random: () => number = Math.random) {
    this.random = random;
    this.reset();
  }

  reset(): void {
    this.grid = buildSolvableGrid(this.rows, this.cols, this.random);
    this.chain = [];
    this.score = 0;
    this.timeRemaining = ROUND_SECONDS;
    this.isOver = false;
    this.foundWords = [];
    this.foundSet.clear();
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;
    this.timeRemaining = Math.max(0, this.timeRemaining - deltaSeconds);
    if (this.timeRemaining <= 0) {
      this.isOver = true;
      this.chain = [];
    }
  }

  letterAt(tile: TileCoord): string {
    return this.grid[tile.row]?.[tile.col] ?? "";
  }

  isInChain(tile: TileCoord): boolean {
    return this.chain.some((existing) => sameTile(existing, tile));
  }

  beginChain(tile: TileCoord): void {
    if (this.isOver) return;
    this.chain = [tile];
  }

  /** ドラッグ/キーボード操作でタイルを鎖に追加する。1つ前のタイルへ戻ると1文字戻せる。 */
  extendChain(tile: TileCoord): boolean {
    if (this.isOver || this.chain.length === 0) return false;

    const last = this.chain[this.chain.length - 1];
    if (sameTile(last, tile)) return false;

    const secondLast = this.chain[this.chain.length - 2];
    if (secondLast && sameTile(secondLast, tile)) {
      this.chain = this.chain.slice(0, -1);
      return true;
    }

    if (this.isInChain(tile)) return false;
    if (!isAdjacent(last, tile)) return false;

    this.chain = [...this.chain, tile];
    return true;
  }

  undoLast(): void {
    if (this.chain.length === 0) return;
    this.chain = this.chain.slice(0, -1);
  }

  cancelChain(): void {
    this.chain = [];
  }

  submitChain(): WordSubmitResult {
    const path = this.chain;
    this.chain = [];

    if (this.isOver || path.length < MIN_WORD_LENGTH) {
      return {
        status: "too-short",
        word: path.map((tile) => this.letterAt(tile)).join(""),
        points: 0,
      };
    }

    const word = path.map((tile) => this.letterAt(tile)).join("");

    if (this.foundSet.has(word)) {
      return { status: "duplicate", word, points: 0 };
    }
    if (!isKnownWord(word)) {
      return { status: "invalid", word, points: 0 };
    }

    const points = scoreForWord(word);
    this.score += points;
    this.foundSet.add(word);
    this.foundWords = [...this.foundWords, word];
    return { status: "accepted", word, points };
  }
}
