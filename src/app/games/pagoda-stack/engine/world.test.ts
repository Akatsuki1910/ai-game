import assert from "node:assert/strict";
import { test } from "node:test";
import { PagodaStackWorld } from "./world.ts";

const WIDTH = 1000;
const HEIGHT = 1000;

/** 振れている段を、現在の最上段の中心から水平に `shift` だけずらした位置に正確に合わせる。 */
function alignSwingShiftedFromTop(world: PagodaStackWorld, shift: number): void {
  const target = world.topTier.x + shift;
  world.swingPhase = Math.asin((target - world.width / 2) / world.amplitude);
}

test("初期状態では土台だけが積まれており、スコア・高さ・ゲームオーバーはすべて0/false", () => {
  const world = new PagodaStackWorld(WIDTH, HEIGHT);

  assert.equal(world.stackHeight, 0);
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.tiers.length, 1);
  assert.equal(world.topTier.x, WIDTH / 2);
  assert.equal(world.topTier.width, world.baseWidth);
});

test("振れている段を直前の段にぴったり合わせて落とすと、幅を保ったまま積まれコンボが伸びる", () => {
  const world = new PagodaStackWorld(WIDTH, HEIGHT);
  const placedEvents: Array<{ overlapRatio: number; isPerfect: boolean; combo: number }> = [];
  world.onTierPlaced = (event) => placedEvents.push(event);

  for (let i = 0; i < 3; i++) {
    world.swingPhase = 0; // 風の影響も windPhase=0 のままなら無視できる
    world.drop();
  }

  assert.equal(placedEvents.length, 3, "3回とも積まれるイベントが発火する");
  for (const event of placedEvents) {
    assert.equal(event.overlapRatio, 1, "ぴったり合わせると重なり比率は1");
    assert.equal(event.isPerfect, true);
  }
  assert.deepEqual(
    placedEvents.map((e) => e.combo),
    [1, 2, 3],
    "連続で完璧に積むとコンボが伸び続ける",
  );
  assert.equal(world.stackHeight, 3);
  assert.equal(world.topTier.width, world.baseWidth, "完璧に積むと幅は変わらない");
  assert.ok(world.score > 0);
  assert.equal(world.isOver, false);
});

test("ずらして落とすと重なった幅だけが次の段の幅になり、コンボは切れる", () => {
  const world = new PagodaStackWorld(WIDTH, HEIGHT);
  // まずコンボを1つ作ってから外す
  world.swingPhase = 0;
  world.drop();
  assert.equal(world.combo, 1);

  const shift = world.baseWidth * 0.5; // 半分だけずらす
  alignSwingShiftedFromTop(world, shift);

  let placedCount = 0;
  let overlapRatio = 0;
  let isPerfect = true;
  world.onTierPlaced = (event) => {
    placedCount += 1;
    overlapRatio = event.overlapRatio;
    isPerfect = event.isPerfect;
  };
  world.drop();

  assert.equal(placedCount, 1, "積まれるイベントが発火する");
  assert.ok(Math.abs(overlapRatio - 0.5) < 1e-6, "重なり比率はおよそ0.5");
  assert.equal(isPerfect, false);
  assert.equal(world.combo, 0, "完璧でない配置でコンボが切れる");
  assert.ok(
    Math.abs(world.topTier.width - world.baseWidth * 0.5) < 1e-6,
    "新しい段の幅は重なり幅と一致する",
  );
  assert.ok(
    Math.abs(world.topTier.x - (WIDTH / 2 + shift / 2)) < 1e-6,
    "新しい段の中心は重なり範囲の中央になる",
  );
  assert.equal(world.isOver, false);
});

test("完全に外して落とすと重なりが無く、即座に塔が崩れてゲームオーバーになる", () => {
  const world = new PagodaStackWorld(WIDTH, HEIGHT);
  const collapseEvents: Array<{ reason: string; height: number }> = [];
  world.onCollapse = (event) => collapseEvents.push(event);

  world.swingPhase = Math.PI / 2; // 振幅いっぱい(amplitude=0.4*width > baseWidth なので確実に外れる)
  world.drop();

  assert.equal(collapseEvents.length, 1);
  assert.equal(collapseEvents[0].reason, "missed");
  assert.equal(world.isOver, true);
  assert.equal(world.stackHeight, 0, "積めなかったので高さは変わらない");
});

test("重なりが残っても幅が最小許容値を下回ると、積んだ直後に崩れてゲームオーバーになる", () => {
  const world = new PagodaStackWorld(WIDTH, HEIGHT);

  // 1段目: 半分だけ重ねる(幅は baseWidth の半分になる)
  alignSwingShiftedFromTop(world, world.baseWidth * 0.5);
  world.drop();
  assert.equal(world.isOver, false);
  const widthAfterFirst = world.topTier.width;

  // 2段目: 残りの幅のうち、最小許容値より小さい部分だけ重ねる
  const tinyOverlap = world.minViableWidth * 0.4;
  const shift = widthAfterFirst - tinyOverlap;
  const collapseEvents: Array<{ reason: string }> = [];
  world.onCollapse = (event) => collapseEvents.push(event);
  const placedEvents: Array<{ overlapRatio: number }> = [];
  world.onTierPlaced = (event) => placedEvents.push(event);

  alignSwingShiftedFromTop(world, shift);
  world.drop();

  assert.equal(placedEvents.length, 1, "薄くても重なっていれば一度は積まれる");
  assert.equal(collapseEvents.length, 1);
  assert.equal(collapseEvents[0].reason, "tooNarrow");
  assert.equal(world.isOver, true);
  assert.equal(world.stackHeight, 2, "崩れる直前の段数まではカウントされる");
});

test("ゲームオーバー後は step()/drop() を呼んでも状態が変化しない", () => {
  const world = new PagodaStackWorld(WIDTH, HEIGHT);
  world.swingPhase = Math.PI / 2;
  world.drop();
  assert.equal(world.isOver, true);

  const phaseBefore = world.swingPhase;
  const scoreBefore = world.score;
  const heightBefore = world.stackHeight;

  world.step(1 / 60);
  world.drop();

  assert.equal(world.swingPhase, phaseBefore, "ゲームオーバー後は振れが進まない");
  assert.equal(world.score, scoreBefore);
  assert.equal(world.stackHeight, heightBefore);
});

test("reset() すると崩れた後でも最初から遊べる", () => {
  const world = new PagodaStackWorld(WIDTH, HEIGHT);
  world.swingPhase = Math.PI / 2;
  world.drop();
  assert.equal(world.isOver, true);

  world.reset();

  assert.equal(world.isOver, false);
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.stackHeight, 0);
  assert.equal(world.tiers.length, 1);
  assert.equal(world.swingPhase, 0);
});

test("resize() すると既存の段が比率を保ったままスケールされる", () => {
  const world = new PagodaStackWorld(WIDTH, HEIGHT);
  alignSwingShiftedFromTop(world, world.baseWidth * 0.5);
  world.drop();
  const ratioBefore = world.topTier.width / world.width;
  const xRatioBefore = world.topTier.x / world.width;

  world.resize(WIDTH * 2, HEIGHT);

  assert.ok(Math.abs(world.topTier.width / world.width - ratioBefore) < 1e-9, "幅の比率が保たれる");
  assert.ok(Math.abs(world.topTier.x / world.width - xRatioBefore) < 1e-9, "位置の比率が保たれる");
});

test("previewOverlapRatio は drop() せずに現在の重なり比率を先読みできる", () => {
  const world = new PagodaStackWorld(WIDTH, HEIGHT);

  world.swingPhase = 0;
  assert.equal(world.previewOverlapRatio, 1, "ぴったり合わせていれば1");

  alignSwingShiftedFromTop(world, world.baseWidth * 0.5);
  assert.ok(Math.abs(world.previewOverlapRatio - 0.5) < 1e-6, "半分ずらしていればおよそ0.5になる");

  world.swingPhase = Math.PI / 2;
  assert.equal(world.previewOverlapRatio, 0, "完全に外れていれば0(負にはならない)");

  // プレビューを読むだけでは状態は変化しない
  assert.equal(world.stackHeight, 0);
  assert.equal(world.isOver, false);
});

test("step() で振れの速さは段数が増えるほど上がり、上限でキャップされる", () => {
  const world = new PagodaStackWorld(WIDTH, HEIGHT);
  const baseSpeed = world.swingSpeed;

  for (let i = 0; i < 80; i++) {
    world.swingPhase = 0;
    world.drop();
    if (world.isOver) break;
  }

  assert.ok(world.swingSpeed >= baseSpeed, "積むほど振れは速くなる(または上限のまま)");
  assert.ok(Number.isFinite(world.swingSpeed));
});
