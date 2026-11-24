import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GRID_COLS,
  GRID_ROWS,
  RAKED_THRESHOLD,
  RING_BAND_RATIO,
  ROUND_SECONDS,
  type Rock,
  SandRippleWorld,
} from "./world.ts";

const WIDTH = 800;
const HEIGHT = 500;
const FRAME = 1 / 60;

/** 石から十分離れた、常に石のない左上の角のピクセル座標。 */
function safeCornerPoint(world: SandRippleWorld): { x: number; y: number } {
  return { x: world.width * 0.03, y: world.height * 0.03 };
}

function cellOf(
  world: SandRippleWorld,
  point: { x: number; y: number },
): { col: number; row: number } {
  return {
    col: Math.floor((point.x / world.width) * GRID_COLS),
    row: Math.floor((point.y / world.height) * GRID_ROWS),
  };
}

/** テスト用に石の配置を1個の既知の円に固定し、当たり判定を再計算させる。 */
function forceSingleRock(world: SandRippleWorld, rock: Rock): void {
  world.rocks = [rock];
  world.resize(world.width, world.height);
}

function assertFinite(world: SandRippleWorld, label: string): void {
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.timeRemaining), `${label}: timeRemaining`);
  assert.ok(Number.isFinite(world.coveragePercent), `${label}: coveragePercent`);
  assert.ok(
    world.coveragePercent >= 0 && world.coveragePercent <= 100,
    `${label}: coveragePercent は0〜100`,
  );
}

test("初期状態: 石が重ならずに配置され、砂はまだ掃かれていない", () => {
  const world = new SandRippleWorld(WIDTH, HEIGHT);

  assert.ok(world.rocks.length > 0, "石が配置されている");
  for (const rock of world.rocks) {
    assert.ok(rock.nx > 0 && rock.nx < 1, "石のx座標が画面内の正規化座標");
    assert.ok(rock.ny > 0 && rock.ny < 1, "石のy座標が画面内の正規化座標");
    assert.ok(rock.nRadius > 0, "石の半径が正の値");
  }
  for (let i = 0; i < world.rocks.length; i++) {
    for (let j = i + 1; j < world.rocks.length; j++) {
      const a = world.rocks[i];
      const b = world.rocks[j];
      const dist = Math.hypot(a.nx - b.nx, a.ny - b.ny);
      assert.ok(dist >= a.nRadius + b.nRadius, "石どうしが重なっていない");
    }
  }

  assert.equal(world.score, 0);
  assert.equal(world.coveragePercent, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.timeRemaining, ROUND_SECONDS);
  assertFinite(world, "初期状態");
});

test("レーキで砂をかくと掃き面積と得点が増え、経路上もまとめて掃かれる", () => {
  const world = new SandRippleWorld(WIDTH, HEIGHT);
  const from = safeCornerPoint(world);
  const to = { x: world.width * 0.2, y: world.height * 0.03 };

  world.rakeStroke(from.x, from.y, to.x, to.y);

  const fromCell = cellOf(world, from);
  const midCell = cellOf(world, { x: (from.x + to.x) / 2, y: from.y });
  assert.ok(
    world.getCellRakedLevel(fromCell.col, fromCell.row) > 0,
    "ストロークの起点が掃かれている",
  );
  assert.ok(world.getCellRakedLevel(midCell.col, midCell.row) > 0, "経路の途中も掃かれている");

  world.step(FRAME);
  assert.ok(world.coveragePercent > 0, "掃き面積が0より大きくなる");
  assert.ok(world.score > 0, "得点が増える");
});

test("掃いた砂は時間が経つと元に戻る", () => {
  const world = new SandRippleWorld(WIDTH, HEIGHT);
  const point = safeCornerPoint(world);
  world.rakeStroke(point.x, point.y, point.x, point.y);
  world.step(FRAME);
  const coverageRightAfterRaking = world.coveragePercent;
  assert.ok(coverageRightAfterRaking > 0, "掃いた直後は面積が増えている");

  // 掃き続けなければ、30秒ぶん経過させると風で元に戻る
  for (let i = 0; i < 30 * 60; i++) world.step(FRAME);

  assert.ok(world.coveragePercent < coverageRightAfterRaking, "掃くのをやめると面積が減っていく");
  const cell = cellOf(world, point);
  assert.ok(
    world.getCellRakedLevel(cell.col, cell.row) < RAKED_THRESHOLD,
    "十分に時間が経てば元の砂に戻る",
  );
  assertFinite(world, "長時間経過後");
});

test("石の上は掃けない", () => {
  const world = new SandRippleWorld(WIDTH, HEIGHT);
  forceSingleRock(world, { nx: 0.5, ny: 0.5, nRadius: 0.1 });
  const rockCircle = world.rockToPixel(world.rocks[0]);

  world.rakeStroke(rockCircle.x, rockCircle.y, rockCircle.x, rockCircle.y);
  world.step(FRAME);

  assert.equal(world.coveragePercent, 0, "石の中心を掃いても面積は増えない");
  const centerCell = cellOf(world, rockCircle);
  assert.ok(world.isCellRock(centerCell.col, centerCell.row), "石の中心のマスは石として扱われる");
  assert.equal(
    world.getCellRakedLevel(centerCell.col, centerCell.row),
    0,
    "石のマスは掃いた状態にならない",
  );
});

test("石のまわり(リングボーナス圏内)を掃くと、同じ量を掃いても得点が多く増える", () => {
  const rock: Rock = { nx: 0.5, ny: 0.5, nRadius: 0.1 };

  const ringWorld = new SandRippleWorld(WIDTH, HEIGHT);
  forceSingleRock(ringWorld, rock);
  const ringCircle = ringWorld.rockToPixel(rock);
  const ringBandPx = RING_BAND_RATIO * Math.min(ringWorld.width, ringWorld.height);
  const ringPoint = { x: ringCircle.x + ringCircle.radius + ringBandPx * 0.5, y: ringCircle.y };
  ringWorld.rakeStroke(ringPoint.x, ringPoint.y, ringPoint.x, ringPoint.y);

  const plainWorld = new SandRippleWorld(WIDTH, HEIGHT);
  forceSingleRock(plainWorld, rock);
  // 石から大きく離れた、リング範囲に入らない場所を同じ要領で掃く
  const plainPoint = safeCornerPoint(plainWorld);
  plainWorld.rakeStroke(plainPoint.x, plainPoint.y, plainPoint.x, plainPoint.y);

  for (let i = 0; i < 60; i++) {
    ringWorld.step(FRAME);
    plainWorld.step(FRAME);
  }

  assert.ok(ringWorld.score > plainWorld.score, "リング範囲を掃いた方が、同じ面積でも得点が多い");
});

test("制限時間が経過するとラウンドが終わり、リセットで最初からになる", () => {
  const world = new SandRippleWorld(WIDTH, HEIGHT);
  const point = safeCornerPoint(world);
  world.rakeStroke(point.x, point.y, point.x, point.y);

  for (let i = 0; i < 1000 && !world.isOver; i++) {
    world.step(0.1);
    assertFinite(world, "ラウンド中");
  }

  assert.equal(world.isOver, true, "ラウンドが終了する");
  assert.equal(world.timeRemaining, 0);

  const frozenScore = world.score;
  world.rakeStroke(point.x, point.y, point.x + 10, point.y);
  world.step(FRAME);
  assert.equal(world.score, frozenScore, "終了後はレーキしても得点が変わらない");

  world.reset();
  assert.equal(world.isOver, false);
  assert.equal(world.score, 0);
  assert.equal(world.coveragePercent, 0);
  assert.equal(world.timeRemaining, ROUND_SECONDS);
});

test("画面サイズが変わっても、かいた模様はそのまま残る", () => {
  const world = new SandRippleWorld(WIDTH, HEIGHT);
  const point = safeCornerPoint(world);
  world.rakeStroke(point.x, point.y, point.x, point.y);
  const cell = cellOf(world, point);
  assert.ok(
    world.getCellRakedLevel(cell.col, cell.row) >= RAKED_THRESHOLD,
    "掃いた直後は十分に掃けている",
  );

  // PC横長 → スマホ縦長のような大きなアスペクト比の変化
  world.resize(360, 760);

  assert.ok(
    world.getCellRakedLevel(cell.col, cell.row) >= RAKED_THRESHOLD,
    "リサイズしても掃いたマスの状態は保持される",
  );
  for (let i = 0; i < 60; i++) world.step(FRAME);
  assertFinite(world, "リサイズ後");
});

test("グリッドの総マス数は画面サイズに関わらず一定", () => {
  const world = new SandRippleWorld(WIDTH, HEIGHT);
  let count = 0;
  world.forEachCell(() => {
    count++;
  });
  assert.equal(count, GRID_COLS * GRID_ROWS);
});
