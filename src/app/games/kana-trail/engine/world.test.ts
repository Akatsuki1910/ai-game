import assert from "node:assert/strict";
import { test } from "node:test";
import { isAdjacent, type TileCoord } from "./grid.ts";
import { WORD_LIST } from "./wordList.ts";
import {
  isKnownWord,
  KanaTrailWorld,
  MIN_WORD_LENGTH,
  ROUND_SECONDS,
  scoreForWord,
  type WordSubmitResult,
} from "./world.ts";

function submitPath(world: KanaTrailWorld, path: TileCoord[]): WordSubmitResult {
  world.beginChain(path[0]);
  for (const tile of path.slice(1)) {
    const extended = world.extendChain(tile);
    assert.ok(extended, "経路が隣接していれば鎖に追加できる");
  }
  return world.submitChain();
}

/** 盤面に実際に仕込まれた単語を、隣接マスだけを辿って探す(バックトラッキング探索)。 */
function findSolvableWordPath(world: KanaTrailWorld): TileCoord[] {
  const rows = world.rows;
  const cols = world.cols;
  const visited = new Set<string>();

  function search(word: string, tile: TileCoord, index: number, path: TileCoord[]): boolean {
    if (world.letterAt(tile) !== word[index]) return false;
    path.push(tile);
    if (index === word.length - 1) return true;

    const key = `${tile.row},${tile.col}`;
    visited.add(key);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (visited.has(`${row},${col}`)) continue;
        const next = { row, col };
        if (!isAdjacent(tile, next)) continue;
        if (search(word, next, index + 1, path)) return true;
      }
    }
    visited.delete(key);
    path.pop();
    return false;
  }

  for (const word of WORD_LIST) {
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const path: TileCoord[] = [];
        visited.clear();
        if (search(word, { row, col }, 0, path)) return path;
      }
    }
  }
  throw new Error("buildSolvableGrid が保証しているはずの単語が見つからない");
}

test("起動直後は盤面・スコア・タイマーが初期状態になっている", () => {
  const world = new KanaTrailWorld(Math.random);
  assert.equal(world.grid.length, world.rows);
  assert.equal(world.score, 0);
  assert.equal(world.timeRemaining, ROUND_SECONDS);
  assert.equal(world.isOver, false);
  assert.deepEqual(world.chain, []);
  assert.deepEqual(world.foundWords, []);
});

test("辞書にある単語をなぞって離すと得点が入り、同じ単語は2回数えられない", () => {
  const world = new KanaTrailWorld(Math.random);
  const path = findSolvableWordPath(world);
  const expectedWord = path.map((tile) => world.letterAt(tile)).join("");

  const first = submitPath(world, path);
  assert.equal(first.status, "accepted");
  assert.equal(first.word, expectedWord);
  assert.equal(first.points, scoreForWord(expectedWord));
  assert.equal(world.score, scoreForWord(expectedWord));
  assert.deepEqual(world.foundWords, [expectedWord]);
  assert.deepEqual(world.chain, [], "確定すると鎖はリセットされる");

  const second = submitPath(world, path);
  assert.equal(second.status, "duplicate");
  assert.equal(world.score, scoreForWord(expectedWord), "2回目は加点されない");
});

test("1文字だけの確定は too-short になり加点されない", () => {
  const world = new KanaTrailWorld(Math.random);
  const result = submitPath(world, [{ row: 0, col: 0 }]);
  assert.equal(result.status, "too-short");
  assert.equal(world.score, 0);
});

test("辞書にない組み合わせは invalid になる", () => {
  const world = new KanaTrailWorld(Math.random);
  // RNG に依存せず検証するため、盤面を直接書き換えて非語を作る。
  world.grid = world.grid.map((row) => row.slice());
  world.grid[0][0] = "ん";
  world.grid[0][1] = "ん";
  assert.equal(isKnownWord("んん"), false, "テストの前提: この組み合わせは辞書にない");

  const result = submitPath(world, [
    { row: 0, col: 0 },
    { row: 0, col: 1 },
  ]);
  assert.equal(result.status, "invalid");
  assert.equal(result.word, "んん");
  assert.equal(world.score, 0);
});

test("隣接していないタイルへは鎖を伸ばせない", () => {
  const world = new KanaTrailWorld(Math.random);
  world.beginChain({ row: 0, col: 0 });
  const extended = world.extendChain({ row: 4, col: 4 });
  assert.equal(extended, false);
  assert.deepEqual(world.chain, [{ row: 0, col: 0 }]);
});

test("直前以外の、既に鎖にあるタイルへは戻れない", () => {
  const world = new KanaTrailWorld(Math.random);
  world.beginChain({ row: 2, col: 2 });
  world.extendChain({ row: 2, col: 3 });
  world.extendChain({ row: 2, col: 4 });

  // 鎖は [2,2]→[2,3]→[2,4]。直前の[2,3]以外の過去のタイル[2,2]には戻れない。
  const extended = world.extendChain({ row: 2, col: 2 });
  assert.equal(extended, false, "直前のタイル以外への巻き戻しは拒否される");
  assert.deepEqual(world.chain, [
    { row: 2, col: 2 },
    { row: 2, col: 3 },
    { row: 2, col: 4 },
  ]);
});

test("1つ前のタイルへ戻ると1文字戻せる(なぞり直し)", () => {
  const world = new KanaTrailWorld(Math.random);
  const path = findSolvableWordPath(world);
  assert.ok(path.length >= 2, "2マス以上の経路で確認する");

  world.beginChain(path[0]);
  world.extendChain(path[1]);
  assert.deepEqual(world.chain, [path[0], path[1]]);

  const backtracked = world.extendChain(path[0]);
  assert.equal(backtracked, true);
  assert.deepEqual(world.chain, [path[0]], "1つ前のタイルに戻ると末尾が1つ減る");
});

test("undoLast / cancelChain で鎖を操作できる", () => {
  const world = new KanaTrailWorld(Math.random);
  const path = findSolvableWordPath(world);
  world.beginChain(path[0]);
  for (const tile of path.slice(1)) world.extendChain(tile);

  world.undoLast();
  assert.equal(world.chain.length, path.length - 1);

  world.cancelChain();
  assert.deepEqual(world.chain, []);
});

test("90秒遊ぶとラウンドが終わり、鎖もリセットされる。リスタートで最初から遊べる", () => {
  const world = new KanaTrailWorld(Math.random);
  world.beginChain({ row: 0, col: 0 });

  for (let i = 0; i < 1000 && !world.isOver; i++) {
    world.step(0.1);
  }

  assert.equal(world.isOver, true);
  assert.equal(world.timeRemaining, 0);
  assert.deepEqual(world.chain, [], "ラウンド終了時に鎖は破棄される");

  // 終了後に操作しても壊れない
  world.beginChain({ row: 1, col: 1 });
  assert.deepEqual(world.chain, [], "終了後は鎖を開始できない");
  const result = world.submitChain();
  assert.equal(result.status, "too-short");

  world.reset();
  assert.equal(world.isOver, false);
  assert.equal(world.score, 0);
  assert.equal(world.timeRemaining, ROUND_SECONDS);
  assert.deepEqual(world.foundWords, []);
});

test("scoreForWord は文字数が長いほど高得点になる", () => {
  assert.equal(scoreForWord("ねこ"), 1);
  assert.equal(scoreForWord("さかな"), 2);
  assert.ok(scoreForWord("たんぽぽ") > scoreForWord("さかな"));
  assert.ok(scoreForWord("かたつむり") >= scoreForWord("たんぽぽ"));
});

test("MIN_WORD_LENGTH 未満の単語は submitChain に到達する前提が崩れないよう2以上", () => {
  assert.ok(MIN_WORD_LENGTH >= 2);
});
