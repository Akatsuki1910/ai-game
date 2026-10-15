import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GlassTurnWorld,
  LIVES_MAX,
  MAX_RADIUS,
  TARGET_CENTER_MAX,
  TARGET_CENTER_MIN,
} from "./world.ts";

test("初期状態は玉が無く・スコア0・ライフ満タンで、目標帯は有効範囲内", () => {
  const world = new GlassTurnWorld();

  assert.equal(world.radius, 0);
  assert.equal(world.wobble, 0);
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.round, 1);
  assert.equal(world.lives, LIVES_MAX);
  assert.equal(world.isOver, false);
  assert.ok(world.targetCenter >= TARGET_CENTER_MIN && world.targetCenter <= TARGET_CENTER_MAX);
  assert.ok(world.targetMin < world.targetMax);
});

test("送風している間だけ玉が膨らみ、離すと膨らみが止まる", () => {
  const world = new GlassTurnWorld();

  world.setBlowing(true);
  world.step(0.5);
  const grown = world.radius;
  assert.ok(grown > 0, "送風中は玉が膨らむ");

  world.setBlowing(false);
  world.step(0.5);
  assert.equal(world.radius, grown, "送風を止めると膨らみが止まる");
});

test("送風しながら転がさないと歪み(wobble)が増え、転がすと収まる", () => {
  const world = new GlassTurnWorld();

  world.setBlowing(true);
  world.step(0.2);
  const wobbleWithoutRolling = world.wobble;
  assert.ok(wobbleWithoutRolling > 0, "転がさずに送風すると歪みが増える");

  world.registerRoll();
  world.step(0.2);
  assert.ok(world.wobble < wobbleWithoutRolling, "転がすと歪みが収まっていく");
});

test("転がさずに送風し続けると歪みが限界に達して崩れ、ライフが減って次のラウンドに進む", () => {
  const world = new GlassTurnWorld();
  let failed: { round: number; reason: string } | null = null;
  world.onFail = (event) => {
    failed = event;
  };

  world.setBlowing(true);
  for (let i = 0; i < 200 && !world.isOver && world.wobble < 1; i++) {
    world.step(1 / 60);
  }

  assert.ok(failed, "onFailが発火する");
  assert.equal((failed as { reason: string }).reason, "collapsed");
  assert.equal(world.lives, LIVES_MAX - 1);
  assert.equal(world.combo, 0);
  assert.equal(world.round, 2, "失敗しても次のラウンドに進む");
  assert.equal(world.radius, 0, "新しい玉は膨らみ0から始まる");
});

test("膨らませすぎると上限でポンと割れ、ライフが減る", () => {
  const world = new GlassTurnWorld();
  let failed: { round: number; reason: string } | null = null;
  world.onFail = (event) => {
    failed = event;
  };

  world.setBlowing(true);
  for (let i = 0; i < 2000 && !world.isOver && world.radius < MAX_RADIUS; i++) {
    world.registerRoll(); // 歪みで先に崩れないよう、都度転がして割れる条件だけを検証する
    world.step(1 / 60);
  }

  assert.ok(failed, "onFailが発火する");
  assert.equal((failed as { reason: string }).reason, "popped");
  assert.equal(world.lives, LIVES_MAX - 1);
});

test("目標帯の中でfinish()すると高得点になり、コンボが伸びて次のラウンドに進む", () => {
  const world = new GlassTurnWorld();
  let finished: { result: string; points: number } | null = null;
  world.onFinish = (event) => {
    finished = event;
  };

  world.setBlowing(true);
  const target = world.targetCenter;
  for (let i = 0; i < 2000 && world.radius < target; i++) {
    world.registerRoll();
    world.step(1 / 60);
  }

  const result = world.finish();

  assert.equal(result, "onTarget");
  assert.ok(finished);
  assert.equal((finished as { result: string }).result, "onTarget");
  assert.ok((finished as { points: number }).points > 0);
  assert.equal(world.score, (finished as { points: number }).points);
  assert.equal(world.combo, 1);
  assert.equal(world.round, 2);
});

test("目標帯の外でfinish()すると加点は少なく、コンボはリセットされる", () => {
  const world = new GlassTurnWorld();

  const result = world.finish(); // 膨らませる前(radius=0)はほぼ必ず目標帯の外

  assert.equal(result, "offSpec");
  assert.ok(world.score >= 0);
  assert.equal(world.combo, 0);
});

test("連続で目標帯に収めるとコンボボーナスで加点が増えていく", () => {
  const world = new GlassTurnWorld();

  function blowToTarget(): number {
    world.setBlowing(true);
    const target = world.targetCenter;
    for (let i = 0; i < 2000 && world.radius < target; i++) {
      world.registerRoll();
      world.step(1 / 60);
    }
    let points = 0;
    world.onFinish = (event) => {
      points = event.points;
    };
    const result = world.finish();
    assert.equal(result, "onTarget", "このテストでは毎回目標帯に収める前提");
    return points;
  }

  const firstPoints = blowToTarget();
  const secondPoints = blowToTarget();

  assert.ok(secondPoints > firstPoints, "2回目はコンボボーナスが乗って加点が増える");
});

test("ライフが0になるとゲームオーバーになり、以降は操作が無効になる", () => {
  const world = new GlassTurnWorld();

  for (let i = 0; i < LIVES_MAX && !world.isOver; i++) {
    world.setBlowing(true);
    for (let step = 0; step < 200 && !world.isOver && world.wobble < 1; step++) {
      world.step(1 / 60);
    }
  }

  assert.equal(world.isOver, true);
  assert.equal(world.lives, 0);

  const scoreBefore = world.score;
  const roundBefore = world.round;
  world.setBlowing(true);
  world.registerRoll();
  world.step(1);
  assert.equal(world.score, scoreBefore, "ゲームオーバー後はstepしても状態が変化しない");
  assert.equal(world.round, roundBefore);
  assert.equal(world.finish(), null, "ゲームオーバー後のfinish()は無効");
});

test("reset()で最初の状態に戻る", () => {
  const world = new GlassTurnWorld();
  world.setBlowing(true);
  world.step(1);
  world.finish();

  world.reset();

  assert.equal(world.radius, 0);
  assert.equal(world.wobble, 0);
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.round, 1);
  assert.equal(world.lives, LIVES_MAX);
  assert.equal(world.isOver, false);
});

test("ラウンドが進むほど目標帯が狭くなる(難易度上昇)", () => {
  const world = new GlassTurnWorld();
  const initialHalfWidth = world.bandHalfWidth;

  for (let i = 0; i < 5; i++) {
    world.setBlowing(true);
    const target = world.targetCenter;
    for (let step = 0; step < 2000 && world.radius < target; step++) {
      world.registerRoll();
      world.step(1 / 60);
    }
    world.finish();
  }

  assert.ok(world.bandHalfWidth < initialHalfWidth, "目標帯が狭くなっている");
});
