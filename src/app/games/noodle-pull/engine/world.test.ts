import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeFoldScore,
  createStretchZone,
  FRESHNESS_MAX,
  MAX_SAFE_STRETCH,
  MIN_FOLD_STRETCH,
  NoodlePullWorld,
  ROUND_TRANSITION_SECONDS,
  SNAP_STRETCH,
} from "./world.ts";

const FRAME = 1 / 60;

/** テストを決定的にするための固定乱数(常に同じ値を返す)。 */
function fixedRandom(value: number): () => number {
  return () => value;
}

test("起動直後はラウンド1・鮮度満タン・伸びは0で、束も1本のまま終了していない", () => {
  const world = new NoodlePullWorld(fixedRandom(0.5));

  assert.equal(world.round, 1);
  assert.equal(world.score, 0);
  assert.equal(world.stretch, 0);
  assert.equal(world.freshness, FRESHNESS_MAX);
  assert.equal(world.strandCount, 1);
  assert.equal(world.isRoundOver, false);
  assert.equal(world.roundOverReason, null);
});

test("createStretchZone は MIN_FOLD_STRETCH 以上 MAX_SAFE_STRETCH 以下の範囲を返す", () => {
  const zone = createStretchZone(1, fixedRandom(0.9));
  assert.ok(zone.min >= MIN_FOLD_STRETCH);
  assert.ok(zone.max <= MAX_SAFE_STRETCH);
  assert.ok(zone.min < zone.max);
});

test("ラウンドが進むほど的の幅は狭くなる", () => {
  const wideZone = createStretchZone(1, fixedRandom(0.5));
  const narrowZone = createStretchZone(20, fixedRandom(0.5));
  assert.ok(narrowZone.max - narrowZone.min < wideZone.max - wideZone.min);
});

test("computeFoldScore は的のど真ん中で100、的の外では的から離れるほど下がり遠いと0になる", () => {
  const zone = { min: 0.4, max: 0.6 };
  assert.equal(computeFoldScore(0.5, zone), 100);
  assert.ok(computeFoldScore(0.35, zone) < computeFoldScore(0.5, zone));
  assert.equal(computeFoldScore(2, zone), 0, "的から遠く離れると0点");
});

test("setStretchTarget は1フレームで目標まで飛ばず、速度上限つきで近づく", () => {
  const world = new NoodlePullWorld(fixedRandom(0.5));
  world.setStretchTarget(SNAP_STRETCH, FRAME);
  assert.ok(world.stretch > 0, "目標へ向けて伸びる");
  assert.ok(world.stretch < SNAP_STRETCH, "1フレームでは千切れる伸びまで届かない");
});

test("的の中で離すと「folded」になり、束が倍になって次のラウンドへ進む", () => {
  const world = new NoodlePullWorld(fixedRandom(0.5));
  const target = (world.zone.min + world.zone.max) / 2;
  const events: string[] = [];
  world.onRoundResolved = (event) => events.push(event.reason);

  for (let i = 0; i < 600 && world.stretch < target; i++) {
    world.setStretchTarget(target, FRAME);
  }
  world.attemptFold();

  assert.equal(world.isRoundOver, true);
  assert.equal(world.roundOverReason, "folded");
  assert.ok(world.lastRoundScore >= 70, "的のほぼ中心なので高得点");
  assert.equal(world.strandCount, 2, "成功すると束が倍になる");
  assert.deepEqual(events, ["folded"]);

  world.step(ROUND_TRANSITION_SECONDS + FRAME);
  assert.equal(world.round, 2);
  assert.equal(world.isRoundOver, false);
  assert.equal(world.freshness, FRESHNESS_MAX);
});

test("的を外して離すと「weak」になり、束は増えずに次のラウンドへ進む", () => {
  const world = new NoodlePullWorld(fixedRandom(0.1));
  // 的の下限よりはっきり低い位置まで少しだけ伸ばして離す(浮動小数の誤差で空振り判定に
  // 落ちないよう、MIN_FOLD_STRETCHから十分離す)。
  const shortStretch = Math.max(MIN_FOLD_STRETCH + 0.05, world.zone.min - 0.3);
  for (let i = 0; i < 600 && world.stretch < shortStretch; i++) {
    world.setStretchTarget(shortStretch, FRAME);
  }
  world.attemptFold();

  assert.equal(world.isRoundOver, true);
  assert.equal(world.roundOverReason, "weak");
  assert.equal(world.strandCount, 1, "外すと束は増えない");
});

test("MIN_FOLD_STRETCH未満でattemptFold()しても何も起きない(空振り)", () => {
  const world = new NoodlePullWorld(fixedRandom(0.5));
  world.setStretchTarget(MIN_FOLD_STRETCH / 2, FRAME);
  world.attemptFold();

  assert.equal(world.isRoundOver, false, "緩すぎる状態での空振りはラウンドを終わらせない");
  assert.equal(world.score, 0);
});

test("伸ばしすぎるとattemptFold()を呼ばなくても千切れて0点になる", () => {
  const world = new NoodlePullWorld(fixedRandom(0.5));
  const events: string[] = [];
  world.onRoundResolved = (event) => events.push(event.reason);

  for (let i = 0; i < 600 && !world.isRoundOver; i++) {
    world.setStretchTarget(SNAP_STRETCH + 1, FRAME);
  }

  assert.equal(world.isRoundOver, true);
  assert.equal(world.roundOverReason, "snapped");
  assert.equal(world.lastRoundScore, 0);
  assert.equal(world.score, 0);
  assert.deepEqual(events, ["snapped"]);
});

test("千切れた後は入力を無視し、そのまま放置すると次のラウンドへ自動的に進む", () => {
  const world = new NoodlePullWorld(fixedRandom(0.5));
  for (let i = 0; i < 600 && !world.isRoundOver; i++) {
    world.setStretchTarget(SNAP_STRETCH + 1, FRAME);
  }
  assert.equal(world.isRoundOver, true);

  const snappedStretch = world.stretch;
  world.setStretchTarget(0, FRAME);
  assert.equal(world.stretch, snappedStretch, "終了中は伸びが変化しない(再入しても壊れない)");

  world.step(ROUND_TRANSITION_SECONDS + FRAME);

  assert.equal(world.round, 2);
  assert.equal(world.isRoundOver, false);
  assert.equal(world.stretch, 0);
  assert.equal(world.freshness, FRESHNESS_MAX);
});

test("何もしないと鮮度は時間経過で減り続け、尽きると現在の伸びで採点されて次のラウンドへ進む", () => {
  const world = new NoodlePullWorld(fixedRandom(0.5));
  const freshnessAfterOneSecond = (() => {
    world.step(1);
    return world.freshness;
  })();
  assert.ok(freshnessAfterOneSecond < FRESHNESS_MAX, "鮮度が減っている");

  for (let i = 0; i < 60 * 30 && !world.isRoundOver; i++) world.step(FRAME);

  assert.equal(world.isRoundOver, true);
  assert.equal(world.roundOverReason, "toughened");
  assert.equal(world.freshness, 0);
});

test("attemptFold()を連続で呼んでも(連打しても)2回目以降は何も起きない", () => {
  const world = new NoodlePullWorld(fixedRandom(0.5));
  const target = (world.zone.min + world.zone.max) / 2;
  for (let i = 0; i < 600 && world.stretch < target; i++) world.setStretchTarget(target, FRAME);
  world.attemptFold();
  const scoreAfterFirst = world.score;

  world.attemptFold();
  world.attemptFold();

  assert.equal(world.score, scoreAfterFirst, "2回目以降のattemptFold()は無視される");
});

test("reset() すると進行中のラウンドを問わず最初の状態に戻る", () => {
  const world = new NoodlePullWorld(fixedRandom(0.5));
  const target = (world.zone.min + world.zone.max) / 2;
  for (let i = 0; i < 600 && world.stretch < target; i++) world.setStretchTarget(target, FRAME);
  world.attemptFold();
  world.step(ROUND_TRANSITION_SECONDS + FRAME);
  assert.equal(world.round, 2);

  world.reset();

  assert.equal(world.round, 1);
  assert.equal(world.score, 0);
  assert.equal(world.stretch, 0);
  assert.equal(world.freshness, FRESHNESS_MAX);
  assert.equal(world.strandCount, 1);
  assert.equal(world.isRoundOver, false);
  assert.equal(world.roundOverReason, null);
});
