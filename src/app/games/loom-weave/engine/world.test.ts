import assert from "node:assert/strict";
import { test } from "node:test";
import { INTEGRITY_MAX, LoomWeaveWorld, TARGET_ROWS, THREAD_COLORS } from "./world.ts";

function otherColor(color: (typeof THREAD_COLORS)[number]): (typeof THREAD_COLORS)[number] {
  const found = THREAD_COLORS.find((c) => c !== color);
  assert.ok(found, "3色あるので必ず別の色が見つかる");
  return found as (typeof THREAD_COLORS)[number];
}

test("初期状態: キュー・耐久・スコアが揃っている", () => {
  const world = new LoomWeaveWorld();

  assert.equal(world.rows.length, 0);
  assert.equal(world.queue.length, 5, "先読みキューが5件ある");
  assert.ok(THREAD_COLORS.includes(world.activeColor));
  assert.equal(world.upcomingColors.length, world.queue.length - 1);
  assert.equal(world.integrity, INTEGRITY_MAX);
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.outcome, null);
  assert.equal(world.beatRatio, 1, "開始直後はタイマーが満タン");
});

test("正しい色を選ぶと得点が入り、段数が進み、コンボが伸びる", () => {
  const world = new LoomWeaveWorld();
  const events: boolean[] = [];
  world.onBeatResolved = (event) => events.push(event.isCorrect);

  const first = world.activeColor;
  world.selectColor(first);

  assert.equal(world.rows.length, 1);
  assert.equal(world.rows[0].color, first);
  assert.equal(world.rows[0].isFlawed, false);
  assert.equal(world.score, 100);
  assert.equal(world.combo, 1);
  assert.equal(world.integrity, INTEGRITY_MAX, "満タンを超えては回復しない");
  assert.deepEqual(events, [true]);

  const second = world.activeColor;
  world.selectColor(second);
  assert.equal(world.score, 100 + 100 + 25, "2連続正解でコンボボーナスが乗る");
  assert.equal(world.combo, 2);
});

test("間違った色を選ぶと耐久が減りコンボが切れる", () => {
  const world = new LoomWeaveWorld();
  world.selectColor(world.activeColor);
  assert.equal(world.combo, 1);

  const wrong = otherColor(world.activeColor);
  world.selectColor(wrong);

  assert.equal(world.combo, 0, "ミスでコンボが切れる");
  assert.equal(
    world.integrity,
    INTEGRITY_MAX - 20,
    "直前の正解は満タンだったので回復分は反映されない",
  );
  assert.equal(world.rows.at(-1)?.isFlawed, true);
  assert.equal(world.score, 100, "ミスでは加点されない");
});

test("時間切れも自動的にミス扱いになる", () => {
  const world = new LoomWeaveWorld();
  const before = world.integrity;

  world.step(world.beatInterval + 0.01);

  assert.equal(world.rows.length, 1);
  assert.equal(world.rows[0].isFlawed, true, "時間切れはミス");
  assert.ok(world.integrity < before);
});

test("キューは常に一定の長さを保ち、選ばれた色から順に消費される", () => {
  const world = new LoomWeaveWorld();
  const queueLength = world.queue.length;
  const expectedNext = world.activeColor;

  world.selectColor(world.activeColor);

  assert.equal(world.queue.length, queueLength, "消費した分だけ補充される");
  assert.equal(world.rows[0].color, expectedNext);
});

test("耐久が0になると破れて終了し、以後は状態が変化しない", () => {
  const world = new LoomWeaveWorld();

  for (let i = 0; i < 10 && !world.isOver; i++) {
    world.selectColor(otherColor(world.activeColor));
  }

  assert.equal(world.isOver, true);
  assert.equal(world.outcome, "torn");
  assert.equal(world.integrity, 0);

  const rowsAtEnd = world.rows.length;
  world.step(1);
  world.selectColor(world.activeColor);
  assert.equal(world.rows.length, rowsAtEnd, "終了後は入力しても進行しない");
});

test("目標段数まで織り切ると完成して終了する", () => {
  const world = new LoomWeaveWorld();

  for (let i = 0; i < TARGET_ROWS && !world.isOver; i++) {
    world.selectColor(world.activeColor);
  }

  assert.equal(world.isOver, true);
  assert.equal(world.outcome, "finished");
  assert.equal(world.rows.length, TARGET_ROWS);
  assert.ok(world.integrity > 0, "織り切った時点ではまだ生地は無事");
});

test("連続正解すると拍の間隔が短くなっていくが、下限を割らない", () => {
  const world = new LoomWeaveWorld();
  const initialInterval = world.beatInterval;

  for (let i = 0; i < 20 && !world.isOver; i++) {
    world.selectColor(world.activeColor);
  }

  assert.ok(world.beatInterval < initialInterval, "テンポが上がっている");
  assert.ok(world.beatInterval >= 0.55 - 1e-9, "下限を下回らない");
});

test("reset() で初期状態に戻る", () => {
  const world = new LoomWeaveWorld();
  world.selectColor(world.activeColor);
  world.selectColor(otherColor(world.activeColor));

  world.reset();

  assert.equal(world.rows.length, 0);
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.integrity, INTEGRITY_MAX);
  assert.equal(world.isOver, false);
  assert.equal(world.outcome, null);
});
