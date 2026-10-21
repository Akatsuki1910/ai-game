import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CruxHoldWorld,
  drainRateForHeight,
  type Hand,
  START_GRIP,
  sweepSecondsForHeight,
  windowWidthForHeight,
} from "./world.ts";

function oppositeHand(hand: Hand): Hand {
  return hand === "left" ? "right" : "left";
}

/** 現在のリーチを、当たり帯のちょうど中心まで進める(PERFECT判定を狙うため)。 */
function advanceToWindowCenter(world: CruxHoldWorld): void {
  const center = world.windowStart + (world.windowEnd - world.windowStart) / 2;
  const delta = (center - world.reach) * world.sweepSeconds;
  if (delta > 0) world.step(delta);
}

/**
 * step() を経由せず(=時間経過による腕力の増減を起こさず)、リーチだけを
 * 当たり帯の中心へ直接進める。掴み直しボーナスの効果だけを切り出して検証するため。
 */
function forceReachToWindowCenter(world: CruxHoldWorld): void {
  world.reach = world.windowStart + (world.windowEnd - world.windowStart) / 2;
}

test("起動直後は両腕フルの腕力でスコア・高さ・コンボが0になっている", () => {
  const world = new CruxHoldWorld();

  assert.equal(world.leftGrip, START_GRIP);
  assert.equal(world.rightGrip, START_GRIP);
  assert.equal(world.score, 0);
  assert.equal(world.heightClimbed, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.maxCombo, 0);
  assert.equal(world.isOver, false);
  assert.ok(world.requiredHand === "left" || world.requiredHand === "right");
  assert.equal(world.anchorHand, oppositeHand(world.requiredHand));
});

test("当たり帯の中心でちょうどの手を掴むとPERFECT判定で得点とコンボが増え、手が入れ替わる", () => {
  const world = new CruxHoldWorld();
  const judged: { isPerfect: boolean; points: number }[] = [];
  world.onGrabJudged = (event) => judged.push(event);

  const hand = world.requiredHand;
  advanceToWindowCenter(world);
  world.tapHand(hand);

  assert.equal(judged.length, 1);
  assert.equal(judged[0].isPerfect, true);
  assert.ok(judged[0].points > 0);
  assert.equal(world.score, judged[0].points);
  assert.equal(world.combo, 1);
  assert.ok(world.heightClimbed > 0, "高さが進む");
  assert.equal(world.requiredHand, oppositeHand(hand), "次は反対の手が要求される");
});

test("連続で正解するほどコンボボーナスにより得点が高くなる", () => {
  const world = new CruxHoldWorld();
  const points: number[] = [];
  world.onGrabJudged = (event) => points.push(event.points);

  for (let i = 0; i < 3; i++) {
    const hand = world.requiredHand;
    advanceToWindowCenter(world);
    world.tapHand(hand);
  }

  assert.equal(points.length, 3);
  assert.ok(points[1] > points[0], "2連続目の方が1回目より高得点");
  assert.ok(points[2] > points[1], "3連続目の方が2回目より高得点");
});

test("掴んだ直後は新しくアンカーになる手の腕力が回復する(掴み直しの余裕)", () => {
  const world = new CruxHoldWorld();
  // アンカー側を時間経過で消耗させ、1回掴んで役割を入れ替える(レリーフは満タンだと見えないため)。
  world.step(5);
  const firstHand = world.requiredHand;
  forceReachToWindowCenter(world);
  world.tapHand(firstHand);

  // 入れ替わって requiredHand になった手は、さっきまでアンカーとして消耗していたぶん
  // 満タンより低いはず。時間を進めず(回復させず)に、その手の腕力を記録する。
  const nextHand = world.requiredHand;
  const gripBeforeGrab = world.getGrip(nextHand);
  assert.ok(gripBeforeGrab < START_GRIP, "入れ替わった直後はまだ満タンではない");

  forceReachToWindowCenter(world);
  world.tapHand(nextHand);

  assert.ok(
    world.getGrip(nextHand) > gripBeforeGrab,
    "掴んだ手(新しいアンカー)の腕力は掴み直しの分だけ増える",
  );
});

test("要求されていない手を掴もうとするとミスになりコンボがリセットされ、アンカー側の腕力が減る", () => {
  const world = new CruxHoldWorld();
  const hand = world.requiredHand;
  advanceToWindowCenter(world);
  world.tapHand(hand);
  assert.equal(world.combo, 1);

  const missed: string[] = [];
  world.onGrabMissed = (event) => missed.push(event.reason);
  const anchorGripBefore = world.getGrip(world.anchorHand);
  const wrongHand = oppositeHand(world.requiredHand);

  world.tapHand(wrongHand);

  assert.deepEqual(missed, ["wrong-hand"]);
  assert.equal(world.combo, 0);
  assert.ok(world.getGrip(world.anchorHand) < anchorGripBefore || world.isOver);
});

test("正しい手でもタイミングが当たり帯から外れているとミスになる", () => {
  const world = new CruxHoldWorld();
  const hand = world.requiredHand;

  const missed: string[] = [];
  world.onGrabMissed = (event) => missed.push(event.reason);

  // 当たり帯の外側(帯が画面端に来ていても確実に外れる側)まで直接リーチを動かしてから掴む。
  world.reach = world.windowStart >= 0.05 ? world.windowStart - 0.05 : world.windowEnd + 0.05;
  world.tapHand(hand);

  assert.deepEqual(missed, ["timing"]);
});

test("何も掴まずにリーチが1.0へ達すると見逃しミスになる", () => {
  const world = new CruxHoldWorld();
  const missed: string[] = [];
  world.onGrabMissed = (event) => missed.push(event.reason);

  world.step(world.sweepSeconds + 0.01);

  assert.deepEqual(missed, ["timeout"]);
});

test("ミスを繰り返してアンカー側の腕力が尽きると滑落してゲームオーバーになる", () => {
  const world = new CruxHoldWorld();
  const fallEvents: { heightClimbed: number }[] = [];
  world.onFall = (event) => fallEvents.push(event);

  const wrongHand = oppositeHand(world.requiredHand);
  for (let i = 0; i < 20 && !world.isOver; i++) {
    world.tapHand(wrongHand);
  }

  assert.equal(world.isOver, true);
  assert.equal(fallEvents.length, 1);
  assert.ok(world.leftGrip <= 0 || world.rightGrip <= 0);
});

test("ゲームオーバー後は操作しても状態が変化しない", () => {
  const world = new CruxHoldWorld();
  const wrongHand = oppositeHand(world.requiredHand);
  for (let i = 0; i < 20 && !world.isOver; i++) {
    world.tapHand(wrongHand);
  }
  assert.equal(world.isOver, true);

  const scoreBefore = world.score;
  const heightBefore = world.heightClimbed;
  world.step(1);
  world.tapHand("left");
  world.tapHand("right");

  assert.equal(world.score, scoreBefore);
  assert.equal(world.heightClimbed, heightBefore);
});

test("滑落後にreset()すると最初からフルの腕力で遊べる", () => {
  const world = new CruxHoldWorld();
  const wrongHand = oppositeHand(world.requiredHand);
  for (let i = 0; i < 20 && !world.isOver; i++) {
    world.tapHand(wrongHand);
  }
  assert.equal(world.isOver, true);

  world.reset();

  assert.equal(world.isOver, false);
  assert.equal(world.score, 0);
  assert.equal(world.heightClimbed, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.leftGrip, START_GRIP);
  assert.equal(world.rightGrip, START_GRIP);
});

test("難易度関数は登った高さが上がるほど厳しくなり、下限でクランプされる", () => {
  assert.ok(sweepSecondsForHeight(0) > sweepSecondsForHeight(50));
  assert.ok(windowWidthForHeight(0) > windowWidthForHeight(50));
  assert.ok(drainRateForHeight(0) < drainRateForHeight(50));

  assert.ok(sweepSecondsForHeight(100000) >= 1.0);
  assert.ok(windowWidthForHeight(100000) >= 0.15);
  assert.ok(drainRateForHeight(100000) <= 15);
});
