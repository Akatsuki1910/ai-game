import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GOOD_WINDOW_SECONDS,
  type ScratchDirection,
  START_HYPE,
  VinylScratchWorld,
} from "./world.ts";

/** 現在の対象キューの判定時刻ちょうどまで時間を進める(PERFECT判定を狙うため)。 */
function advanceToCurrentCueTime(world: VinylScratchWorld): void {
  const cue = world.currentCue;
  assert.ok(cue, "対象キューが存在する");
  if (!cue) return;
  const delta = cue.time - world.elapsed;
  if (delta > 0) world.step(delta);
}

function oppositeDirection(direction: ScratchDirection): ScratchDirection {
  return direction === "forward" ? "back" : "forward";
}

test("起動直後は満タンのハイプでキューが生成されている", () => {
  const world = new VinylScratchWorld();

  assert.equal(world.hype, START_HYPE);
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.cueIndex, 0);
  assert.ok(world.cues.length > 0, "キューが生成されている");
  assert.ok(world.currentCue !== null);
});

test("ちょうどの瞬間に正しい方向へ擦るとPERFECT判定で得点とコンボが増える", () => {
  const world = new VinylScratchWorld();
  const judged: { judgement: string; points: number }[] = [];
  world.onCueJudged = (event) => judged.push(event);

  const direction = world.currentCue?.direction;
  assert.ok(direction);
  if (!direction) return;
  advanceToCurrentCueTime(world);
  world.scratch(direction);

  assert.equal(judged.length, 1);
  assert.equal(judged[0].judgement, "perfect");
  assert.ok(judged[0].points > 0);
  assert.equal(world.score, judged[0].points);
  assert.equal(world.combo, 1);
  assert.equal(world.cueIndex, 1);
  assert.equal(world.hype, START_HYPE, "満タンのハイプは上限でクランプされる");
});

test("連続で正解するほどコンボボーナスにより得点が高くなる", () => {
  const world = new VinylScratchWorld();
  const points: number[] = [];
  world.onCueJudged = (event) => points.push(event.points);

  for (let i = 0; i < 3; i++) {
    const direction = world.currentCue?.direction;
    assert.ok(direction);
    if (!direction) return;
    advanceToCurrentCueTime(world);
    world.scratch(direction);
  }

  assert.equal(points.length, 3);
  assert.ok(points[1] > points[0], "2連続目の方が1回目より高得点");
  assert.ok(points[2] > points[1], "3連続目の方が2回目より高得点");
});

test("違う方向へ擦るとミスになりハイプが減りコンボがリセットされる", () => {
  const world = new VinylScratchWorld();
  const direction = world.currentCue?.direction;
  assert.ok(direction);
  if (!direction) return;
  advanceToCurrentCueTime(world);
  world.scratch(direction);
  assert.equal(world.combo, 1);

  const missed: string[] = [];
  world.onCueMissed = (event) => missed.push(event.reason);

  const nextDirection = world.currentCue?.direction;
  assert.ok(nextDirection);
  if (!nextDirection) return;
  advanceToCurrentCueTime(world);
  world.scratch(oppositeDirection(nextDirection));

  assert.deepEqual(missed, ["wrong"]);
  assert.equal(world.combo, 0);
  assert.ok(world.hype < START_HYPE);
  assert.equal(world.cueIndex, 2);
});

test("方向は正しくてもタイミングが窓を超えるほどずれているとミスになる", () => {
  const world = new VinylScratchWorld();
  const direction = world.currentCue?.direction;
  assert.ok(direction);
  if (!direction) return;

  const missed: string[] = [];
  world.onCueMissed = (event) => missed.push(event.reason);

  // 判定窓よりはっきり早いタイミングで擦る(窓そのものは越えないよう step はしない)。
  world.scratch(direction);

  assert.deepEqual(missed, ["timing"]);
  assert.ok(world.hype < START_HYPE);
});

test("何も入力せず判定窓を過ぎるとタイムアウトでミスになる", () => {
  const world = new VinylScratchWorld();
  const cue = world.currentCue;
  assert.ok(cue);
  if (!cue) return;

  const missed: string[] = [];
  world.onCueMissed = (event) => missed.push(event.reason);

  world.step(cue.time - world.elapsed + GOOD_WINDOW_SECONDS + 0.01);

  assert.deepEqual(missed, ["timeout"]);
  assert.ok(world.hype < START_HYPE);
  assert.equal(world.cueIndex, 1);
});

test("ハイプが尽きるとゲームオーバーになり、以降の操作を無視する", () => {
  const world = new VinylScratchWorld();

  for (let i = 0; i < 20; i++) {
    const direction = world.currentCue?.direction;
    assert.ok(direction);
    if (!direction) return;
    advanceToCurrentCueTime(world);
    world.scratch(oppositeDirection(direction));
    if (world.isOver) break;
  }

  assert.equal(world.isOver, true);
  assert.equal(world.hype, 0);

  const scoreBefore = world.score;
  const cueIndexBefore = world.cueIndex;
  world.step(1);
  world.scratch("forward");
  world.scratch("back");

  assert.equal(world.score, scoreBefore, "ゲームオーバー後は得点が変わらない");
  assert.equal(world.cueIndex, cueIndexBefore, "ゲームオーバー後はキューが進まない");
  assert.equal(world.hype, 0, "ハイプはマイナスにならない");
});

test("ハイプが尽きたあとにreset()すると最初から遊べる", () => {
  const world = new VinylScratchWorld();
  for (let i = 0; i < 20; i++) {
    const direction = world.currentCue?.direction;
    assert.ok(direction);
    if (!direction) return;
    advanceToCurrentCueTime(world);
    world.scratch(oppositeDirection(direction));
    if (world.isOver) break;
  }
  assert.equal(world.isOver, true);

  world.reset();

  assert.equal(world.isOver, false);
  assert.equal(world.hype, START_HYPE);
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.cueIndex, 0);
  assert.ok(world.cues.length > 0, "リセット後もキューが生成されている");
});

test("getVisibleCues は先読み秒数の範囲内にある未判定のキューだけを時間順に返す", () => {
  const world = new VinylScratchWorld();
  const cue = world.currentCue;
  assert.ok(cue);
  if (!cue) return;
  // 最初のキューが先読み秒数の範囲に入るところまで時間を進める。
  world.step(Math.max(0, cue.time - world.elapsed - 0.5));
  const visible = world.getVisibleCues();

  assert.ok(visible.length > 0);
  for (let i = 1; i < visible.length; i++) {
    assert.ok(visible[i].time >= visible[i - 1].time, "時間順に並んでいる");
  }
  for (const visibleCue of visible) {
    assert.ok(visibleCue.secondsUntilHit <= 1.5 + 1e-9);
  }
});

test("時間が経つほどキューの間隔が詰まっていく", () => {
  const world = new VinylScratchWorld();
  const earlyIntervals: number[] = [];
  const lateIntervals: number[] = [];
  let previousCueCount = world.cues.length;

  // 正しい方向で擦り続けてミスによるゲームオーバーを避けながら、
  // 序盤と十分経過した後それぞれで新規生成されたキューの間隔を集める。
  while (world.elapsed < 60) {
    const direction = world.currentCue?.direction;
    assert.ok(direction);
    if (!direction) return;
    advanceToCurrentCueTime(world);
    world.scratch(direction);
    assert.equal(world.isOver, false, "正しい方向で擦り続ければゲームオーバーにならない");

    for (let i = previousCueCount; i < world.cues.length; i++) {
      const interval = world.cues[i].time - world.cues[i - 1].time;
      if (world.elapsed < 10) earlyIntervals.push(interval);
      else if (world.elapsed > 50) lateIntervals.push(interval);
    }
    previousCueCount = world.cues.length;
  }

  assert.ok(earlyIntervals.length > 0 && lateIntervals.length > 0);
  const earlyAverage = earlyIntervals.reduce((a, b) => a + b, 0) / earlyIntervals.length;
  const lateAverage = lateIntervals.reduce((a, b) => a + b, 0) / lateIntervals.length;
  assert.ok(lateAverage < earlyAverage, "時間が経つとキューの間隔が狭くなる");
});
