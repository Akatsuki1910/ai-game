import assert from "node:assert/strict";
import { test } from "node:test";
import { DANGER_WOBBLE, SPINDLE_COUNT, SpindleCircusWorld, START_LIVES } from "./world.ts";

const FRAME = 1 / 60;

function countPlates(world: SpindleCircusWorld): number {
  return world.spindles.filter((spindle) => spindle.hasPlate).length;
}

function firstOccupiedIndex(world: SpindleCircusWorld): number {
  const index = world.spindles.findIndex((spindle) => spindle.hasPlate);
  assert.notEqual(index, -1, "皿が乗っている柱が少なくとも1つ存在する");
  return index;
}

test("起動直後は満タンのライフ・スコア0で、皿が1枚だけ回っている", () => {
  const world = new SpindleCircusWorld();

  assert.equal(world.lives, START_LIVES);
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.spindles.length, SPINDLE_COUNT);
  assert.equal(countPlates(world), 1, "開始時は皿が1枚だけ乗っている");
});

test("皿が乗った柱をスピンすると得点が入り、ぐらつきがリセットされる", () => {
  const world = new SpindleCircusWorld();
  const index = firstOccupiedIndex(world);
  world.spindles[index].wobble = 0.5;

  const spunEvents: number[] = [];
  world.onPlateSpun = (event) => spunEvents.push(event.points);

  world.spinSpindle(index);

  assert.equal(spunEvents.length, 1, "スピンイベントが発火する");
  assert.ok(spunEvents[0] > 0, "得点が入っている");
  assert.equal(world.score, spunEvents[0]);
  assert.equal(world.combo, 1);
  assert.equal(world.spindles[index].wobble, 0, "スピン後はぐらつきが0に戻る");
});

test("皿が乗っていない柱をスピンしても何も起きない", () => {
  const world = new SpindleCircusWorld();
  const emptyIndex = world.spindles.findIndex((spindle) => !spindle.hasPlate);
  assert.notEqual(emptyIndex, -1, "空の柱が存在する");

  world.onPlateSpun = () => assert.fail("空の柱でスピンイベントが発火してはいけない");
  world.spinSpindle(emptyIndex);

  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
});

test("ぎりぎりでスピンするほど得点が高い", () => {
  const early = new SpindleCircusWorld();
  const earlyIndex = firstOccupiedIndex(early);
  early.spindles[earlyIndex].wobble = 0.05;
  let earlyPoints = 0;
  early.onPlateSpun = (event) => {
    earlyPoints = event.points;
  };
  early.spinSpindle(earlyIndex);

  const late = new SpindleCircusWorld();
  const lateIndex = firstOccupiedIndex(late);
  late.spindles[lateIndex].wobble = 0.95;
  let latePoints = 0;
  late.onPlateSpun = (event) => {
    latePoints = event.points;
  };
  late.spinSpindle(lateIndex);

  assert.ok(latePoints > earlyPoints, "ぐらつきが大きいほど得点が高い");
});

test("時間経過でぐらつきが増え、DANGER_WOBBLE を超えても回り続けたうえで1に達すると落下する", () => {
  const world = new SpindleCircusWorld();
  const index = firstOccupiedIndex(world);

  const fellEvents: number[] = [];
  world.onPlateFell = (event) => fellEvents.push(event.livesRemaining);

  let steps = 0;
  while (world.spindles[index].hasPlate && steps < 10_000) {
    world.step(FRAME);
    steps++;
  }

  assert.equal(fellEvents.length, 1, "落下イベントが発火する");
  assert.equal(world.lives, START_LIVES - 1);
  assert.equal(fellEvents[0], world.lives);
  assert.ok(DANGER_WOBBLE < 1, "DANGER_WOBBLE は落下しきい値より小さい定数として定義されている");
});

test("皿が落ちるとコンボがリセットされる", () => {
  const world = new SpindleCircusWorld();
  const index = firstOccupiedIndex(world);
  world.spinSpindle(index);
  assert.equal(world.combo, 1);

  world.spindles[index].wobble = 1;
  world.step(FRAME);

  assert.equal(world.combo, 0, "落下でコンボが切れる");
});

test("ライフが尽きるとゲームオーバーになり、以降は状態が変化しない", () => {
  const world = new SpindleCircusWorld();

  for (let i = 0; i < START_LIVES; i++) {
    // 直前の落下で空になった柱にも強制的に皿を乗せ、毎回確実に1枚落とせるようにする。
    world.spindles[0].hasPlate = true;
    world.spindles[0].wobble = 1;
    world.step(FRAME);
  }

  assert.equal(world.lives, 0);
  assert.equal(world.isOver, true);

  const scoreBefore = world.score;
  const spindlesSnapshot = world.spindles.map((spindle) => ({ ...spindle }));
  world.step(FRAME);
  world.spinSpindle(0);

  assert.equal(world.score, scoreBefore, "ゲームオーバー後はスピンしても得点が変わらない");
  assert.deepEqual(
    world.spindles,
    spindlesSnapshot,
    "ゲームオーバー後は step() で柱の状態が変化しない",
  );
  assert.equal(world.lives, 0, "ライフはマイナスにならない");
});

test("時間が経つと新しい皿が自動で追加され、SPINDLE_COUNT を超えない", () => {
  const world = new SpindleCircusWorld();

  // 十分な時間を経過させれば、落ちない範囲でスピンし続ける限り皿は埋まっていく。
  for (let i = 0; i < 6000 && !world.isOver; i++) {
    for (const spindle of world.spindles) {
      if (spindle.hasPlate && spindle.wobble > 0.3) {
        world.spinSpindle(spindle.id);
      }
    }
    world.step(FRAME);
  }

  assert.ok(!world.isOver, "スピンし続ければゲームオーバーにならない");
  assert.ok(countPlates(world) <= SPINDLE_COUNT, "皿の数は柱の数を超えない");
  assert.ok(countPlates(world) >= 2, "十分な時間が経てば複数の柱に皿が乗る");
});

test("reset() で最初の状態に戻る", () => {
  const world = new SpindleCircusWorld();
  const index = firstOccupiedIndex(world);
  world.spinSpindle(index);
  world.step(1);

  world.reset();

  assert.equal(world.lives, START_LIVES);
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.elapsedSeconds, 0);
  assert.equal(countPlates(world), 1);
});
