import assert from "node:assert/strict";
import { test } from "node:test";
import { BottleFlipWorld, START_LIVES } from "./world.ts";

// 物理計算から事前に求めた「ちょうど1回転で着地する」パワー(スイートスポット)。
const PERFECT_POWER_ONE_FLIP = 0.2075;
// 1〜5回転それぞれに対応するスイートスポット一覧。
const PERFECT_POWERS = [0.2075, 0.4545, 0.6496, 0.8161, 0.9637];
// 回転が半端な角度になり、どの許容幅にも収まらない「確実に失敗する」パワー。
const FAIL_POWER = 0.5;
// 許容幅の中間に収まる「GOOD判定になる」パワー。
const GOOD_POWER = 0.4695;

function assertFinite(world: BottleFlipWorld, label: string): void {
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.lives), `${label}: lives`);
  assert.ok(Number.isFinite(world.combo), `${label}: combo`);
  assert.ok(Number.isFinite(world.perfectTolerance), `${label}: perfectTolerance`);
  assert.ok(Number.isFinite(world.goodTolerance), `${label}: goodTolerance`);
}

test("初期状態はライフ満タン・スコア0・ゲームオーバーでない", () => {
  const world = new BottleFlipWorld();

  assert.equal(world.score, 0);
  assert.equal(world.lives, START_LIVES);
  assert.equal(world.combo, 0);
  assert.equal(world.bestCombo, 0);
  assert.equal(world.successes, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.lastResult, null);
});

test("ちょうど1回転のスイートスポットで投げると立って着地し、スコアとコンボが増える", () => {
  const world = new BottleFlipWorld();

  const event = world.attemptFlip(PERFECT_POWER_ONE_FLIP);

  assert.equal(event.outcome, "perfect");
  assert.ok(Math.abs(event.rotations - 1) < 0.01, "ほぼ1回転で着地する");
  assert.equal(world.combo, 1);
  assert.equal(world.bestCombo, 1);
  assert.equal(world.successes, 1);
  assert.equal(world.lives, START_LIVES, "成功してもライフは減らない");
  assert.ok(world.score > 0, "得点が入っている");
  assertFinite(world, "perfect直後");
});

test("中途半端な角度で着地するとGOOD判定になり、コンボは切れるがライフは減らない", () => {
  const world = new BottleFlipWorld();
  world.attemptFlip(PERFECT_POWER_ONE_FLIP); // combo を 1 にしておく

  const event = world.attemptFlip(GOOD_POWER);

  assert.equal(event.outcome, "good");
  assert.equal(world.combo, 0, "GOODでコンボは切れる");
  assert.equal(world.lives, START_LIVES, "GOODはライフが減らない");
  assert.ok(event.scoreGained > 0, "GOODでも得点は入る");
  assertFinite(world, "good直後");
});

test("大きく外れた角度で着地すると失敗し、ライフが減ってコンボが切れる", () => {
  const world = new BottleFlipWorld();
  world.attemptFlip(PERFECT_POWER_ONE_FLIP); // combo を 1 にしておく
  const livesBefore = world.lives;

  const event = world.attemptFlip(FAIL_POWER);

  assert.equal(event.outcome, "fail");
  assert.equal(world.combo, 0);
  assert.equal(world.lives, livesBefore - 1);
  assert.equal(event.scoreGained, 0);
  assertFinite(world, "fail直後");
});

test("成功を積み重ねるほど許容角度が狭くなっていく", () => {
  const world = new BottleFlipWorld();
  const toleranceBefore = world.perfectTolerance;

  for (const power of PERFECT_POWERS) {
    world.attemptFlip(power);
  }

  assert.ok(world.perfectTolerance < toleranceBefore, "成功するたびに許容角度が狭くなる");
  assert.equal(world.successes, PERFECT_POWERS.length);
  assert.equal(world.combo, PERFECT_POWERS.length);
  assertFinite(world, "複数成功後");
});

test("ライフが尽きるとゲームオーバーになり、以後の操作で状態が壊れない", () => {
  const world = new BottleFlipWorld();

  let safety = 0;
  while (!world.isOver && safety < 20) {
    world.attemptFlip(FAIL_POWER);
    safety++;
  }

  assert.equal(world.isOver, true, "ライフ0でゲームオーバーになる");
  assert.equal(world.lives, 0);

  const scoreBefore = world.score;
  const event = world.attemptFlip(PERFECT_POWER_ONE_FLIP);
  assert.equal(event.isGameOver, true);
  assert.equal(world.score, scoreBefore, "ゲームオーバー後は状態が変化しない");
  assertFinite(world, "ゲームオーバー後");

  world.reset();
  assert.equal(world.isOver, false);
  assert.equal(world.score, 0);
  assert.equal(world.lives, START_LIVES);
});
