import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_HEAT, StrataDrillWorld } from "./world.ts";

const WIDTH = 960;
const HEIGHT = 540;
const FRAME = 1 / 60;
const NO_STEER = { isDrilling: false, steerDir: 0 };
const DRILL_STRAIGHT = { isDrilling: true, steerDir: 0 };

function assertFinite(world: StrataDrillWorld, label: string): void {
  assert.ok(Number.isFinite(world.depth), `${label}: depth`);
  assert.ok(Number.isFinite(world.heat), `${label}: heat`);
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.drillXFrac), `${label}: drillXFrac`);
}

test("起動直後は深度0・熱0・中央位置で始まる", () => {
  const world = new StrataDrillWorld(WIDTH, HEIGHT);

  assert.equal(world.depth, 0);
  assert.equal(world.heat, 0);
  assert.equal(world.score, 0);
  assert.equal(world.drillXFrac, 0.5);
  assert.equal(world.isOver, false);
});

test("ドリルし続けると深度とスコアが進む", () => {
  const world = new StrataDrillWorld(WIDTH, HEIGHT);

  for (let i = 0; i < 30; i++) world.step(FRAME, DRILL_STRAIGHT);

  assert.ok(world.depth > 0, "深度が進む");
  assert.ok(world.score > 0, "スコアが進む");
});

test("ドリルしないと深度は進まず熱は上がらない", () => {
  const world = new StrataDrillWorld(WIDTH, HEIGHT);

  for (let i = 0; i < 30; i++) world.step(FRAME, NO_STEER);

  assert.equal(world.depth, 0, "ドリルしないと深度は進まない");
  assert.equal(world.heat, 0, "ドリルしないと熱は上がらない（既に0で下限）");
});

test("ドリルし続けると熱が上がり、上限でオーバーヒートしてゲームオーバーになる", () => {
  const world = new StrataDrillWorld(WIDTH, HEIGHT);

  let steps = 0;
  while (!world.isOver && steps < 1000) {
    world.step(FRAME, DRILL_STRAIGHT);
    assertFinite(world, "ドリル中");
    steps++;
  }

  assert.equal(world.isOver, true, "熱が上限に達するとゲームオーバーになる");
  assert.equal(world.isOverheated, true, "オーバーヒートが原因だと分かる");
  assert.equal(world.heat, MAX_HEAT, "熱は上限でクランプされる");
});

test("ドリルを止めると熱が下がる", () => {
  const world = new StrataDrillWorld(WIDTH, HEIGHT);

  for (let i = 0; i < 20; i++) world.step(FRAME, DRILL_STRAIGHT);
  const heatedUp = world.heat;
  assert.ok(heatedUp > 0, "ドリル中は熱が上がっている");

  for (let i = 0; i < 20; i++) world.step(FRAME, NO_STEER);
  assert.ok(world.heat < heatedUp, "ドリルを止めると熱が下がる");
});

test("ステア入力でドリルのX位置が動き、0〜1の範囲にクランプされる", () => {
  const world = new StrataDrillWorld(WIDTH, HEIGHT);

  for (let i = 0; i < 10; i++) world.step(FRAME, { isDrilling: false, steerDir: 1 });
  assert.ok(world.drillXFrac > 0.5, "右へステアすると位置が右へ動く");

  for (let i = 0; i < 300; i++) world.step(FRAME, { isDrilling: false, steerDir: 1 });
  assert.equal(world.drillXFrac, 1, "右端でクランプされる");

  for (let i = 0; i < 300; i++) world.step(FRAME, { isDrilling: false, steerDir: -1 });
  assert.equal(world.drillXFrac, 0, "左端でクランプされる");
});

test("鉱石の帯にドリルXが重なって掘り進むと加点され、鉱石は消費される", () => {
  const world = new StrataDrillWorld(WIDTH, HEIGHT);
  world.drillXFrac = 0.5;
  world.features = [
    { id: 1, depth: 1, fromFrac: 0.4, toFrac: 0.6, kind: "ore", isResolved: false },
  ];

  world.step(FRAME, DRILL_STRAIGHT);

  assert.equal(world.isOver, false);
  assert.equal(world.features[0].isResolved, true, "鉱石は採取済みになる");
  assert.equal(world.oreCollected, 1);
  assert.ok(world.score > 0, "加点されている");
});

test("障害物の帯にドリルXが重なって掘り進むとゲームオーバーになる", () => {
  const world = new StrataDrillWorld(WIDTH, HEIGHT);
  world.drillXFrac = 0.5;
  world.features = [
    { id: 1, depth: 1, fromFrac: 0.4, toFrac: 0.6, kind: "hazard", isResolved: false },
  ];

  world.step(FRAME, DRILL_STRAIGHT);

  assert.equal(world.isOver, true, "障害物に当たるとゲームオーバー");
  assert.equal(world.isOverheated, false, "原因は過熱ではない");
});

test("帯の外（ステアして避けた位置）にいれば障害物に当たらない", () => {
  const world = new StrataDrillWorld(WIDTH, HEIGHT);
  world.drillXFrac = 0.9;
  world.features = [
    { id: 1, depth: 1, fromFrac: 0.4, toFrac: 0.6, kind: "hazard", isResolved: false },
  ];

  for (let i = 0; i < 20; i++) world.step(FRAME, DRILL_STRAIGHT);

  assert.equal(world.isOver, false, "帯の外にいれば障害物を避けられる");
});

test("掘り進めるとやがて鉱石/障害物の帯が生成される", () => {
  const world = new StrataDrillWorld(WIDTH, HEIGHT);

  for (let i = 0; i < 600 && !world.isOver; i++) world.step(FRAME, DRILL_STRAIGHT);

  assert.ok(world.features.length > 0, "掘り進めると帯が生成される");
  for (const feature of world.features) {
    assert.ok(feature.fromFrac >= 0 && feature.toFrac <= 1, "帯は画面内の範囲にある");
  }
});

test("reset() で最初の状態に戻る", () => {
  const world = new StrataDrillWorld(WIDTH, HEIGHT);
  for (let i = 0; i < 100 && !world.isOver; i++) world.step(FRAME, DRILL_STRAIGHT);
  assert.ok(world.depth > 0);

  world.reset();

  assert.equal(world.depth, 0);
  assert.equal(world.heat, 0);
  assert.equal(world.score, 0);
  assert.equal(world.oreCollected, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.isOverheated, false);
  assert.equal(world.drillXFrac, 0.5);
  assert.equal(world.features.length, 0);
});

test("ゲームオーバー後に step() を呼んでも状態が変化しない", () => {
  const world = new StrataDrillWorld(WIDTH, HEIGHT);
  let steps = 0;
  while (!world.isOver && steps < 1000) {
    world.step(FRAME, DRILL_STRAIGHT);
    steps++;
  }
  assert.equal(world.isOver, true);

  const scoreAtOver = world.score;
  const depthAtOver = world.depth;
  world.step(FRAME, DRILL_STRAIGHT);
  world.step(FRAME, DRILL_STRAIGHT);

  assert.equal(world.score, scoreAtOver, "ゲームオーバー後はスコアが変化しない");
  assert.equal(world.depth, depthAtOver, "ゲームオーバー後は深度が変化しない");
});

test("画面サイズが変わっても更新が壊れない", () => {
  const world = new StrataDrillWorld(WIDTH, HEIGHT);

  world.resize(375, 720);
  assert.equal(world.width, 375);
  assert.equal(world.height, 720);

  for (let i = 0; i < 60; i++) world.step(FRAME, { isDrilling: true, steerDir: 0.5 });

  assertFinite(world, "リサイズ後");
});
