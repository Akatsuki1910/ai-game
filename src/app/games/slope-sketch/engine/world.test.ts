import assert from "node:assert/strict";
import { test } from "node:test";
import { bucketToScreenX, CHALK_MAX, SlopeSketchWorld, VISIBLE_BUCKETS } from "./world.ts";

const WIDTH = 960;
const HEIGHT = 540;
const FRAME = 1 / 60;
const BUCKET_WIDTH = WIDTH / VISIBLE_BUCKETS;

function assertFinite(world: SlopeSketchWorld, label: string): void {
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.scrollBuckets), `${label}: scrollBuckets`);
  assert.ok(Number.isFinite(world.chalkRemaining), `${label}: chalkRemaining`);
  assert.ok(Number.isFinite(world.ball.yFrac), `${label}: ball.yFrac`);
  assert.ok(Number.isFinite(world.ball.velocityYFrac), `${label}: ball.velocityYFrac`);
}

test("起動直後は安全地帯の上で球が止まっている", () => {
  const world = new SlopeSketchWorld(WIDTH, HEIGHT);

  assert.equal(world.score, 0);
  assert.equal(world.chalkRemaining, CHALK_MAX);
  assert.equal(world.isOver, false);
  assert.equal(world.ball.isGrounded, true);
  assert.ok(world.getTerrainHeightAt(world.ballBucket) !== null, "開始地点に地面がある");
});

test("何も描かずに進むと安全地帯を越えて滑落し、ゲームオーバーになる", () => {
  const world = new SlopeSketchWorld(WIDTH, HEIGHT);

  let becameAirborne = false;
  for (let i = 0; i < 1200 && !world.isOver; i++) {
    world.step(FRAME);
    if (!world.ball.isGrounded) becameAirborne = true;
    assertFinite(world, "滑落中");
  }

  assert.ok(becameAirborne, "地面が無い区間で宙に浮く状態を経験する");
  assert.equal(world.isOver, true, "放置すると滑落してゲームオーバーになる");
  assert.ok(world.ball.yFrac > 1, "画面外まで落ちている");
});

test("安全地帯の先にチョークで地面を描くと支えられて生き続ける", () => {
  const world = new SlopeSketchWorld(WIDTH, HEIGHT);

  // 安全地帯のすぐ先（バケット27〜40あたり）を、球がそこへ到達する前にずっと塗っておく。
  for (let bucket = 27; bucket <= 40; bucket++) {
    const screenX = bucketToScreenX(world, bucket);
    world.paint(screenX, HEIGHT * 0.6);
  }
  world.endStroke();

  for (let i = 0; i < 300 && !world.isOver; i++) {
    // このテストの対象は「描いた地面に支えられること」。乱数で湧くスパイクとの
    // 衝突判定は別テストの責務なので、ここでは湧かせないようにして検証を分離する。
    world.hazards = [];
    world.step(FRAME);
    assertFinite(world, "描画した地面の上");
  }

  assert.equal(world.isOver, false, "描いた地面があれば滑落しない");
  assert.ok(world.ball.isGrounded, "描いた地面の上で接地している");
});

test("チョークは描くほど減り、描かなければ回復する", () => {
  const world = new SlopeSketchWorld(WIDTH, HEIGHT);

  for (let bucket = 0; bucket < 30; bucket++) {
    world.paint(bucketToScreenX(world, bucket), HEIGHT * 0.5);
  }
  assert.ok(world.chalkRemaining < CHALK_MAX, "描くとチョークが減る");

  const depleted = world.chalkRemaining;
  // チョークが尽きたバケットには新しい高さが書き込まれない。
  const untouchedBucket = 500;
  world.paint(bucketToScreenX(world, untouchedBucket), HEIGHT * 0.2);
  if (depleted <= 0) {
    assert.equal(world.getTerrainHeightAt(untouchedBucket), null, "チョークが尽きると描けない");
  }

  world.endStroke();
  for (let i = 0; i < 120; i++) world.step(FRAME);
  assert.ok(world.chalkRemaining > depleted, "描かない間にチョークが回復する");
});

test("タイミングを合わせて宝石の高さに重なると加点される", () => {
  const world = new SlopeSketchWorld(WIDTH, HEIGHT);
  const bucket = world.ballBucket;
  world.gems = [{ bucket, heightFrac: world.ball.yFrac, isCollected: false }];

  world.step(FRAME);

  assert.equal(world.gems[0].isCollected, true, "球と同じ高さの宝石が取れる");
  assert.ok(world.score > 0, "加点されている");
});

test("スパイク(障害物)に触れるとゲームオーバーになる", () => {
  const world = new SlopeSketchWorld(WIDTH, HEIGHT);
  const bucket = world.ballBucket;
  world.hazards = [{ bucket, fromFrac: world.ball.yFrac - 0.05, toFrac: world.ball.yFrac + 0.05 }];

  world.step(FRAME);

  assert.equal(world.isOver, true, "スパイクに当たるとゲームオーバー");
});

test("reset() で最初の状態に戻る", () => {
  const world = new SlopeSketchWorld(WIDTH, HEIGHT);

  for (let i = 0; i < 400 && !world.isOver; i++) world.step(FRAME);
  assert.ok(world.scrollBuckets > 0);

  world.reset();

  assert.equal(world.score, 0);
  assert.equal(world.chalkRemaining, CHALK_MAX);
  assert.equal(world.isOver, false);
  assert.equal(world.scrollBuckets, 0);
  assert.equal(world.hazards.length, 0);
  assert.equal(world.gems.length, 0);
  assert.equal(world.ball.isGrounded, true);
});

test("ゲームオーバー後に step() を呼んでも状態が壊れない", () => {
  const world = new SlopeSketchWorld(WIDTH, HEIGHT);
  for (let i = 0; i < 1200 && !world.isOver; i++) world.step(FRAME);
  assert.equal(world.isOver, true);

  const scoreAtOver = world.score;
  world.step(FRAME);
  world.step(FRAME);

  assert.equal(world.score, scoreAtOver, "ゲームオーバー後はスコアが変化しない");
  assertFinite(world, "ゲームオーバー後");
});

test("画面サイズが変わっても描画と更新が壊れない", () => {
  const world = new SlopeSketchWorld(WIDTH, HEIGHT);

  world.resize(375, 720);
  assert.equal(world.width, 375);
  assert.equal(world.height, 720);

  world.paint(bucketToScreenX(world, 27), 720 * 0.5);
  for (let i = 0; i < 60; i++) world.step(FRAME);

  assertFinite(world, "リサイズ後");
});

test("bucketToScreenX はスクロール量と画面幅からX座標を算出する", () => {
  const world = new SlopeSketchWorld(WIDTH, HEIGHT);
  world.scrollBuckets = 10;

  assert.equal(bucketToScreenX(world, 10), 0, "現在のバケットは画面左端ではなくスクロール基準0");
  assert.equal(bucketToScreenX(world, 11), BUCKET_WIDTH);
  assert.equal(bucketToScreenX(world, 9), -BUCKET_WIDTH);
});
