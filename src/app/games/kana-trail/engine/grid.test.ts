import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSolvableGrid,
  generateGrid,
  isAdjacent,
  planWordPath,
  sameTile,
  type TileCoord,
} from "./grid.ts";
import { WORD_LIST } from "./wordList.ts";

const ROWS = 5;
const COLS = 5;

function sequentialRandom(values: number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index % values.length];
    index++;
    return value;
  };
}

/** 盤面を実際に隣接マスだけを辿って、与えた単語が作れるかを調べる(テスト用の総当たり探索)。 */
function wordExistsInGrid(grid: string[][], word: string): boolean {
  const rows = grid.length;
  const cols = grid[0].length;
  const visited = new Set<string>();

  function search(tile: TileCoord, index: number): boolean {
    if (grid[tile.row][tile.col] !== word[index]) return false;
    if (index === word.length - 1) return true;

    const key = `${tile.row},${tile.col}`;
    visited.add(key);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const next = { row, col };
        if (visited.has(`${row},${col}`)) continue;
        if (!isAdjacent(tile, next)) continue;
        if (search(next, index + 1)) return true;
      }
    }
    visited.delete(key);
    return false;
  }

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (search({ row, col }, 0)) return true;
    }
  }
  return false;
}

test("isAdjacent は8方向の隣接マスだけを true にする", () => {
  assert.equal(isAdjacent({ row: 1, col: 1 }, { row: 1, col: 2 }), true, "横");
  assert.equal(isAdjacent({ row: 1, col: 1 }, { row: 2, col: 1 }), true, "縦");
  assert.equal(isAdjacent({ row: 1, col: 1 }, { row: 2, col: 2 }), true, "斜め");
  assert.equal(isAdjacent({ row: 1, col: 1 }, { row: 1, col: 1 }), false, "自分自身");
  assert.equal(isAdjacent({ row: 1, col: 1 }, { row: 1, col: 3 }), false, "2マス離れている");
  assert.equal(isAdjacent({ row: 1, col: 1 }, { row: 3, col: 1 }), false, "2マス離れている(縦)");
});

test("sameTile は座標が一致するときだけ true", () => {
  assert.equal(sameTile({ row: 0, col: 0 }, { row: 0, col: 0 }), true);
  assert.equal(sameTile({ row: 0, col: 0 }, { row: 0, col: 1 }), false);
});

test("generateGrid は指定した行数・列数のグリッドを、辞書に出てくる文字だけで作る", () => {
  const grid = generateGrid(ROWS, COLS, Math.random);
  assert.equal(grid.length, ROWS);
  for (const line of grid) assert.equal(line.length, COLS);

  const dictionaryLetters = new Set(WORD_LIST.join(""));
  for (const line of grid) {
    for (const letter of line) {
      assert.ok(dictionaryLetters.has(letter), `辞書に出てくる文字であること: ${letter}`);
    }
  }
});

test("generateGrid は同じ乱数列なら同じ結果を返す(決定的)", () => {
  const values = [0, 0.2, 0.4, 0.6, 0.8, 0.99, 0.1, 0.3, 0.5, 0.7];
  const gridA = generateGrid(3, 3, sequentialRandom(values));
  const gridB = generateGrid(3, 3, sequentialRandom(values));
  assert.deepEqual(gridA, gridB);
});

test("planWordPath は隣接関係を保った自己交差しない経路を返す", () => {
  const path = planWordPath(ROWS, COLS, 4, Math.random);
  assert.ok(path, "経路が見つかる");
  if (!path) return;

  assert.equal(path.length, 4);
  const seen = new Set<string>();
  for (const tile of path) {
    const key = `${tile.row},${tile.col}`;
    assert.ok(!seen.has(key), "同じマスを2回通らない");
    seen.add(key);
    assert.ok(tile.row >= 0 && tile.row < ROWS && tile.col >= 0 && tile.col < COLS, "盤面内");
  }
  for (let i = 1; i < path.length; i++) {
    assert.ok(isAdjacent(path[i - 1], path[i]), "隣り合うマスを辿っている");
  }
});

test("planWordPath はマス数を超える長さだと null を返す", () => {
  assert.equal(planWordPath(ROWS, COLS, ROWS * COLS + 1, Math.random), null);
});

test("buildSolvableGrid は辞書の単語を少なくとも1つ作れる盤面を返す", () => {
  for (let i = 0; i < 20; i++) {
    const grid = buildSolvableGrid(ROWS, COLS, Math.random);
    const hasAnyWord = WORD_LIST.some((word) => wordExistsInGrid(grid, word));
    assert.ok(hasAnyWord, "辞書のどれかの単語が実際に作れる");
  }
});
