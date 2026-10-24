import assert from "node:assert/strict";
import { test } from "node:test";
import { LIVES_MAX, MothLanternWorld } from "./world.ts";

const WIDTH = 900;
const HEIGHT = 600;
const FRAME = 1 / 60;

function assertFinite(world: MothLanternWorld, label: string): void {
  assert.ok(
    Number.isFinite(world.lantern.x) && Number.isFinite(world.lantern.y),
    `${label}: ランタン位置`,
  );
  for (const moth of world.moths) {
    assert.ok(Number.isFinite(moth.x) && Number.isFinite(moth.y), `${label}: 蛾の位置`);
  }
  for (const wisp of world.wisps) {
    assert.ok(Number.isFinite(wisp.x) && Number.isFinite(wisp.y), `${label}: 鬼火の位置`);
  }
}

test("起動直後はランタンが下寄りの中央にあり、ライフは満タン、蛾も鬼火もまだいない", () => {
  const world = new MothLanternWorld(WIDTH, HEIGHT);

  assert.equal(world.lives, LIVES_MAX);
  assert.equal(world.delivered, 0);
  assert.equal(world.lostCount, 0);
  assert.equal(world.moths.length, 0);
  assert.equal(world.wisps.length, 0, "鬼火は序盤は出現しない（猶予期間）");
  assert.equal(world.isOver, false);
});

test("ドラッグ先の方向へランタンが移動し、画面外には出ない", () => {
  const world = new MothLanternWorld(WIDTH, HEIGHT);
  const startX = world.lantern.x;

  world.setMoveTarget(-9999, -9999);
  for (let i = 0; i < 90; i++) world.step(FRAME);

  assert.ok(world.lantern.x < startX, "目標方向（左）へ移動している");
  assert.ok(world.lantern.x >= world.lanternMarkerRadius - 0.01, "左端からはみ出さない");
  assert.ok(world.lantern.y >= world.lanternMarkerRadius - 0.01, "上端からはみ出さない");
  assertFinite(world, "移動後");
});

test("キーボード入力でもランタンが移動する", () => {
  const world = new MothLanternWorld(WIDTH, HEIGHT);
  const startX = world.lantern.x;

  world.setKeyboardDirection(1, 0);
  for (let i = 0; i < 10; i++) world.step(FRAME);

  assert.ok(world.lantern.x > startX, "右方向のキー入力で右へ移動する");
});

test("光に当たった蛾は導かれて祠へ向かい、届くと届けた数が増える", () => {
  const world = new MothLanternWorld(WIDTH, HEIGHT);
  world.lantern = { x: world.shrineX, y: world.shrineY };
  world.moths.push({
    id: 9001,
    x: world.shrineX + 60,
    y: world.shrineY,
    angle: 0,
    isLit: false,
    isGuided: false,
    timeInDark: 0,
  });

  const delivered: number[] = [];
  world.onMothDelivered = ({ moth }) => delivered.push(moth.id);

  world.step(FRAME);
  assert.equal(world.moths[0].isGuided, true, "ランタンの光に当たると導かれた状態になる");

  for (let i = 0; i < 300 && delivered.length === 0; i++) {
    world.step(FRAME);
    assertFinite(world, "導いている最中");
  }

  assert.equal(delivered.length, 1, "光の中にいる蛾は祠まで導かれて届く");
  assert.equal(world.delivered, 1);
  assert.equal(world.moths.length, 0);
  assert.equal(world.lives, LIVES_MAX, "届けただけではライフは減らない");
});

test("一度導かれた蛾は光が離れても祠へ進み続け、鬼火にも襲われない", () => {
  const world = new MothLanternWorld(WIDTH, HEIGHT);
  world.lantern = { x: world.shrineX, y: world.shrineY };
  world.moths.push({
    id: 9010,
    x: world.shrineX + 60,
    y: world.shrineY,
    angle: 0,
    isLit: false,
    isGuided: false,
    timeInDark: 0,
  });

  world.step(FRAME);
  assert.equal(world.moths[0].isGuided, true, "光に当たって導かれた");

  // ランタンを遠くへ離し、蛾の真上に鬼火を置く
  world.lantern = { x: 10, y: 10 };
  const mothPos = { x: world.moths[0].x, y: world.moths[0].y };
  world.wisps = [{ id: 9011, x: mothPos.x, y: mothPos.y, angle: 0 }];

  const lost: string[] = [];
  world.onMothLost = ({ cause }) => lost.push(cause);

  for (let i = 0; i < 60; i++) world.step(FRAME);

  assert.equal(lost.length, 0, "導かれた蛾は鬼火に重なっても失われない");
  assert.ok(world.moths.length <= 1, "蛾は迷いもしない（配達済みなら消える）");
});

test("光の外に長く放置した蛾は迷ってしまい、ライフが減る", () => {
  const world = new MothLanternWorld(WIDTH, HEIGHT);
  world.lantern = { x: 10, y: 10 };
  world.wisps = [];
  world.moths.push({
    id: 9002,
    x: world.width - 10,
    y: world.height - 10,
    angle: 0,
    isLit: false,
    isGuided: false,
    timeInDark: 0,
  });

  const lost: string[] = [];
  world.onMothLost = ({ cause }) => lost.push(cause);

  for (let i = 0; i < 1200 && lost.length === 0; i++) {
    world.step(FRAME);
    assertFinite(world, "迷っている最中");
  }

  assert.equal(lost.length, 1, "光に当たらない蛾は一定時間で迷ってしまう");
  assert.equal(lost[0], "stray");
  assert.equal(world.lostCount, 1);
  assert.equal(world.lives, LIVES_MAX - 1);
});

test("鬼火が未照射の蛾に重なると、即座に捕まってライフが減る", () => {
  const world = new MothLanternWorld(WIDTH, HEIGHT);
  world.lantern = { x: 10, y: 10 };
  world.wisps = [{ id: 9100, x: 400, y: 300, angle: 0 }];
  world.moths.push({
    id: 9003,
    x: 400,
    y: 300,
    angle: 0,
    isLit: false,
    isGuided: false,
    timeInDark: 0,
  });

  const lost: string[] = [];
  world.onMothLost = ({ cause }) => lost.push(cause);

  world.step(FRAME);

  assert.equal(lost.length, 1, "鬼火と重なった未照射の蛾はすぐに失われる");
  assert.equal(lost[0], "wisp");
  assert.equal(world.lostCount, 1);
  assert.equal(world.lives, LIVES_MAX - 1);
});

test("ライフが尽きるとゲームオーバーになり、進行が止まる", () => {
  const world = new MothLanternWorld(WIDTH, HEIGHT);
  world.lantern = { x: 10, y: 10 };
  world.wisps = [{ id: 9200, x: 400, y: 300, angle: 0 }];

  for (let round = 0; round < LIVES_MAX; round++) {
    world.moths.push({
      id: 9300 + round,
      x: 400,
      y: 300,
      angle: 0,
      isLit: false,
      isGuided: false,
      timeInDark: 0,
    });
    world.step(FRAME);
  }

  assert.equal(world.lives, 0);
  assert.equal(world.isOver, true, "ライフが尽きるとゲームオーバーになる");

  const scoreAfterOver = world.score;
  world.moths.push({
    id: 9999,
    x: world.shrineX,
    y: world.shrineY,
    angle: 0,
    isLit: false,
    isGuided: false,
    timeInDark: 0,
  });
  world.step(FRAME);
  assert.equal(world.score, scoreAfterOver, "ゲームオーバー後は状態が変化しない");
  assert.equal(world.moths.length, 1, "ゲームオーバー後は蛾も動かない・消化されない");

  world.reset();
  assert.equal(world.isOver, false);
  assert.equal(world.lives, LIVES_MAX);
  assert.equal(world.moths.length, 0);
});

test("時間が経つと蛾が自動的に出現する", () => {
  const world = new MothLanternWorld(WIDTH, HEIGHT);
  for (let i = 0; i < 180; i++) world.step(FRAME);
  assert.ok(world.moths.length > 0, "3秒以上経てば少なくとも1体は出現している");
});

test("時間が経つと鬼火が出現し、最大数まで増える", () => {
  const world = new MothLanternWorld(WIDTH, HEIGHT);
  world.lives = 9999; // このテストは鬼火の出現タイマーだけを見るため、ライフ切れで止まらないようにする
  const totalSeconds = 90;
  for (let i = 0; i < totalSeconds / FRAME; i++) world.step(FRAME);
  assert.ok(world.wisps.length > 0, "猶予期間のあと鬼火が出現している");
  assertFinite(world, "長時間経過後");
});

test("画面サイズが変わってもランタンが画面内に収まる", () => {
  const world = new MothLanternWorld(WIDTH, HEIGHT);

  world.resize(390, 780);
  assert.ok(world.lantern.x >= 0 && world.lantern.x <= 390, "ランタンが画面内(横)");
  assert.ok(world.lantern.y >= 0 && world.lantern.y <= 780, "ランタンが画面内(縦)");

  for (let i = 0; i < 60; i++) world.step(FRAME);
  assertFinite(world, "リサイズ後");
});
