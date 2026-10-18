import { WORD_LIST } from "./wordList.ts";

export interface TileCoord {
  row: number;
  col: number;
}

export function sameTile(a: TileCoord, b: TileCoord): boolean {
  return a.row === b.row && a.col === b.col;
}

export function isAdjacent(a: TileCoord, b: TileCoord): boolean {
  if (sameTile(a, b)) return false;
  return Math.abs(a.row - b.row) <= 1 && Math.abs(a.col - b.col) <= 1;
}

function buildLetterWeights(words: readonly string[]): ReadonlyMap<string, number> {
  const weights = new Map<string, number>();
  for (const word of words) {
    for (const letter of word) {
      weights.set(letter, (weights.get(letter) ?? 0) + 1);
    }
  }
  return weights;
}

// 辞書に実際に出てくる文字だけを、出現頻度の重みで抽選する。
// 完全な乱択だと辞書の単語と噛み合わない文字ばかりになり、見つけられる単語が
// 極端に減ってしまうためです。
const LETTER_WEIGHTS = buildLetterWeights(WORD_LIST);
const LETTER_ENTRIES = Array.from(LETTER_WEIGHTS.entries());
const TOTAL_WEIGHT = LETTER_ENTRIES.reduce((sum, [, weight]) => sum + weight, 0);

function pickWeightedLetter(random: () => number): string {
  let threshold = random() * TOTAL_WEIGHT;
  for (const [letter, weight] of LETTER_ENTRIES) {
    threshold -= weight;
    if (threshold <= 0) return letter;
  }
  const fallback = LETTER_ENTRIES[LETTER_ENTRIES.length - 1];
  return fallback ? fallback[0] : "あ";
}

export function generateGrid(
  rows: number,
  cols: number,
  random: () => number = Math.random,
): string[][] {
  const grid: string[][] = [];
  for (let row = 0; row < rows; row++) {
    const line: string[] = [];
    for (let col = 0; col < cols; col++) {
      line.push(pickWeightedLetter(random));
    }
    grid.push(line);
  }
  return grid;
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function neighborsOf(tile: TileCoord, rows: number, cols: number): TileCoord[] {
  const result: TileCoord[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const row = tile.row + dr;
      const col = tile.col + dc;
      if (row >= 0 && row < rows && col >= 0 && col < cols) result.push({ row, col });
    }
  }
  return result;
}

/**
 * グリッド上に、隣接するマスを辿ってたどり着ける自己交差しない経路を探す
 * (バックトラッキング探索)。見つかれば経路を返し、見つからなければ null。
 */
export function planWordPath(
  rows: number,
  cols: number,
  length: number,
  random: () => number,
): TileCoord[] | null {
  if (length <= 0 || length > rows * cols) return null;

  const visited = new Set<string>();
  const path: TileCoord[] = [];
  const allCells: TileCoord[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) allCells.push({ row, col });
  }

  function search(): boolean {
    if (path.length === length) return true;
    const last = path[path.length - 1];
    const candidates = last ? neighborsOf(last, rows, cols) : allCells;
    for (const candidate of shuffle(candidates, random)) {
      const key = `${candidate.row},${candidate.col}`;
      if (visited.has(key)) continue;
      visited.add(key);
      path.push(candidate);
      if (search()) return true;
      path.pop();
      visited.delete(key);
    }
    return false;
  }

  return search() ? [...path] : null;
}

/**
 * 必ず1つは見つけられる単語を仕込んだグリッドを作る。
 * 完全な乱択だけでは、どの単語も作れない盤面がまれに生まれてしまうため。
 */
export function buildSolvableGrid(
  rows: number,
  cols: number,
  random: () => number = Math.random,
): string[][] {
  const grid = generateGrid(rows, cols, random);
  const candidateWords = shuffle(WORD_LIST, random);

  for (const word of candidateWords) {
    const path = planWordPath(rows, cols, word.length, random);
    if (!path) continue;
    path.forEach((tile, index) => {
      grid[tile.row][tile.col] = word[index];
    });
    break;
  }

  return grid;
}
