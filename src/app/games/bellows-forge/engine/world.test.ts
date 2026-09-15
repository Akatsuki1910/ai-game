import assert from "node:assert/strict";
import { test } from "node:test";
import { BELLOWS_FORGE_START_QUALITY, BellowsForgeWorld } from "./world.ts";

const TINY_FRAME = 1 / 240;

function assertFinite(world: BellowsForgeWorld, label: string): void {
  assert.ok(Number.isFinite(world.temperature), `${label}: temperature`);
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.round), `${label}: round`);
  assert.ok(Number.isFinite(world.quality), `${label}: quality`);
  assert.ok(world.temperature >= 0 && world.temperature <= 100, `${label}: temperature range`);
}

/** 目標帯のちょうど中心まで温度を送風で持っていく。 */
function pumpToBandCenter(world: BellowsForgeWorld): void {
  const center = (world.targetMin + world.targetMax) / 2;
  world.startPumping();
  while (world.temperature < center) {
    world.step(TINY_FRAME);
  }
  world.stopPumping();
}

test("開始直後はラウンド1・満タンの品質で、常温から始まる", () => {
  const world = new BellowsForgeWorld();

  assert.equal(world.round, 1);
  assert.equal(world.score, 0);
  assert.equal(world.quality, BELLOWS_FORGE_START_QUALITY);
  assert.equal(world.isOver, false);
  assert.ok(world.targetMax > world.targetMin, "目標帯の上限は下限より大きい");
  assertFinite(world, "開始直後");
});

test("何もしないと温度は自然に下がり続ける", () => {
  const world = new BellowsForgeWorld();
  const before = world.temperature;
  for (let i = 0; i < 120; i++) world.step(TINY_FRAME);
  assert.ok(world.temperature < before, "放置すると温度が下がる");
  assertFinite(world, "放置後");
});

test("送風し続けると温度が上がり、TEMPERATURE_MAXで頭打ちになる", () => {
  const world = new BellowsForgeWorld();
  world.startPumping();
  for (let i = 0; i < 2000; i++) world.step(TINY_FRAME);
  assert.ok(world.temperature <= 100, "温度は100を超えない");
  assertFinite(world, "送風しっぱなし後");
});

test("送風しすぎて上限に達すると焦げつき、品質が減って温度が下がる", () => {
  const world = new BellowsForgeWorld();
  const scorches: Array<{ round: number }> = [];
  world.onScorch = (event) => scorches.push(event);
  const qualityBefore = world.quality;

  world.startPumping();
  for (let i = 0; i < 2000 && scorches.length === 0; i++) world.step(TINY_FRAME);

  assert.equal(scorches.length, 1, "焦げつきイベントが1回発火する");
  assert.equal(world.quality, qualityBefore - 1, "焦げつくと品質が1減る");
  assert.ok(world.temperature < 100, "焦げついた後は温度が下がる");
  assertFinite(world, "焦げつき後");
});

test("目標帯の中心で打つと成功し、精度ボーナスが最大になる", () => {
  const world = new BellowsForgeWorld();
  pumpToBandCenter(world);

  const strikes: Array<{ isSuccess: boolean; precisionRatio: number; scoreGained: number }> = [];
  world.onStrike = (event) => strikes.push(event);
  const hitsBefore = world.hitsLanded;
  world.strike();

  assert.equal(strikes.length, 1);
  assert.equal(strikes[0].isSuccess, true, "帯の中心は成功打");
  assert.ok(strikes[0].precisionRatio > 0.9, "中心付近なので精度はほぼ最大");
  assert.ok(strikes[0].scoreGained > 0, "成功打はスコアが増える");
  assert.equal(world.hitsLanded, hitsBefore + 1, "成功打でヒット数が進む");
  assertFinite(world, "中心打後");
});

test("温度が低すぎるうちに打つと失敗するが、まだ形にならないだけで品質は減らない", () => {
  const world = new BellowsForgeWorld();
  const strikes: Array<{ isSuccess: boolean; isTooCold: boolean }> = [];
  world.onStrike = (event) => strikes.push(event);
  const qualityBefore = world.quality;
  const hitsBefore = world.hitsLanded;

  assert.ok(world.temperature < world.targetMin, "前提: 開始温度は帯より低い");
  world.strike();

  assert.equal(strikes.length, 1);
  assert.equal(strikes[0].isSuccess, false);
  assert.equal(strikes[0].isTooCold, true, "帯より低いので冷たすぎ扱い");
  assert.equal(world.quality, qualityBefore, "冷たすぎる打撃は品質を減らさない");
  assert.equal(world.hitsLanded, hitsBefore, "冷たすぎる打撃はヒット数も進めない");
  assertFinite(world, "冷たい打撃後");
});

test("温度が高すぎるうちに打つと失敗し、品質が減る", () => {
  const world = new BellowsForgeWorld();
  world.temperature = Math.min(99, world.targetMax + 5);
  const strikes: Array<{ isSuccess: boolean; isTooHot: boolean; isTooCold: boolean }> = [];
  world.onStrike = (event) => strikes.push(event);
  const qualityBefore = world.quality;

  world.strike();

  assert.equal(strikes.length, 1);
  assert.equal(strikes[0].isSuccess, false);
  assert.equal(strikes[0].isTooHot, true);
  assert.equal(strikes[0].isTooCold, false);
  assert.equal(world.quality, qualityBefore - 1, "熱すぎる打撃は品質を1減らす");
  assertFinite(world, "熱い打撃後");
});

test("必要打数を成功で満たすと次のラウンドへ進み、ヒット数がリセットされる", () => {
  const world = new BellowsForgeWorld();
  const completions: Array<{ round: number; hitsRequired: number }> = [];
  world.onPieceComplete = (event) => completions.push(event);
  const roundBefore = world.round;
  const hitsRequiredBefore = world.hitsRequired;

  for (let i = 0; i < hitsRequiredBefore; i++) {
    pumpToBandCenter(world);
    world.strike();
  }

  assert.equal(completions.length, 1, "完成イベントが1回発火する");
  assert.equal(completions[0].round, roundBefore);
  assert.equal(world.round, roundBefore + 1, "ラウンドが進む");
  assert.equal(world.hitsLanded, 0, "次の作品のためにヒット数がリセットされる");
  assert.ok(world.score > 0, "完成ボーナスでスコアが増える");
  assertFinite(world, "作品完成後");
});

test("品質が尽きるとゲームオーバーになり、以降は操作しても状態が変化しない", () => {
  const world = new BellowsForgeWorld();
  const gameOvers: Array<{ round: number; score: number }> = [];
  world.onGameOver = (event) => gameOvers.push(event);

  for (let i = 0; i < BELLOWS_FORGE_START_QUALITY; i++) {
    world.temperature = 99; // 帯より確実に高い温度で熱すぎる失敗打を狙う
    world.strike();
  }

  assert.equal(world.isOver, true);
  assert.equal(world.quality, 0);
  assert.equal(gameOvers.length, 1, "ゲームオーバーイベントが1回だけ発火する");

  const temperatureBefore = world.temperature;
  world.step(TINY_FRAME);
  world.startPumping();
  world.strike();
  assert.equal(world.temperature, temperatureBefore, "ゲームオーバー後は温度が変化しない");
  assert.equal(world.isPumping, false, "ゲームオーバー後は送風を開始できない");
  assertFinite(world, "ゲームオーバー後");

  world.reset();
  assert.equal(world.isOver, false);
  assert.equal(world.round, 1);
  assert.equal(world.score, 0);
  assert.equal(world.quality, BELLOWS_FORGE_START_QUALITY);
});

test("ラウンドが進むほど必要打数が増え、目標帯が狭くなる", () => {
  const world = new BellowsForgeWorld();
  const widthAtRound1 = world.targetMax - world.targetMin;
  const hitsAtRound1 = world.hitsRequired;

  for (let round = 0; round < 4; round++) {
    for (let i = 0; i < world.hitsRequired; i++) {
      pumpToBandCenter(world);
      world.strike();
    }
  }

  assert.ok(world.hitsRequired >= hitsAtRound1, "必要打数は減らない");
  const widthLater = world.targetMax - world.targetMin;
  assert.ok(widthLater <= widthAtRound1, "目標帯は狭くなるか同じ");
  assertFinite(world, "複数ラウンド後");
});

test("ランダムな操作パターンを続けても状態が破綻しない", () => {
  const world = new BellowsForgeWorld();

  for (let i = 0; i < 3000; i++) {
    if (i % 5 === 0) world.startPumping();
    if (i % 11 === 0) world.stopPumping();
    if (i % 7 === 0) world.strike();
    world.step(TINY_FRAME * 4);
    if (world.isOver) world.reset();
    assertFinite(world, `${i}フレーム目`);
  }
});
