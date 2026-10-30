import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type Direction,
  directionBetween,
  EAST,
  generateLevel,
  getPorts,
  isWithinGrid,
  NORTH,
  opposite,
  pathEntryExitPorts,
  rotatePipe,
  SOUTH,
  sameCoord,
  shapeForPorts,
  stepCoord,
  WEST,
} from "./grid.ts";

test("opposite は常に逆方向(180度)を返す", () => {
  assert.equal(opposite(NORTH), SOUTH);
  assert.equal(opposite(SOUTH), NORTH);
  assert.equal(opposite(EAST), WEST);
  assert.equal(opposite(WEST), EAST);
});

test("stepCoord は指定方向に1マス進んだ座標を返す", () => {
  assert.deepEqual(stepCoord({ col: 2, row: 2 }, NORTH), { col: 2, row: 1 });
  assert.deepEqual(stepCoord({ col: 2, row: 2 }, EAST), { col: 3, row: 2 });
  assert.deepEqual(stepCoord({ col: 2, row: 2 }, SOUTH), { col: 2, row: 3 });
  assert.deepEqual(stepCoord({ col: 2, row: 2 }, WEST), { col: 1, row: 2 });
});

test("isWithinGrid はグリッド範囲の判定を正しく行う", () => {
  assert.equal(isWithinGrid({ col: 0, row: 0 }, 6, 5), true);
  assert.equal(isWithinGrid({ col: 5, row: 4 }, 6, 5), true);
  assert.equal(isWithinGrid({ col: 6, row: 4 }, 6, 5), false);
  assert.equal(isWithinGrid({ col: 0, row: -1 }, 6, 5), false);
});

test("directionBetween は隣接マスから見た方角を返す", () => {
  assert.equal(directionBetween({ col: 0, row: 0 }, { col: 1, row: 0 }), EAST);
  assert.equal(directionBetween({ col: 1, row: 0 }, { col: 0, row: 0 }), WEST);
  assert.equal(directionBetween({ col: 0, row: 0 }, { col: 0, row: 1 }), SOUTH);
  assert.equal(directionBetween({ col: 0, row: 1 }, { col: 0, row: 0 }), NORTH);
});

test("getPorts は shape と rotation から実際の接続方向を求める", () => {
  assert.deepEqual(getPorts({ shape: "straight", rotation: 0 }), [NORTH, SOUTH]);
  assert.deepEqual(getPorts({ shape: "straight", rotation: 1 }), [EAST, WEST]);
  assert.deepEqual(getPorts({ shape: "straight", rotation: 2 }), [SOUTH, NORTH]);
  assert.deepEqual(getPorts({ shape: "elbow", rotation: 0 }), [NORTH, EAST]);
  assert.deepEqual(getPorts({ shape: "elbow", rotation: 1 }), [EAST, SOUTH]);
  assert.deepEqual(getPorts({ shape: "elbow", rotation: 2 }), [SOUTH, WEST]);
  assert.deepEqual(getPorts({ shape: "elbow", rotation: 3 }), [WEST, NORTH]);
});

test("rotatePipe は形を保ったまま回転を1つ進める（元のセルは変更しない）", () => {
  const original = { shape: "elbow" as const, rotation: 0 as const };
  const rotated = rotatePipe(original);

  assert.equal(original.rotation, 0, "元のセルは変更されない");
  assert.equal(rotated.shape, "elbow");
  assert.equal(rotated.rotation, 1);

  const wrapped = rotatePipe(rotatePipe(rotatePipe(rotated)));
  assert.equal(wrapped.rotation, 0, "4回回すと元の向きに戻る");
});

test("shapeForPorts は入口と出口の関係から直線/曲がりを判定する", () => {
  assert.equal(shapeForPorts(WEST, EAST), "straight");
  assert.equal(shapeForPorts(NORTH, SOUTH), "straight");
  assert.equal(shapeForPorts(WEST, SOUTH), "elbow");
  assert.equal(shapeForPorts(NORTH, EAST), "elbow");
});

test("pathEntryExitPorts は経路の先頭・末尾・中間で正しい入口/出口を返す", () => {
  const path = [
    { col: 0, row: 0 },
    { col: 1, row: 0 },
    { col: 1, row: 1 },
  ];
  // source は EAST 方向から流入、sink は EAST 方向へ流出する想定。
  assert.deepEqual(pathEntryExitPorts(path, 0, EAST, EAST), [WEST, EAST]);
  assert.deepEqual(pathEntryExitPorts(path, 1, EAST, EAST), [WEST, SOUTH]);
  assert.deepEqual(pathEntryExitPorts(path, 2, EAST, EAST), [NORTH, EAST]);
});

function countDistinctRotations(cells: ReturnType<typeof generateLevel>["cells"]): Set<number> {
  const set = new Set<number>();
  for (const line of cells) for (const cell of line) set.add(cell.rotation);
  return set;
}

test("generateLevel は source から sink まで東/南だけで単調に進む経路を1本生成する", () => {
  const source = { col: 0, row: 0 };
  const sink = { col: 5, row: 4 };
  const level = generateLevel(6, 5, source, EAST, sink, EAST, Math.random);

  assert.equal(level.cells.length, 5, "行数はrows");
  assert.equal(level.cells[0].length, 6, "列数はcols");
  assert.ok(sameCoord(level.path[0], source), "経路はsourceから始まる");
  assert.ok(sameCoord(level.path[level.path.length - 1], sink), "経路はsinkで終わる");

  for (let i = 1; i < level.path.length; i++) {
    const prev = level.path[i - 1];
    const curr = level.path[i];
    const movedEast = curr.col === prev.col + 1 && curr.row === prev.row;
    const movedSouth = curr.row === prev.row + 1 && curr.col === prev.col;
    assert.ok(movedEast || movedSouth, "経路の各ステップは東または南への1マス移動のみ");
  }

  // 経路上のマスは、そのマスへの入口/出口方向を実際に実現できる形になっている。
  for (let index = 0; index < level.path.length; index++) {
    const coord = level.path[index];
    const [entry, exit] = pathEntryExitPorts(level.path, index, EAST, EAST);
    const cell = level.cells[coord.row][coord.col];
    assert.equal(
      cell.shape,
      shapeForPorts(entry, exit),
      `(${coord.col},${coord.row}) の形が経路と整合する`,
    );
  }
});

test("generateLevel は同じ random 関数を使えば決定的な結果を返す", () => {
  function fakeRandom(seedValues: number[]): () => number {
    let i = 0;
    return () => seedValues[i++ % seedValues.length];
  }

  const source = { col: 0, row: 0 };
  const sink = { col: 5, row: 4 };
  const seedValues = [0.1, 0.9, 0.2, 0.8, 0.3, 0.7, 0.4, 0.6, 0.05, 0.55, 0.65, 0.75];

  const levelA = generateLevel(6, 5, source, EAST, sink, EAST, fakeRandom(seedValues));
  const levelB = generateLevel(6, 5, source, EAST, sink, EAST, fakeRandom(seedValues));

  assert.deepEqual(levelA.path, levelB.path);
  assert.deepEqual(levelA.cells, levelB.cells);
});

test("random() が常に0を返すとき、経路は東へ進めるだけ進んでから南へ折れる階段状になる", () => {
  const source = { col: 0, row: 0 };
  const sink = { col: 3, row: 2 };
  const level = generateLevel(4, 3, source, EAST, sink, EAST, () => 0);

  assert.deepEqual(level.path, [
    { col: 0, row: 0 },
    { col: 1, row: 0 },
    { col: 2, row: 0 },
    { col: 3, row: 0 },
    { col: 3, row: 1 },
    { col: 3, row: 2 },
  ]);
});

test("generateLevel は経路以外のマスにも常に妥当な shape/rotation を割り当てる", () => {
  const level = generateLevel(
    6,
    5,
    { col: 0, row: 0 },
    EAST,
    { col: 5, row: 4 },
    EAST,
    Math.random,
  );
  for (const line of level.cells) {
    for (const cell of line) {
      assert.ok(cell.shape === "straight" || cell.shape === "elbow");
      assert.ok(cell.rotation >= 0 && cell.rotation <= 3);
    }
  }
  // 非経路マスはランダムなので、ある程度の多様性が出ることを緩く確認する。
  assert.ok(countDistinctRotations(level.cells).size > 1, "回転がすべて同じ値に固定されていない");
});

// 型として Direction を直接使う箇所があることの確認（未使用importの検出目的ではなく、方向値が数値として扱える前提の確認）。
test("Direction は 0〜3 の数値として扱える", () => {
  const directions: Direction[] = [NORTH, EAST, SOUTH, WEST];
  assert.deepEqual(directions, [0, 1, 2, 3]);
});
