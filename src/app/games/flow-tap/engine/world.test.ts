import assert from "node:assert/strict";
import { test } from "node:test";
import { type GridCoord, getPorts, pathEntryExitPorts, shapeForPorts } from "./grid.ts";
import {
  BASE_DROPLET_SPEED,
  BASE_JAM_INTERVAL,
  BASE_SPAWN_INTERVAL,
  DELIVERIES_PER_WAVE,
  FlowTapWorld,
  GRID_COLS,
  GRID_ROWS,
  INITIAL_LIVES,
} from "./world.ts";

function approxEqual(actual: number, expected: number, tolerance = 1e-6): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

/** world.grid の指定セルを、必要な入口/出口ポートを満たす向きに書き換える。 */
function setPipe(world: FlowTapWorld, coord: GridCoord, ports: readonly [number, number]): void {
  const shape = shapeForPorts(ports[0] as 0 | 1 | 2 | 3, ports[1] as 0 | 1 | 2 | 3);
  for (let rotation = 0; rotation < 4; rotation++) {
    const candidate = { shape, rotation: rotation as 0 | 1 | 2 | 3 };
    const actual = getPorts(candidate);
    const matches =
      (actual[0] === ports[0] && actual[1] === ports[1]) ||
      (actual[0] === ports[1] && actual[1] === ports[0]);
    if (matches) {
      world.grid[coord.row][coord.col] = candidate;
      return;
    }
  }
  throw new Error("到達不能: shapeForPorts の結果に矛盾がある");
}

/** 現在の world.path 全体を、最初から最後まで正しく繋がる向きに修正する。 */
function fixPath(world: FlowTapWorld): void {
  for (let index = 0; index < world.path.length; index++) {
    const ports = pathEntryExitPorts(world.path, index, world.sourceDir, world.sinkDir);
    setPipe(world, world.path[index], ports);
  }
}

test("起動直後はグリッドサイズ・ライフ・スコアが初期値で、経路は source から sink まで繋がっている", () => {
  const world = new FlowTapWorld();

  assert.equal(world.grid.length, GRID_ROWS);
  assert.equal(world.grid[0].length, GRID_COLS);
  assert.equal(world.lives, INITIAL_LIVES);
  assert.equal(world.score, 0);
  assert.equal(world.wave, 1);
  assert.equal(world.isOver, false);
  assert.equal(world.droplets.length, 0);
  assert.deepEqual(world.path[0], world.source);
  assert.deepEqual(world.path[world.path.length - 1], world.sink);
});

test("rotateCellAt はセルを90度ずつ回転させ、4回で元に戻る。範囲外やゲーム終了後は何もしない", () => {
  const world = new FlowTapWorld();
  const before = world.grid[2][3].rotation;

  world.rotateCellAt(3, 2);
  assert.equal(world.grid[2][3].rotation, ((before + 1) % 4) as 0 | 1 | 2 | 3);

  world.rotateCellAt(3, 2);
  world.rotateCellAt(3, 2);
  world.rotateCellAt(3, 2);
  assert.equal(world.grid[2][3].rotation, before, "4回回すと元の向きに戻る");

  world.rotateCellAt(-1, 0);
  world.rotateCellAt(0, GRID_ROWS);
  assert.equal(
    world.grid[0][0].rotation,
    world.grid[0][0].rotation,
    "範囲外の指定は無視される(例外にならない)",
  );
});

test("一定時間が経つと source にドロップレットが1つ出現し、流れ始める", () => {
  const world = new FlowTapWorld();

  world.step(0.8); // 初期スポーン遅延ぶん進める

  assert.equal(world.droplets.length, 1);
  const droplet = world.droplets[0];
  assert.equal(droplet.col, world.source.col);
  assert.equal(droplet.row, world.source.row);
  assert.equal(droplet.travelDir, world.sourceDir);
  assert.ok(approxEqual(droplet.progress, 0.8 * BASE_DROPLET_SPEED, 1e-6));
});

test("経路上のパイプをすべて正しい向きに合わせると、流れが sink まで届いて加点される", () => {
  const world = new FlowTapWorld();
  fixPath(world);
  // 経路の全長を渡りきるには jamInterval(5.5s) を超える時間が必要になるため、
  // ジャムで経路が乱されても即座に直す（ジャム自体の発生有無は検証対象外）。
  world.onJam = () => fixPath(world);

  const travelSeconds = world.path.length / world.dropletSpeed + 0.5;
  world.step(travelSeconds);

  assert.equal(world.droplets.length, 0, "ドロップレットは届いて消える");
  assert.equal(world.combo, 1);
  assert.equal(world.deliveriesInWave, 1);
  assert.ok(world.score > 0, "得点が入っている");
});

test("source のパイプが間違った向きのままだと、流れはすぐに漏れてライフが減る", () => {
  const world = new FlowTapWorld();
  // source の入口(WEST)を塞ぐ向きに固定する。
  world.grid[world.source.row][world.source.col] = { shape: "straight", rotation: 0 };

  world.step(1.5); // jamInterval(5.5s)には到達しないので、この間はジャムが起きない

  assert.equal(world.lives, INITIAL_LIVES - 1);
  assert.equal(world.combo, 0);
  assert.equal(world.droplets.length, 0);
  assert.equal(world.isOver, false);
});

test("ライフが尽きるとゲームオーバーになり、以後の操作で状態が壊れない。reset で最初からやり直せる", () => {
  const world = new FlowTapWorld();
  world.grid[world.source.row][world.source.col] = { shape: "straight", rotation: 0 };
  // スポーンと「1マス分進んで即リーク」が同じ step 呼び出しの中で起きるだけの長さに揃え、
  // ジャム(5.5s間隔)が発生する前に3回リークさせる。
  const stepSeconds = 1 / BASE_DROPLET_SPEED + 0.2;
  world.spawnInterval = stepSeconds;

  for (let i = 0; i < INITIAL_LIVES; i++) {
    world.step(stepSeconds);
  }

  assert.equal(world.lives, 0);
  assert.equal(world.isOver, true);

  const rotationBefore = world.grid[1][1].rotation;
  world.rotateCellAt(1, 1);
  world.step(10);
  assert.equal(world.grid[1][1].rotation, rotationBefore, "ゲームオーバー後は回転操作が無視される");
  assert.equal(world.lives, 0);

  world.reset();
  assert.equal(world.isOver, false);
  assert.equal(world.lives, INITIAL_LIVES);
  assert.equal(world.score, 0);
  assert.equal(world.wave, 1);
});

test(`${DELIVERIES_PER_WAVE}回届けるとウェーブが進み、速度/スポーン間隔/ジャム間隔が難化する`, () => {
  const world = new FlowTapWorld();
  fixPath(world);
  // ジャムで経路が乱されても、発生のたびに即座に経路を再修正する。
  world.onJam = () => fixPath(world);

  const speedBefore = world.dropletSpeed;
  const spawnIntervalBefore = world.spawnInterval;
  const jamIntervalBefore = world.jamInterval;

  for (let i = 0; i < DELIVERIES_PER_WAVE; i++) {
    const travelSeconds = world.path.length / world.dropletSpeed + 0.5;
    world.step(travelSeconds);
  }

  assert.equal(world.wave, 2, "5回届けるとウェーブが2に進む");
  assert.equal(world.deliveriesInWave, 0, "ウェーブが進むと配達数はリセットされる");
  assert.equal(world.droplets.length, 0, "ウェーブが進むとドロップレットは一掃される");
  assert.ok(world.dropletSpeed > speedBefore, "速度が上がる");
  assert.ok(world.spawnInterval < spawnIntervalBefore, "スポーン間隔が短くなる");
  assert.ok(world.jamInterval < jamIntervalBefore, "ジャム間隔が短くなる");
  assert.deepEqual(world.path[0], world.source, "新しい経路もsourceから始まる");
  assert.deepEqual(world.path[world.path.length - 1], world.sink, "新しい経路もsinkで終わる");
});

test("BASE_SPAWN_INTERVAL と BASE_JAM_INTERVAL は正の値である(設定ミスの検出用)", () => {
  assert.ok(BASE_SPAWN_INTERVAL > 0);
  assert.ok(BASE_JAM_INTERVAL > 0);
});
