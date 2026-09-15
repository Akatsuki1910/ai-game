import assert from "node:assert/strict";
import { test } from "node:test";
import { type BowlCompletedEvent, GOLD_MAX, GoldSeamWorld, generateCrackPoints } from "./world.ts";

const WIDTH = 960;
const HEIGHT = 540;
const FRAME = 1 / 60;

function assertFinite(world: GoldSeamWorld, label: string): void {
  assert.ok(Number.isFinite(world.gold), `${label}: gold`);
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.filledLengthPx), `${label}: filledLengthPx`);
  assert.ok(Number.isFinite(world.totalLengthPx), `${label}: totalLengthPx`);
}

/** 先端(frontier)にぴったりポインタを重ねてなぞり続ける、完璧なプレイヤーのシミュレーション。 */
function traceFrontier(world: GoldSeamWorld, frames: number): void {
  for (let i = 0; i < frames; i++) {
    if (world.isOver) return;
    const frontier = world.getFrontierPointPx();
    world.setPointer(frontier.x, frontier.y, true);
    world.step(FRAME);
  }
}

test("起動直後はひびと金粉が揃っている", () => {
  const world = new GoldSeamWorld(WIDTH, HEIGHT);

  assert.ok(world.crackPoints.length >= 2, "ひびは少なくとも始点と終点を持つ");
  assert.ok(world.totalLengthPx > 0, "ひびの総距離が計算されている");
  assert.equal(world.filledLengthPx, 0);
  assert.equal(world.gold, GOLD_MAX);
  assert.equal(world.score, 0);
  assert.equal(world.bowlsCompleted, 0);
  assert.equal(world.isOver, false);
});

test("先端をなぞり続けると進捗が進み、金粉は緩やかに減る", () => {
  const world = new GoldSeamWorld(WIDTH, HEIGHT);
  const goldBefore = world.gold;

  traceFrontier(world, 30);

  assert.ok(world.filledLengthPx > 0, "なぞった分だけ先端が進む");
  assert.ok(world.gold < goldBefore, "金粉が消費される");
  assertFinite(world, "なぞり中");
});

test("先端から大きく外れた位置でなぞると、進捗は進まず金粉だけ速く減る", () => {
  const offPathWorld = new GoldSeamWorld(WIDTH, HEIGHT);
  const offPathGoldBefore = offPathWorld.gold;
  offPathWorld.setPointer(-9999, -9999, true);
  for (let i = 0; i < 5; i++) offPathWorld.step(FRAME);

  assert.equal(offPathWorld.filledLengthPx, 0, "経路から外れていると進捗が進まない");
  const wasted = offPathGoldBefore - offPathWorld.gold;

  const onPathWorld = new GoldSeamWorld(WIDTH, HEIGHT);
  const onPathGoldBefore = onPathWorld.gold;
  traceFrontier(onPathWorld, 5);
  const onPathUsed = onPathGoldBefore - onPathWorld.gold;

  assert.ok(wasted > onPathUsed, "経路を外れると金粉の消費ペースが速い");
});

test("ポインタを押していない間は金粉も進捗も変化しない", () => {
  const world = new GoldSeamWorld(WIDTH, HEIGHT);
  const frontier = world.getFrontierPointPx();
  world.setPointer(frontier.x, frontier.y, false);

  const goldBefore = world.gold;
  const filledBefore = world.filledLengthPx;
  for (let i = 0; i < 60; i++) world.step(FRAME);

  assert.equal(world.gold, goldBefore, "押していなければ金粉は減らない");
  assert.equal(world.filledLengthPx, filledBefore, "押していなければ進捗も進まない");
});

test("ひびをなぞりきると得点が入り、金粉が補充されて新しいひびが生成される", () => {
  const world = new GoldSeamWorld(WIDTH, HEIGHT);
  const firstCrack = world.crackPoints;

  let completedEvent: BowlCompletedEvent | null = null;
  world.onBowlCompleted = (event) => {
    completedEvent = event;
  };

  for (let i = 0; i < 3000 && world.bowlsCompleted === 0 && !world.isOver; i++) {
    const frontier = world.getFrontierPointPx();
    world.setPointer(frontier.x, frontier.y, true);
    world.step(FRAME);
  }

  assert.equal(world.bowlsCompleted, 1, "1つ目のひびをなぞり終えた");
  assert.ok(completedEvent !== null, "完成イベントが発火する");
  const points = completedEvent ? (completedEvent as BowlCompletedEvent).points : 0;
  assert.ok(points > 0, "得点が入っている");
  assert.equal(world.score, points, "スコアに反映される");
  assert.equal(world.filledLengthPx, 0, "新しいひびの進捗は0から始まる");
  assert.notEqual(world.crackPoints, firstCrack, "新しいひびに差し替わる");
  assertFinite(world, "完成後");
});

test("経路から外れ続けると金粉が尽きて終了し、終了後は状態が変化しない", () => {
  const world = new GoldSeamWorld(WIDTH, HEIGHT);
  world.setPointer(-9999, -9999, true);

  for (let i = 0; i < 500 && !world.isOver; i++) world.step(FRAME);

  assert.equal(world.isOver, true, "金粉が尽きると終了する");
  assert.equal(world.gold, 0);

  const scoreAtOver = world.score;
  const filledAtOver = world.filledLengthPx;
  world.setPointer(0, 0, true);
  world.step(FRAME);
  assert.equal(world.score, scoreAtOver, "終了後は得点が変化しない");
  assert.equal(world.filledLengthPx, filledAtOver, "終了後は進捗も変化しない");
});

test("リセットすると最初からやり直せる", () => {
  const world = new GoldSeamWorld(WIDTH, HEIGHT);
  world.setPointer(-9999, -9999, true);
  for (let i = 0; i < 500 && !world.isOver; i++) world.step(FRAME);
  assert.equal(world.isOver, true);

  world.reset();

  assert.equal(world.isOver, false);
  assert.equal(world.gold, GOLD_MAX);
  assert.equal(world.score, 0);
  assert.equal(world.bowlsCompleted, 0);
  assert.equal(world.filledLengthPx, 0);
  assert.ok(world.totalLengthPx > 0);
});

test("画面サイズが変わっても進捗と座標が破綻しない", () => {
  const world = new GoldSeamWorld(WIDTH, HEIGHT);
  traceFrontier(world, 10);
  const progressBefore = world.filledLengthPx;
  assert.ok(progressBefore > 0);

  // PC横長 → スマホ縦長
  world.resize(375, 720);
  assertFinite(world, "リサイズ後");
  assert.ok(world.filledLengthPx <= world.totalLengthPx, "進捗が総距離を超えない");
  for (const p of world.getPathPointsPx()) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), "ひびの座標が有限");
  }

  // 不正なサイズは無視される
  world.resize(0, 0);
  assert.equal(world.width, 375);
  assert.equal(world.height, 720);
});

test("ひび生成は常に境界内に収まる折れ線を返す", () => {
  for (let complexity = 1; complexity <= 7; complexity++) {
    const points = generateCrackPoints(complexity);
    assert.ok(points.length >= 2, "始点と終点を含む");
    for (const p of points) {
      assert.ok(p.xRatio >= 0 && p.xRatio <= 1, "x が0〜1に収まる");
      assert.ok(p.yRatio >= 0 && p.yRatio <= 1, "y が0〜1に収まる");
    }
  }
});
