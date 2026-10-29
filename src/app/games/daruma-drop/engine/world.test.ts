import assert from "node:assert/strict";
import { test } from "node:test";
import { DarumaDropWorld, INITIAL_BLOCKS, STABILITY_MAX } from "./world.ts";

function assertFinite(world: DarumaDropWorld, label: string): void {
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.stability), `${label}: stability`);
  assert.ok(Number.isFinite(world.swingTimer), `${label}: swingTimer`);
  assert.ok(Number.isFinite(world.currentWindow.min), `${label}: window.min`);
  assert.ok(Number.isFinite(world.currentWindow.max), `${label}: window.max`);
}

test("起動直後は積み木5段・安定度満タンでウィンドウが設定されている", () => {
  const world = new DarumaDropWorld();

  assert.equal(world.round, 1);
  assert.equal(world.blocksRemaining, INITIAL_BLOCKS);
  assert.equal(world.totalBlocksInRound, INITIAL_BLOCKS);
  assert.equal(world.stability, STABILITY_MAX);
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.isOver, false);
  assert.ok(world.currentWindow.min >= 0 && world.currentWindow.max <= 1);
  assert.ok(world.currentWindow.min < world.currentWindow.max);
});

test("ウィンドウぴったりで振ると積み木が抜け、スコアとコンボが増える", () => {
  const world = new DarumaDropWorld();
  world.currentWindow = { min: 0.4, max: 0.6 };

  const event = world.attemptSwing(0.5);

  assert.equal(event.outcome, "perfect");
  assert.equal(world.blocksRemaining, INITIAL_BLOCKS - 1);
  assert.equal(world.combo, 1);
  assert.ok(world.score > 0, "得点が入っている");
  assert.equal(world.stability, STABILITY_MAX, "満タンから増える分はクランプされる");
  assertFinite(world, "perfect直後");
});

test("弱すぎる振りは積み木が抜けず、安定度だけ減ってコンボが切れる", () => {
  const world = new DarumaDropWorld();
  world.currentWindow = { min: 0.4, max: 0.6 };
  world.attemptSwing(0.5); // combo を 1 にしておく
  // attemptSwing が成功すると currentWindow は新しくランダムに引き直されるため、
  // 2回目の振りを決定的にテストするには再度固定し直す必要がある。
  world.currentWindow = { min: 0.4, max: 0.6 };
  const blocksBefore = world.blocksRemaining;
  const stabilityBefore = world.stability;

  const event = world.attemptSwing(0.1);

  assert.equal(event.outcome, "too-weak");
  assert.equal(world.blocksRemaining, blocksBefore, "積み木は抜けない");
  assert.equal(world.combo, 0, "コンボが切れる");
  assert.ok(world.stability < stabilityBefore, "安定度が減る");
  assertFinite(world, "too-weak直後");
});

test("強すぎる振りは積み木が抜けるがコンボは切れ、安定度が大きく減る", () => {
  const world = new DarumaDropWorld();
  world.currentWindow = { min: 0.4, max: 0.6 };
  const stabilityBefore = world.stability;

  const event = world.attemptSwing(0.95);

  assert.equal(event.outcome, "overpower");
  assert.equal(world.blocksRemaining, INITIAL_BLOCKS - 1, "積み木は抜ける");
  assert.equal(world.combo, 0);
  assert.ok(world.stability < stabilityBefore, "安定度が減る");
  assert.ok(event.scoreGained > 0, "それでも得点は入る");
  assertFinite(world, "overpower直後");
});

test("タワーを積み木0まで抜くとラウンドが進み、次の段数が増えて時間制限も短くなる", () => {
  const world = new DarumaDropWorld();
  const swingLimitBefore = world.swingTimeLimit;

  let roundCompleted = false;
  for (let i = 0; i < INITIAL_BLOCKS; i++) {
    world.currentWindow = { min: 0.4, max: 0.6 };
    const event = world.attemptSwing(0.5);
    if (event.roundCompleted) roundCompleted = true;
  }

  assert.equal(roundCompleted, true, "最後の1本でラウンド完了イベントが出る");
  assert.equal(world.round, 2);
  assert.equal(world.totalBlocksInRound, INITIAL_BLOCKS + 1);
  assert.equal(world.blocksRemaining, INITIAL_BLOCKS + 1);
  assert.ok(world.swingTimeLimit <= swingLimitBefore, "時間制限が短くなるか同じ");
  assertFinite(world, "ラウンド完了後");
});

test("制限時間内に振らないと安定度が減ってコンボが切れる", () => {
  const world = new DarumaDropWorld();
  world.currentWindow = { min: 0.4, max: 0.6 };
  world.attemptSwing(0.5); // combo を 1 にしておく
  const stabilityBefore = world.stability;

  world.step(world.swingTimeLimit + 0.01);

  assert.ok(world.stability < stabilityBefore, "タイムアウトで安定度が減る");
  assert.equal(world.combo, 0, "タイムアウトでコンボが切れる");
  assert.ok(world.swingTimer > 0, "タイマーがリセットされる");
  assertFinite(world, "タイムアウト直後");
});

test("安定度が尽きるとタワーが崩れて終了し、以後の操作で状態が壊れない", () => {
  const world = new DarumaDropWorld();

  let safety = 0;
  while (!world.isOver && safety < 200) {
    world.currentWindow = { min: 0.4, max: 0.6 };
    world.attemptSwing(0); // 常に弱すぎる振りで安定度を削り切る
    safety++;
  }

  assert.equal(world.isOver, true, "安定度0でタワーが崩れる");
  assert.equal(world.stability, 0);

  // 終了後に操作しても状態が壊れない（得点やブロック数が変化しない）
  const scoreBefore = world.score;
  const blocksBefore = world.blocksRemaining;
  world.step(1);
  world.attemptSwing(0.5);
  assert.equal(world.score, scoreBefore);
  assert.equal(world.blocksRemaining, blocksBefore);
  assertFinite(world, "終了後");

  world.reset();
  assert.equal(world.isOver, false);
  assert.equal(world.score, 0);
  assert.equal(world.stability, STABILITY_MAX);
  assert.equal(world.blocksRemaining, INITIAL_BLOCKS);
});
