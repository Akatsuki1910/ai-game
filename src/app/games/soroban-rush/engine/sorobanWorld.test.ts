import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EARTH_BEADS_PER_ROD,
  INITIAL_DIGIT_COUNT,
  SorobanWorld,
  START_LIVES,
} from "./sorobanWorld.ts";

/** 現在の盤面を狙った数にぴったり合わせる（テストのセットアップ用）。 */
function setCurrentNumber(world: SorobanWorld, value: number): void {
  let remaining = value;
  for (let i = 0; i < world.digitCount; i++) {
    const place = world.digitCount - 1 - i;
    const divisor = 10 ** place;
    const digit = Math.floor(remaining / divisor);
    remaining -= digit * divisor;
    world.setRodHeaven(i, digit >= 5);
    world.rods[i].earthUpCount = digit % 5;
  }
}

test("起動直後は2桁・満タンのライフ・珠はすべて0で始まる", () => {
  const world = new SorobanWorld();

  assert.equal(world.digitCount, INITIAL_DIGIT_COUNT);
  assert.equal(world.rods.length, INITIAL_DIGIT_COUNT);
  assert.equal(world.lives, START_LIVES);
  assert.equal(world.score, 0);
  assert.equal(world.round, 1);
  assert.equal(world.isOver, false);
  assert.equal(world.currentNumber, 0);
  assert.ok(world.targetNumber >= 10 && world.targetNumber <= 99, "2桁の目標が出る");
  assert.ok(world.roundTimeLimit > 0, "制限時間がある");
  assert.equal(world.timeRemaining, world.roundTimeLimit);
});

test("珠を操作すると現在の数が変わる（ドラッグ相当のratio指定）", () => {
  const world = new SorobanWorld();

  world.setRodEarthFromRatio(0, 1); // 十の位 = 4
  world.setRodHeaven(1, true); // 一の位 = 5
  world.setRodEarthFromRatio(1, 0.5); // round(0.5*4)=2 → 一の位 = 5+2=7

  assert.equal(world.digitAt(0), 4);
  assert.equal(world.digitAt(1), 7);
  assert.equal(world.currentNumber, 47);

  // ratio は 0-1 の範囲外も安全にクランプされる
  world.setRodEarthFromRatio(0, -5);
  assert.equal(world.digitAt(0), 0);
  world.setRodEarthFromRatio(0, 5);
  assert.equal(world.digitAt(0), EARTH_BEADS_PER_ROD);
});

test("キーボードでの桁の+1/-1は0↔9をまたいでも安全にラップする", () => {
  const world = new SorobanWorld();

  world.adjustRodDigit(0, -1);
  assert.equal(world.digitAt(0), 9, "0から-1すると9になる");

  world.adjustRodDigit(0, 1);
  assert.equal(world.digitAt(0), 0, "9から+1すると0に戻る");

  for (let i = 0; i < 6; i++) world.adjustRodDigit(0, 1);
  assert.equal(world.digitAt(0), 6);
});

test("選択中の桁はdigitCountの範囲内を循環する", () => {
  const world = new SorobanWorld(); // digitCount=2

  assert.equal(world.selectedRodIndex, 0);
  world.selectRod(-1);
  assert.equal(world.selectedRodIndex, 1, "0から-1すると末尾の桁へ循環する");
  world.selectRod(1);
  assert.equal(world.selectedRodIndex, 0);
});

test("正しい数で決定すると得点してライフは減らず、次のラウンドに進む", () => {
  const world = new SorobanWorld();
  const target = world.targetNumber;
  const round = world.round;
  setCurrentNumber(world, target);

  world.submit();

  assert.ok(world.score > 0, "得点が入る");
  assert.equal(world.lives, START_LIVES, "正解してもライフは減らない");
  assert.equal(world.feedback, "correct");
  assert.equal(world.round, round + 1, "ラウンドが進む");
  assert.equal(world.currentNumber, 0, "次のラウンドでは珠がリセットされる");
  assert.notEqual(world.timeRemaining, 0);
});

test("間違った数で決定するとライフが減るが、同じラウンドのまま再挑戦できる", () => {
  const world = new SorobanWorld();
  const target = world.targetNumber;
  const round = world.round;
  setCurrentNumber(world, (target + 1) % 100);

  world.submit();

  assert.equal(world.lives, START_LIVES - 1, "ライフが1減る");
  assert.equal(world.feedback, "wrong");
  assert.equal(world.round, round, "ラウンドは進まない");
  assert.equal(world.targetNumber, target, "目標の数はそのまま");
  assert.equal(world.isOver, false);

  // 同じラウンドのまま、珠を直して正解できる
  setCurrentNumber(world, target);
  world.submit();
  assert.equal(world.feedback, "correct");
  assert.equal(world.round, round + 1);
});

test("時間切れになるとライフが減り、次のラウンドへ自動的に進む", () => {
  const world = new SorobanWorld();
  const round = world.round;

  world.step(world.roundTimeLimit + 1);

  assert.equal(world.lives, START_LIVES - 1);
  assert.equal(world.feedback, "timeout");
  assert.equal(world.round, round + 1, "時間切れはラウンドが進む");
  assert.equal(world.currentNumber, 0, "次のラウンドでは珠がリセットされる");
  assert.ok(world.timeRemaining > 0, "次のラウンドの制限時間に戻っている");
});

test("ライフが尽きるとゲームオーバーになり、以後の操作を受け付けない", () => {
  const world = new SorobanWorld();

  for (let i = 0; i < START_LIVES; i++) {
    const target = world.targetNumber;
    setCurrentNumber(world, (target + 1) % 100 || 1);
    world.submit();
  }

  assert.equal(world.isOver, true);
  assert.equal(world.lives, 0);

  const scoreBefore = world.score;
  const roundBefore = world.round;
  world.submit();
  world.step(1);
  assert.equal(world.score, scoreBefore, "ゲームオーバー後はsubmitが効かない");
  assert.equal(world.round, roundBefore, "ゲームオーバー後はstepが効かない");
});

test("5ラウンドごとに桁数が増え、最大4桁で止まる", () => {
  const world = new SorobanWorld();

  for (let i = 0; i < 40; i++) {
    const target = world.targetNumber;
    setCurrentNumber(world, target);
    world.submit();
  }

  assert.ok(world.digitCount > INITIAL_DIGIT_COUNT, "桁数が増えている");
  assert.ok(world.digitCount <= 4, "桁数は4で止まる");
});

test("reset()で初期状態に戻る", () => {
  const world = new SorobanWorld();
  setCurrentNumber(world, (world.targetNumber + 1) % 100 || 1);
  world.submit();
  world.step(1);

  world.reset();

  assert.equal(world.score, 0);
  assert.equal(world.lives, START_LIVES);
  assert.equal(world.round, 1);
  assert.equal(world.digitCount, INITIAL_DIGIT_COUNT);
  assert.equal(world.isOver, false);
  assert.equal(world.feedback, null);
  assert.equal(world.currentNumber, 0);
});
