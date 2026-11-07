import assert from "node:assert/strict";
import { test } from "node:test";
import { GOOD_WINDOW_SECONDS, ROPE_MIN, ROPE_START, TsunahikiWorld } from "./world.ts";

/** 現在の対象ビートの判定時刻ちょうどまで時間を進める(PERFECT判定を狙うため)。 */
function advanceToCurrentBeatTime(world: TsunahikiWorld): void {
  const beat = world.currentBeat;
  assert.ok(beat, "対象ビートが存在する");
  if (!beat) return;
  const delta = beat.time - world.elapsed;
  if (delta > 0) world.step(delta);
}

test("起動直後は綱が中央で、ビートが生成されている", () => {
  const world = new TsunahikiWorld();

  assert.equal(world.round, 1);
  assert.equal(world.ropePosition, ROPE_START);
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.beatIndex, 0);
  assert.ok(world.beats.length > 0, "ビートが生成されている");
  assert.ok(world.currentBeat !== null);
});

test("ちょうどの瞬間に引くとPERFECT判定で綱が自陣側に進み得点とコンボが増える", () => {
  const world = new TsunahikiWorld();
  const resolved: { judgement: string; scoreGained: number }[] = [];
  world.onPullResolved = (event) => resolved.push(event);

  advanceToCurrentBeatTime(world);
  world.pull();

  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].judgement, "perfect");
  assert.ok(resolved[0].scoreGained > 0);
  assert.equal(world.score, resolved[0].scoreGained);
  assert.equal(world.combo, 1);
  assert.equal(world.beatIndex, 1);
  assert.ok(world.ropePosition > ROPE_START, "綱が自陣側に進む");
});

test("連続で成功するほどコンボボーナスにより綱の伸びと得点が大きくなる", () => {
  const world = new TsunahikiWorld();
  const gains: number[] = [];
  const points: number[] = [];
  let previousRope = world.ropePosition;
  world.onPullResolved = (event) => {
    gains.push(event.ropePosition - previousRope);
    previousRope = event.ropePosition;
    points.push(event.scoreGained);
  };

  for (let i = 0; i < 3; i++) {
    advanceToCurrentBeatTime(world);
    world.pull();
  }

  assert.equal(points.length, 3);
  assert.ok(gains[1] > gains[0], "2連続目の方が1回目より綱が伸びる");
  assert.ok(gains[2] > gains[1], "3連続目の方が2回目より綱が伸びる");
  assert.ok(points[1] > points[0], "2連続目の方が1回目より高得点");
  assert.ok(points[2] > points[1], "3連続目の方が2回目より高得点");
});

test("タイミングが窓を超えて早すぎる/遅すぎるとミスになり綱が戻りコンボがリセットされる", () => {
  const world = new TsunahikiWorld();
  advanceToCurrentBeatTime(world);
  world.pull();
  assert.equal(world.combo, 1);
  const ropeBeforeMiss = world.ropePosition;

  const missed: string[] = [];
  world.onPullMissed = (event) => missed.push(event.reason);

  // 判定窓よりはっきり早いタイミングで引く(窓そのものは越えないよう step はしない)。
  world.pull();

  assert.deepEqual(missed, ["timing"]);
  assert.equal(world.combo, 0);
  assert.ok(world.ropePosition < ropeBeforeMiss, "綱が相手側に戻る");
});

test("何も入力せず判定窓を過ぎるとタイムアウトでミスになる", () => {
  const world = new TsunahikiWorld();
  const beat = world.currentBeat;
  assert.ok(beat);
  if (!beat) return;

  const missed: string[] = [];
  world.onPullMissed = (event) => missed.push(event.reason);

  world.step(beat.time - world.elapsed + GOOD_WINDOW_SECONDS + 0.01);

  assert.deepEqual(missed, ["timeout"]);
  assert.ok(world.ropePosition < ROPE_START);
  assert.equal(world.beatIndex, 1);
});

test("綱を自陣側まで引き切るとラウンドがクリアされ、綱は中央に戻って次ラウンドが始まる", () => {
  const world = new TsunahikiWorld();
  let roundWonCount = 0;
  world.onPullResolved = (event) => {
    if (event.roundWon) roundWonCount += 1;
  };

  for (let i = 0; i < 20 && world.round === 1; i++) {
    advanceToCurrentBeatTime(world);
    world.pull();
  }

  assert.equal(roundWonCount, 1, "ラウンドクリアが一度発生する");
  assert.equal(world.round, 2);
  assert.equal(world.ropePosition, ROPE_START);
});

test("綱が相手側の最大(0)まで戻るとゲームオーバーになり、以降の操作を無視する", () => {
  const world = new TsunahikiWorld();

  for (let i = 0; i < 20 && !world.isOver; i++) {
    // 窓を大きく外したタイミングで引き、確実にミスさせる。
    world.pull();
    world.step(0.6);
  }

  assert.equal(world.isOver, true);
  assert.equal(world.ropePosition, ROPE_MIN);

  const scoreBefore = world.score;
  const beatIndexBefore = world.beatIndex;
  world.step(1);
  world.pull();

  assert.equal(world.score, scoreBefore, "ゲームオーバー後は得点が変わらない");
  assert.equal(world.beatIndex, beatIndexBefore, "ゲームオーバー後はビートが進まない");
  assert.equal(world.ropePosition, ROPE_MIN, "綱は最小値未満にならない");
});

test("ゲームオーバーのあとにreset()すると最初から遊べる", () => {
  const world = new TsunahikiWorld();
  for (let i = 0; i < 20 && !world.isOver; i++) {
    world.pull();
    world.step(0.6);
  }
  assert.equal(world.isOver, true);

  world.reset();

  assert.equal(world.isOver, false);
  assert.equal(world.round, 1);
  assert.equal(world.ropePosition, ROPE_START);
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.beatIndex, 0);
  assert.ok(world.beats.length > 0, "リセット後もビートが生成されている");
});

test("getVisibleBeats は先読み秒数の範囲内にある未判定のビートだけを時間順に返す", () => {
  const world = new TsunahikiWorld();
  const beat = world.currentBeat;
  assert.ok(beat);
  if (!beat) return;
  // 最初のビートが先読み秒数の範囲に入るところまで時間を進める。
  world.step(Math.max(0, beat.time - world.elapsed - 0.5));
  const visible = world.getVisibleBeats();

  assert.ok(visible.length > 0);
  for (let i = 1; i < visible.length; i++) {
    assert.ok(visible[i].time >= visible[i - 1].time, "時間順に並んでいる");
  }
});

test("ラウンドが進むほど掛け声の間隔が詰まっていく", () => {
  const world = new TsunahikiWorld();
  const earlyIntervals: number[] = [];
  const lateIntervals: number[] = [];
  let previousBeatCount = world.beats.length;

  while (world.round < 6 && world.elapsed < 120) {
    advanceToCurrentBeatTime(world);
    world.pull();
    assert.equal(world.isOver, false, "正しいタイミングで引き続ければゲームオーバーにならない");

    for (let i = previousBeatCount; i < world.beats.length; i++) {
      const interval = world.beats[i].time - world.beats[i - 1].time;
      if (world.round <= 1) earlyIntervals.push(interval);
      else if (world.round >= 4) lateIntervals.push(interval);
    }
    previousBeatCount = world.beats.length;
  }

  assert.ok(earlyIntervals.length > 0 && lateIntervals.length > 0);
  const earlyAverage = earlyIntervals.reduce((a, b) => a + b, 0) / earlyIntervals.length;
  const lateAverage = lateIntervals.reduce((a, b) => a + b, 0) / lateIntervals.length;
  assert.ok(lateAverage < earlyAverage, "ラウンドが進むと掛け声の間隔が狭くなる");
});
