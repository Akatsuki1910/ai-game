import assert from "node:assert/strict";
import { test } from "node:test";
import { GrainScaleWorld, MAX_CAPACITY, ROUND_SECONDS, TARGET_TOLERANCE } from "./world.ts";

const WIDTH = 960;
const HEIGHT = 540;

function panCenters(world: GrainScaleWorld): { left: number; right: number; gap: number } {
  const [leftMin, leftMax] = world.leftPanRange();
  const [rightMin, rightMax] = world.rightPanRange();
  return {
    left: (leftMin + leftMax) / 2,
    right: (rightMin + rightMax) / 2,
    gap: (leftMax + rightMin) / 2,
  };
}

function assertFinite(world: GrainScaleWorld, label: string): void {
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.timeRemaining), `${label}: timeRemaining`);
  assert.ok(Number.isFinite(world.leftWeight), `${label}: leftWeight`);
  assert.ok(Number.isFinite(world.rightWeight), `${label}: rightWeight`);
  assert.ok(Number.isFinite(world.beamAngle), `${label}: beamAngle`);
}

test("起動直後は皿が空でタイマーと目標が設定されている", () => {
  const world = new GrainScaleWorld(WIDTH, HEIGHT);

  assert.equal(world.leftWeight, 0);
  assert.equal(world.rightWeight, 0);
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.timeRemaining, ROUND_SECONDS);
  assert.ok(world.target > 0, "目標の重さが設定されている");
  assert.equal(world.spoutX, WIDTH / 2, "壺は中央から始まる");
});

test("壺を左皿に合わせて注ぐと左だけ重くなる", () => {
  const world = new GrainScaleWorld(WIDTH, HEIGHT);
  const { left } = panCenters(world);

  world.setSpoutX(left);
  world.step(1);

  assert.ok(world.leftWeight >= 18 && world.leftWeight <= 20, "約20粒ぶん注がれている");
  assert.equal(world.rightWeight, 0, "右は変化しない");
  assertFinite(world, "左に注いだ後");
});

test("隙間に注ぐと砂は無駄になり、どちらの皿も増えない", () => {
  const world = new GrainScaleWorld(WIDTH, HEIGHT);
  const { gap } = panCenters(world);

  world.setSpoutX(gap);
  world.step(1);

  assert.equal(world.leftWeight, 0);
  assert.equal(world.rightWeight, 0);
});

test("左右交互に注いで目標範囲を維持し続けるとラウンドが成功する", () => {
  const world = new GrainScaleWorld(WIDTH, HEIGHT);
  world.target = 40;
  const { left, right } = panCenters(world);

  const completed: { points: number; combo: number }[] = [];
  world.onRoundCompleted = (event) => completed.push(event);

  for (let i = 0; i < 200 && completed.length === 0; i++) {
    world.setSpoutX(i % 2 === 0 ? left : right);
    world.step(0.1);
    assertFinite(world, "交互に注いでいる間");
  }

  assert.equal(completed.length, 1, "ラウンドが1回成功する");
  assert.ok(completed[0].points > 0, "得点が入っている");
  assert.equal(world.score, completed[0].points);
  assert.equal(world.combo, 1, "コンボが進む");
  assert.equal(world.leftWeight, 0, "成功後は皿が空になる");
  assert.equal(world.rightWeight, 0, "成功後は皿が空になる");
});

test("片側だけに注ぎ続けて傾きすぎるとこぼれて皿がリセットされる", () => {
  const world = new GrainScaleWorld(WIDTH, HEIGHT);
  const { left } = panCenters(world);
  world.setSpoutX(left);

  const spills: { leftWeight: number; rightWeight: number }[] = [];
  world.onSpill = (event) => spills.push(event);

  for (let i = 0; i < 500 && spills.length === 0; i++) {
    world.step(0.1);
    assertFinite(world, "傾いていく間");
  }

  assert.equal(spills.length, 1, "こぼれるイベントが1回発生する");
  assert.ok(spills[0].leftWeight > 0, "こぼれた時点の重さが記録されている");
  assert.equal(world.leftWeight, 0, "こぼれた後は皿が空になる");
  assert.equal(world.rightWeight, 0);
  assert.equal(world.combo, 0, "こぼすとコンボが途切れる");
});

test("傾きすぎてもすぐ立て直せばこぼれない", () => {
  const world = new GrainScaleWorld(WIDTH, HEIGHT);
  const { left, right } = panCenters(world);

  const spills: unknown[] = [];
  world.onSpill = (event) => spills.push(event);

  world.setSpoutX(left);
  world.step(0.3); // 差が閾値を超えるが、猶予(1.1秒)には届かない
  assert.ok(world.leftWeight > 0);

  world.setSpoutX(right);
  world.step(0.3); // すぐにバランスを戻す

  assert.equal(spills.length, 0, "猶予内に立て直せばこぼれない");
  assert.ok(world.leftWeight > 0, "こぼれていないので重さが残っている");
});

test("片側に注ぎ続けても最大容量を超えない", () => {
  const world = new GrainScaleWorld(WIDTH, HEIGHT);
  world.target = 500; // ホールド成功で皿がリセットされないよう、届かない目標にしておく
  const { left, right } = panCenters(world);

  for (let i = 0; i < 400; i++) {
    world.setSpoutX(i % 2 === 0 ? left : right);
    world.step(0.051);
    assert.ok(world.leftWeight <= MAX_CAPACITY, "左皿が最大容量を超えない");
    assert.ok(world.rightWeight <= MAX_CAPACITY, "右皿が最大容量を超えない");
  }

  assert.equal(world.leftWeight, MAX_CAPACITY);
  assert.equal(world.rightWeight, MAX_CAPACITY);
  assert.equal(world.isOver, false, "容量テストの間にラウンドが終了していない");
});

test(`${ROUND_SECONDS}秒経つとラウンドが終わり、リセットで最初から遊べる`, () => {
  const world = new GrainScaleWorld(WIDTH, HEIGHT);
  const { left } = panCenters(world);
  world.setSpoutX(left);

  for (let i = 0; i < 2000 && !world.isOver; i++) {
    world.step(0.1);
    assertFinite(world, "ラウンド中");
  }

  assert.equal(world.isOver, true, "ラウンドが終了する");
  assert.equal(world.timeRemaining, 0);

  const scoreAtEnd = world.score;
  world.step(0.1);
  assert.equal(world.score, scoreAtEnd, "終了後は進行しない");

  world.reset();
  assert.equal(world.isOver, false);
  assert.equal(world.score, 0);
  assert.equal(world.leftWeight, 0);
  assert.equal(world.rightWeight, 0);
  assert.equal(world.timeRemaining, ROUND_SECONDS);
});

test("画面サイズが変わっても壺と皿の位置が画面内に収まる", () => {
  const world = new GrainScaleWorld(WIDTH, HEIGHT);
  world.setSpoutX(WIDTH * 0.9);

  world.resize(375, 720);

  assert.ok(world.spoutX >= 0 && world.spoutX <= 375, "壺が画面内に収まる");
  const [leftMin, leftMax] = world.leftPanRange();
  const [rightMin, rightMax] = world.rightPanRange();
  assert.ok(leftMin >= 0 && leftMax <= 375, "左皿が画面内");
  assert.ok(rightMin >= 0 && rightMax <= 375, "右皿が画面内");
  assert.ok(rightMax <= 375 + 1);

  world.step(1 / 60);
  assertFinite(world, "リサイズ後");
});

test("目標範囲の許容差が正の値である", () => {
  assert.ok(TARGET_TOLERANCE > 0);
});
