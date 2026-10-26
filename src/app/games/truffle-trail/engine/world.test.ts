import assert from "node:assert/strict";
import { test } from "node:test";
import { MISS_LIMIT, TruffleTrailWorld } from "./world.ts";

const WIDTH = 960;
const HEIGHT = 540;
const FRAME = 1 / 60;

/** 対象のトリュフを犬のちょうど真下（距離0）へ移動させる。 */
function parkTruffleOnDog(world: TruffleTrailWorld, index: number): void {
  const truffle = world.truffles[index];
  truffle.x = world.dogX;
  truffle.y = world.dogY;
}

function assertFinite(world: TruffleTrailWorld, label: string): void {
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.dogX) && Number.isFinite(world.dogY), `${label}: 犬の位置`);
  for (const truffle of world.truffles) {
    assert.ok(Number.isFinite(truffle.x) && Number.isFinite(truffle.y), `${label}: トリュフの位置`);
    assert.ok(Number.isFinite(truffle.digProgress), `${label}: digProgress`);
  }
}

test("起動直後に犬と最初のトリュフが画面内に配置されている", () => {
  const world = new TruffleTrailWorld(WIDTH, HEIGHT);

  assert.ok(world.dogX >= 0 && world.dogX <= WIDTH, "犬が画面内にいる");
  assert.ok(world.dogY >= 0 && world.dogY <= HEIGHT, "犬が画面内にいる");
  assert.equal(world.truffles.length, 2, "最初は2つのトリュフが埋まっている");
  for (const truffle of world.truffles) {
    assert.equal(truffle.isLocated, false, "最初は見つかっていない");
  }
  assert.equal(world.score, 0);
  assert.equal(world.missed, 0);
  assert.equal(world.isOver, false);
});

test("移動先を指定すると犬がそこへ向かって進み、画面外には出ない", () => {
  const world = new TruffleTrailWorld(WIDTH, HEIGHT);
  world.setMoveTarget(WIDTH * 0.8, HEIGHT * 0.2);

  const start = { x: world.dogX, y: world.dogY };
  world.step(FRAME);
  const moved = Math.hypot(world.dogX - start.x, world.dogY - start.y);
  assert.ok(moved > 0, "1フレームで犬が動く");

  for (let i = 0; i < 300; i++) world.step(FRAME);
  assert.ok(
    Math.hypot(world.dogX - WIDTH * 0.8, world.dogY - HEIGHT * 0.2) < 1,
    "目的地に到達する",
  );

  // 画面外を指定しても内側にクランプされる
  world.setMoveTarget(-9999, 9999);
  for (let i = 0; i < 300; i++) world.step(FRAME);
  assert.ok(world.dogX >= 0 && world.dogX <= WIDTH, "犬が画面内に留まる");
  assert.ok(world.dogY >= 0 && world.dogY <= HEIGHT, "犬が画面内に留まる");
});

test("トリュフに近づくほど匂いの強さ(scentStrength)が上がる", () => {
  const world = new TruffleTrailWorld(WIDTH, HEIGHT);
  world.truffles = [world.truffles[0]];
  const truffle = world.truffles[0];
  truffle.x = WIDTH * 0.5;
  truffle.y = HEIGHT * 0.5;

  world.dogX = truffle.x - 400;
  world.dogY = truffle.y;
  const far = world.scentStrength;

  world.dogX = truffle.x - 50;
  world.dogY = truffle.y;
  const near = world.scentStrength;

  assert.ok(far >= 0 && far <= 1, "匂いは0〜1の範囲");
  assert.ok(near > far, "近づくほど匂いが強くなる");

  world.dogX = truffle.x;
  world.dogY = truffle.y;
  assert.equal(world.scentStrength, 1, "真上では最大");
});

test("見つけて掘りきると得点が入りトリュフが消え、次のトリュフが湧く", () => {
  const world = new TruffleTrailWorld(WIDTH, HEIGHT);
  parkTruffleOnDog(world, 0);
  const target = world.truffles[0];
  const targetId = target.id;

  const dugEvents: number[] = [];
  world.onTruffleDug = ({ points }) => dugEvents.push(points);

  world.setDigHeld(true);
  world.step(FRAME);
  assert.equal(target.isLocated, true, "近づくと見つかる");
  assert.ok(target.digProgress > 0, "掘り始めると進行度が増える");

  for (let i = 0; i < 180 && dugEvents.length === 0; i++) {
    world.step(FRAME);
  }

  assert.equal(dugEvents.length, 1, "トリュフを1つ掘り切った");
  assert.ok(dugEvents[0] > 0, "得点が入っている");
  assert.equal(world.score, dugEvents[0]);
  assert.equal(world.dugCount, 1);
  assert.ok(
    world.truffles.every((t) => t.id !== targetId),
    "掘り切ったトリュフは除去される",
  );
  assert.equal(world.truffles.length, 2, "個体数が維持されるよう新しいトリュフが湧く");
  assertFinite(world, "得点後");
});

test("掘る手を離すと進行度が減っていく(キャンセルされる)", () => {
  const world = new TruffleTrailWorld(WIDTH, HEIGHT);
  parkTruffleOnDog(world, 0);
  const truffle = world.truffles[0];

  world.setDigHeld(true);
  for (let i = 0; i < 20; i++) world.step(FRAME);
  const progress = truffle.digProgress;
  assert.ok(progress > 0 && progress < 1, "掘り途中である");

  world.setDigHeld(false);
  world.step(FRAME);
  assert.ok(truffle.digProgress < progress, "手を離すと進行度が減る");
});

test("見つける前(遠く)に手を離さず押していても掘れない", () => {
  const world = new TruffleTrailWorld(WIDTH, HEIGHT);
  const truffle = world.truffles[0];
  truffle.x = 0;
  truffle.y = 0;
  world.dogX = WIDTH;
  world.dogY = HEIGHT;

  world.setDigHeld(true);
  for (let i = 0; i < 10; i++) world.step(FRAME);

  assert.equal(truffle.isLocated, false, "遠いままでは見つからない");
  assert.equal(truffle.digProgress, 0, "見つかっていないので掘れない");
});

test("時間内に掘りきれないトリュフは腐ってミス扱いになり、上限に達するとゲームオーバーになる", () => {
  const world = new TruffleTrailWorld(WIDTH, HEIGHT);
  const lostEvents: number[] = [];
  world.onTruffleLost = () => lostEvents.push(1);

  for (let i = 0; i < MISS_LIMIT && !world.isOver; i++) {
    for (const truffle of world.truffles) truffle.remainingSeconds = 0.01;
    world.step(0.1);
    assertFinite(world, "ミス処理中");
  }

  assert.equal(world.isOver, true, "ミス上限でゲームオーバーになる");
  assert.ok(world.missed >= MISS_LIMIT, "ミス数が上限に達している");
  assert.ok(lostEvents.length >= MISS_LIMIT, "ロストイベントが発火している");

  // 終了後に進めても壊れない（状態が変わらない）
  const missedAfterOver = world.missed;
  const scoreAfterOver = world.score;
  world.step(FRAME);
  assert.equal(world.missed, missedAfterOver, "終了後はミスが増えない");
  assert.equal(world.score, scoreAfterOver, "終了後は得点が増えない");

  world.reset();
  assert.equal(world.isOver, false);
  assert.equal(world.score, 0);
  assert.equal(world.missed, 0);
  assert.equal(world.dugCount, 0);
  assert.ok(world.truffles.length > 0, "リセットでトリュフが再配置される");
});

test("掘り切るたびに同時に探すトリュフの数と難易度が上がる", () => {
  const world = new TruffleTrailWorld(WIDTH, HEIGHT);

  for (let dug = 0; dug < 3; dug++) {
    parkTruffleOnDog(world, 0);
    world.setDigHeld(true);
    for (let i = 0; i < 300 && world.dugCount === dug; i++) {
      parkTruffleOnDog(world, 0);
      world.step(FRAME);
    }
  }

  assert.equal(world.dugCount, 3, "3つ掘り切った");
  assert.equal(world.truffles.length, 3, "同時に探すトリュフが3つに増える");
});

test("画面サイズが変わっても犬とトリュフが画面内に収まる", () => {
  const world = new TruffleTrailWorld(WIDTH, HEIGHT);

  world.resize(375, 720);
  assert.ok(world.dogX >= -1 && world.dogX <= 376, "犬が画面内");
  assert.ok(world.dogY >= -1 && world.dogY <= 721, "犬が画面内");
  for (const truffle of world.truffles) {
    assert.ok(truffle.x >= -1 && truffle.x <= 376, "トリュフが画面内");
    assert.ok(truffle.y >= -1 && truffle.y <= 721, "トリュフが画面内");
  }

  for (let i = 0; i < 60; i++) world.step(FRAME);
  assertFinite(world, "リサイズ後");
});
