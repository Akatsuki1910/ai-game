import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_LIVES, type Obstacle, StrokeRateWorld } from "./world.ts";

const FRAME = 1 / 60;

function assertFinite(world: StrokeRateWorld, label: string): void {
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.lives), `${label}: lives`);
  assert.ok(Number.isFinite(world.boatX), `${label}: boatX`);
  assert.ok(Number.isFinite(world.rhythm), `${label}: rhythm`);
  assert.ok(Number.isFinite(world.distanceTraveled), `${label}: distanceTraveled`);
  for (const obstacle of world.obstacles) {
    assert.ok(
      Number.isFinite(obstacle.trackDistance) && Number.isFinite(obstacle.laneX),
      `${label}: obstacle`,
    );
  }
}

test("起動直後は待機状態・満タンのライフ・レーン中央・障害物が配置されている", () => {
  const world = new StrokeRateWorld();

  assert.equal(world.lives, MAX_LIVES);
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.boatX, 0.5);
  assert.ok(world.obstacles.length >= 1, "障害物が先に配置されている");
  assertFinite(world, "起動直後");
});

test("最初のストロークは first 判定で、コンボ・リズムを変えずに艇を操舵する", () => {
  const world = new StrokeRateWorld();
  const resolved: string[] = [];
  world.onStrokeResolved = (event) => resolved.push(event.judgement);

  const boatXBefore = world.boatX;
  world.stroke("left");

  assert.deepEqual(resolved, ["first"]);
  assert.equal(world.combo, 0, "最初のストロークはコンボを増やさない");
  assert.equal(world.rhythm, 0, "最初のストロークはリズムを増やさない");
  assert.notEqual(world.boatX, boatXBefore, "ストロークすると艇の左右位置が変わる");
});

test("適切な間隔で左右交互に漕ぐと good 判定になりコンボとリズムが伸びる", () => {
  const world = new StrokeRateWorld();
  world.obstacles = [];
  const resolved: string[] = [];
  world.onStrokeResolved = (event) => resolved.push(event.judgement);

  world.stroke("left");
  world.step(0.4);
  world.stroke("right");
  world.step(0.4);
  world.stroke("left");

  assert.deepEqual(resolved, ["first", "good", "good"]);
  assert.equal(world.combo, 2);
  assert.ok(world.rhythm > 0, "リズムが伸びる");
});

test("同じ側を連続で漕ぐと bad 判定になりコンボが切れる(ただし操舵には使える)", () => {
  const world = new StrokeRateWorld();
  world.obstacles = [];

  world.stroke("left");
  world.step(0.4);
  world.stroke("right");
  world.step(0.4);
  const comboBeforeBad = world.combo;
  assert.ok(comboBeforeBad > 0);

  const boatXBeforeBad = world.boatX;
  world.step(0.4);
  world.stroke("right"); // 連続で右(交互になっていない)
  assert.equal(world.combo, 0, "交互でない漕ぎでコンボが切れる");
  assert.notEqual(world.boatX, boatXBeforeBad, "bad判定でも艇は押され、操舵として使える");
});

test("間隔が短すぎる・長すぎると交互でも bad 判定になる", () => {
  const tooFastWorld = new StrokeRateWorld();
  tooFastWorld.obstacles = [];
  tooFastWorld.stroke("left");
  tooFastWorld.step(0.01); // MIN_STROKE_GAP_SECONDS(0.12)未満
  const resolvedFast: string[] = [];
  tooFastWorld.onStrokeResolved = (event) => resolvedFast.push(event.judgement);
  tooFastWorld.stroke("right");
  assert.deepEqual(resolvedFast, ["bad"], "速すぎる連打はbad判定");

  const tooSlowWorld = new StrokeRateWorld();
  tooSlowWorld.obstacles = [];
  tooSlowWorld.stroke("left");
  tooSlowWorld.step(5); // BASE_MAX_GAP_SECONDS(1.1)を大きく超える
  const resolvedSlow: string[] = [];
  tooSlowWorld.onStrokeResolved = (event) => resolvedSlow.push(event.judgement);
  tooSlowWorld.stroke("right");
  assert.deepEqual(resolvedSlow, ["bad"], "遅すぎる間隔もbad判定");
});

test("リズムが高いほど艇の速度(boatSpeed)が速い", () => {
  const slow = new StrokeRateWorld();
  const fast = new StrokeRateWorld();
  fast.rhythm = 1;

  assert.ok(fast.boatSpeed > slow.boatSpeed, "リズムが高い方が速い");
});

test("何もせず時間が経つとリズムが減衰し、速度が落ちる", () => {
  const world = new StrokeRateWorld();
  world.obstacles = [];
  world.rhythm = 1;

  const speedBefore = world.boatSpeed;
  for (let i = 0; i < 120; i++) world.step(FRAME); // 2秒分
  assert.ok(world.rhythm < 1, "何もしないとリズムが減衰する");
  assert.ok(world.boatSpeed < speedBefore, "リズムが落ちると速度も落ちる");
});

test("進んだ距離に応じて許容される間隔が狭くなる(難易度上昇)", () => {
  const world = new StrokeRateWorld();
  world.obstacles = [];

  // 開始直後は gap=0.9秒でも good になる
  world.stroke("left");
  world.step(0.9);
  const resolvedEarly: string[] = [];
  world.onStrokeResolved = (event) => resolvedEarly.push(event.judgement);
  world.stroke("right");
  assert.deepEqual(resolvedEarly, ["good"], "開始直後は0.9秒間隔でもgood");

  // 十分に進んだ後は同じ0.9秒間隔がbadになる
  world.distanceTraveled = 500;
  world.step(0.9);
  const resolvedLate: string[] = [];
  world.onStrokeResolved = (event) => resolvedLate.push(event.judgement);
  world.stroke("left");
  assert.deepEqual(resolvedLate, ["bad"], "十分進むと同じ間隔でもbadになる(窓が狭くなった)");
});

test("障害物に当たるとライフが減りコンボ・リズムが落ちる", () => {
  const world = new StrokeRateWorld();
  world.rhythm = 1;
  const hitObstacle: Obstacle = {
    id: 999,
    trackDistance: 0,
    laneX: world.boatX,
    radius: 0.05,
    resolved: false,
  };
  world.obstacles = [hitObstacle];
  const collisions: number[] = [];
  world.onCollision = (event) => collisions.push(event.livesRemaining);

  world.step(FRAME);

  assert.deepEqual(collisions, [MAX_LIVES - 1]);
  assert.equal(world.lives, MAX_LIVES - 1, "衝突するとライフが減る");
  assert.equal(world.combo, 0);
  assert.ok(world.rhythm < 1, "衝突するとリズムが落ちる");
});

test("障害物を避けて通過するとスコアにボーナスが入る", () => {
  const world = new StrokeRateWorld();
  const missObstacle: Obstacle = {
    id: 998,
    trackDistance: 0,
    laneX: Math.min(1, world.boatX + 0.4),
    radius: 0.05,
    resolved: false,
  };
  world.obstacles = [missObstacle];

  world.step(FRAME);

  assert.equal(world.lives, MAX_LIVES, "避ければライフは減らない");
  assert.ok(world.score > 0, "避けるとボーナス得点が入る");
});

test("ライフが尽きるとゲームオーバーになり、以後の操作は無視される", () => {
  const world = new StrokeRateWorld();

  for (let i = 0; i < MAX_LIVES; i++) {
    world.obstacles = [
      { id: 100 + i, trackDistance: 0, laneX: world.boatX, radius: 0.05, resolved: false },
    ];
    world.step(FRAME);
  }

  assert.equal(world.isOver, true);
  assert.equal(world.lives, 0);

  const scoreAtGameOver = world.score;
  world.stroke("left");
  world.step(FRAME);
  assert.equal(world.score, scoreAtGameOver, "ゲームオーバー後は状態が変わらない");
});

test("リスタートで最初の状態に戻る", () => {
  const world = new StrokeRateWorld();
  world.stroke("left");
  world.step(1);
  world.stroke("right");
  world.step(1);

  world.reset();

  assert.equal(world.lives, MAX_LIVES);
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.boatX, 0.5);
  assert.equal(world.rhythm, 0);
  assert.equal(world.lastStrokeSide, null);
});

test("時間が経っても座標・数値が有限のまま動き続ける", () => {
  const world = new StrokeRateWorld();
  let side: "left" | "right" = "left";
  for (let i = 0; i < 600; i++) {
    world.step(FRAME);
    if (i % 20 === 0) {
      world.stroke(side);
      side = side === "left" ? "right" : "left";
    }
  }
  assertFinite(world, "長時間経過後");
});
