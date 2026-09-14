import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BAND_COUNT,
  computeScore,
  createTargetProfile,
  MAX_RADIUS,
  MIN_RADIUS,
  MOISTURE_MAX,
  ROUND_TRANSITION_SECONDS,
  WheelThrowWorld,
} from "./world.ts";

const FRAME = 1 / 60;

/** テストを決定的にするための固定乱数(常に同じ値を返す)。 */
function fixedRandom(value: number): () => number {
  return () => value;
}

test("起動直後はラウンド1・水分満タン・全帯が初期半径で、崩壊も終了もしていない", () => {
  const world = new WheelThrowWorld(fixedRandom(0.5));

  assert.equal(world.round, 1);
  assert.equal(world.score, 0);
  assert.equal(world.moisture, MOISTURE_MAX);
  assert.equal(world.radii.length, BAND_COUNT);
  assert.equal(world.target.length, BAND_COUNT);
  assert.equal(world.isRoundOver, false);
  assert.equal(world.roundOverReason, null);
  for (const radius of world.radii) assert.ok(radius > 0 && radius < MAX_RADIUS);
});

test("createTargetProfile は BAND_COUNT 個の値を [MIN_RADIUS, MAX_RADIUS] の範囲で返す", () => {
  const target = createTargetProfile(1, fixedRandom(0.9));
  assert.equal(target.length, BAND_COUNT);
  for (const radius of target) {
    assert.ok(radius >= 0 && radius <= MAX_RADIUS, `半径が範囲内: ${radius}`);
  }
});

test("computeScore は完全一致で100、大きくずれると0に近づく", () => {
  const target = createTargetProfile(1, fixedRandom(0.5));
  assert.equal(computeScore(target, target), 100);

  const worstCase = target.map((value) => (value > 0.5 ? MIN_RADIUS : MAX_RADIUS));
  const worstScore = computeScore(worstCase, target);
  assert.ok(worstScore < computeScore(target, target), "大きくずれるほどスコアが下がる");
});

test("applyPressure は1フレームで desiredRadius まで飛ばず、速度上限つきで近づく", () => {
  const world = new WheelThrowWorld(fixedRandom(0.5));
  const before = world.radii[0];
  world.applyPressure(0, MAX_RADIUS, FRAME);
  const after = world.radii[0];

  assert.ok(after > before, "目標へ向けて増える");
  assert.ok(after < MAX_RADIUS, "1フレームでは目標に到達しない");
});

test("applyPressure を目標の半径ちょうどに繰り返すとオーバーシュートせずぴったり止まる", () => {
  const world = new WheelThrowWorld(fixedRandom(0.5));
  const desired = 0.7;
  for (let i = 0; i < 600; i++) world.applyPressure(3, desired, FRAME);

  assert.ok(Math.abs(world.radii[3] - desired) < 1e-6, "目標値でぴったり静止する");
});

test("帯を中心近くまで押し込み続けると崩壊し、そのラウンドは0点で終わる", () => {
  const world = new WheelThrowWorld(fixedRandom(0.5));
  const events: string[] = [];
  world.onRoundResolved = (event) => events.push(event.reason);

  for (let i = 0; i < 120 && !world.isRoundOver; i++) {
    world.applyPressure(5, 0, FRAME);
  }

  assert.equal(world.isRoundOver, true);
  assert.equal(world.roundOverReason, "collapsed");
  assert.equal(world.lastRoundScore, 0);
  assert.equal(world.score, 0);
  assert.deepEqual(events, ["collapsed"]);
});

test("崩壊後は入力を無視し、そのまま放置すると次のラウンドへ自動的に進む", () => {
  const world = new WheelThrowWorld(fixedRandom(0.5));
  for (let i = 0; i < 120 && !world.isRoundOver; i++) world.applyPressure(5, 0, FRAME);
  assert.equal(world.isRoundOver, true);

  const collapsedRadius = world.radii[5];
  world.applyPressure(5, MAX_RADIUS, FRAME);
  assert.equal(world.radii[5], collapsedRadius, "終了中は形が変化しない(再入しても壊れない)");

  world.step(ROUND_TRANSITION_SECONDS + FRAME);

  assert.equal(world.round, 2);
  assert.equal(world.isRoundOver, false);
  assert.equal(world.moisture, MOISTURE_MAX);
  for (const radius of world.radii) assert.ok(radius > MIN_RADIUS);
});

test("finishNow() は水分が残っていてもその場でラウンドを終え、形の近さぶんスコアが加算される", () => {
  const world = new WheelThrowWorld(fixedRandom(0.5));
  world.radii = world.target.slice();

  world.finishNow();

  assert.equal(world.isRoundOver, true);
  assert.equal(world.roundOverReason, "manual");
  assert.equal(world.lastRoundScore, 100);
  assert.equal(world.score, 100);
});

test("finishNow() を連続で呼んでも(連打しても)2回目以降は何も起きない", () => {
  const world = new WheelThrowWorld(fixedRandom(0.5));
  world.radii = world.target.slice();
  world.finishNow();
  const scoreAfterFirst = world.score;

  world.finishNow();
  world.finishNow();

  assert.equal(world.score, scoreAfterFirst, "2回目以降のfinishNow()は無視される");
});

test("水分は時間経過で減り続け、尽きると自動的に乾燥終了する", () => {
  const world = new WheelThrowWorld(fixedRandom(0.5));
  const moistureAfterOneSecond = (() => {
    world.step(1);
    return world.moisture;
  })();
  assert.ok(moistureAfterOneSecond < MOISTURE_MAX, "水分が減っている");

  for (let i = 0; i < 60 * 30 && !world.isRoundOver; i++) world.step(FRAME);

  assert.equal(world.isRoundOver, true);
  assert.equal(world.roundOverReason, "dried");
  assert.equal(world.moisture, 0);
});

test("adjustRadiusAtCursor はカーソル位置の帯だけを、押した方向の限界へ動かす", () => {
  const world = new WheelThrowWorld(fixedRandom(0.5));
  world.moveCursorBy(-999); // 下限(index 0)へ寄せる
  assert.equal(world.cursorBandIndex, 0);
  const otherBandBefore = world.radii[BAND_COUNT - 1];

  world.adjustRadiusAtCursor(-1, FRAME);
  assert.ok(world.radii[0] < world.radii[BAND_COUNT - 1], "カーソルの帯だけ縮む");
  assert.equal(world.radii[BAND_COUNT - 1], otherBandBefore, "他の帯は変化しない");

  world.moveCursorBy(999); // 上限(index BAND_COUNT-1)へ寄せる
  assert.equal(world.cursorBandIndex, BAND_COUNT - 1);
  world.adjustRadiusAtCursor(1, FRAME);
  assert.ok(world.radii[BAND_COUNT - 1] > otherBandBefore, "反対方向へも動かせる");
});

test("moveCursorBy は範囲外に出ようとしても [0, BAND_COUNT-1] にクランプされる", () => {
  const world = new WheelThrowWorld(fixedRandom(0.5));
  world.moveCursorBy(-1000);
  assert.equal(world.cursorBandIndex, 0);
  world.moveCursorBy(1000);
  assert.equal(world.cursorBandIndex, BAND_COUNT - 1);
});

test("reset() すると進行中のラウンドを問わず最初の状態に戻る", () => {
  const world = new WheelThrowWorld(fixedRandom(0.5));
  world.radii = world.target.slice();
  world.finishNow();
  world.step(ROUND_TRANSITION_SECONDS + FRAME);
  assert.equal(world.round, 2);

  world.reset();

  assert.equal(world.round, 1);
  assert.equal(world.score, 0);
  assert.equal(world.moisture, MOISTURE_MAX);
  assert.equal(world.isRoundOver, false);
  assert.equal(world.roundOverReason, null);
});
