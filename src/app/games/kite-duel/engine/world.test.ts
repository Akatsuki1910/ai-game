import assert from "node:assert/strict";
import { test } from "node:test";
import { CUT_THRESHOLD, KiteDuelWorld, MAX_ANGLE, ROUND_SECONDS } from "./world.ts";

const WIDTH = 960;
const HEIGHT = 540;
const FRAME = 1 / 60;

function assertFinite(world: KiteDuelWorld, label: string): void {
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.theta), `${label}: theta`);
  assert.ok(Number.isFinite(world.timeRemaining), `${label}: timeRemaining`);
  for (const opponent of world.opponents) {
    assert.ok(Number.isFinite(opponent.x) && Number.isFinite(opponent.y), `${label}: opponent位置`);
    assert.ok(Number.isFinite(opponent.sawPower), `${label}: sawPower`);
  }
}

/** 自分の糸をライバルの糸に正確に重ねた状態を作る(旋回角0=錨の真上=初期ライバルのx)。 */
function alignOnRival(world: KiteDuelWorld): void {
  world.opponents[0].x = world.anchor.x;
  world.opponents[0].vx = 0;
  world.controlAngle = 0;
}

test("起動直後はスコア0・ライバルが1体・時間が満タン", () => {
  const world = new KiteDuelWorld(WIDTH, HEIGHT);

  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.timeRemaining, ROUND_SECONDS);
  assert.equal(world.opponents.length, 1);
  assertFinite(world, "起動直後");
});

test("ポインタ操作で狙い角度が変わり、最大角でクランプされる", () => {
  const world = new KiteDuelWorld(WIDTH, HEIGHT);

  world.setPointerTarget(world.anchor.x + 10, world.anchor.y - 100);
  assert.ok(world.controlAngle > 0, "右にドラッグすると正の角度になる");

  // 錨の真横(真上ではない極端な位置)を狙っても最大角を超えない
  world.setPointerTarget(world.width * 10, world.anchor.y);
  assert.ok(world.controlAngle <= MAX_ANGLE + 1e-9, "最大角でクランプされる");

  world.setPointerTarget(-world.width * 10, world.anchor.y);
  assert.ok(world.controlAngle >= -MAX_ANGLE - 1e-9, "反対側も最大角でクランプされる");
});

test("キーボードでの旋回も最大角でクランプされる", () => {
  const world = new KiteDuelWorld(WIDTH, HEIGHT);

  for (let i = 0; i < 500; i++) world.nudgeControlAngle(1, FRAME);
  assert.ok(world.controlAngle <= MAX_ANGLE + 1e-9, "右旋回を続けても最大角を超えない");

  for (let i = 0; i < 1000; i++) world.nudgeControlAngle(-1, FRAME);
  assert.ok(world.controlAngle >= -MAX_ANGLE - 1e-9, "左旋回を続けても最大角を下回らない");
});

test("凧の向きは狙い角度に追従していく", () => {
  const world = new KiteDuelWorld(WIDTH, HEIGHT);
  world.controlAngle = MAX_ANGLE * 0.5;

  for (let i = 0; i < 120; i++) world.step(FRAME);

  // 風によるわずかな揺さぶりが常に加わるため完全には一致しないが、十分近づく。
  assert.ok(
    Math.abs(world.theta - world.controlAngle) < 0.1,
    "十分な時間が経てば狙い角度にほぼ一致する",
  );
});

test("糸を重ね続けると相手の糸が切れて得点し、湧き直る", () => {
  const world = new KiteDuelWorld(WIDTH, HEIGHT);
  alignOnRival(world);

  const cutEvents: number[] = [];
  world.onKiteCut = ({ points }) => cutEvents.push(points);

  const rivalId = world.opponents[0].id;

  // 重ねたまま(base rateだけ)でも十分な時間で必ず切れる
  for (let i = 0; i < 600 && cutEvents.length === 0; i++) {
    world.opponents[0].x = world.anchor.x;
    world.opponents[0].vx = 0;
    world.step(FRAME);
  }

  assert.equal(cutEvents.length, 1, "1本切れる");
  assert.ok(cutEvents[0] > 0, "得点が入る");
  assert.equal(world.score, cutEvents[0]);
  assert.equal(world.combo, 1);
  assert.equal(world.opponents[0].sawPower, 0, "切れたら湧き直ってsawPowerは0");
  // 個体(id)は使い回されたまま、位置だけが湧き直る(prism-driftのtarget再湧きと同じ方針)。
  assert.equal(world.opponents[0].id, rivalId, "同じ個体のまま位置だけ湧き直る");
  assert.notEqual(world.opponents[0].x, world.anchor.x, "湧き直った位置は錨の真上ではない");
  assertFinite(world, "得点後");
});

test("糸が重ならなければsawPowerは減衰し、切れない", () => {
  const world = new KiteDuelWorld(WIDTH, HEIGHT);
  world.opponents[0].x = world.anchor.x;
  world.opponents[0].vx = 0;
  world.controlAngle = 0;

  for (let i = 0; i < 30; i++) world.step(FRAME);
  assert.ok(world.opponents[0].sawPower > 0, "重なっている間は溜まる");

  // 遠くへ引き離す(糸が絶対に重ならない位置)
  world.opponents[0].x = world.width * 0.01;
  world.opponents[0].vx = 0;
  for (let i = 0; i < 60; i++) {
    world.opponents[0].x = world.width * 0.01;
    world.opponents[0].vx = 0;
    world.step(FRAME);
  }

  assert.equal(world.opponents[0].sawPower, 0, "離れれば0まで減衰する");
  assert.equal(world.score, 0, "得点は入らない");
});

test("素早く旋回しながら重ねるほど速く切れる", () => {
  const still = new KiteDuelWorld(WIDTH, HEIGHT);
  still.opponents[0].x = still.anchor.x;
  still.opponents[0].vx = 0;
  still.controlAngle = 0;

  const sawing = new KiteDuelWorld(WIDTH, HEIGHT);
  sawing.opponents[0].x = sawing.anchor.x;
  sawing.opponents[0].vx = 0;

  const STEPS = 20;
  for (let i = 0; i < STEPS; i++) {
    still.opponents[0].x = still.anchor.x;
    still.opponents[0].vx = 0;
    still.step(FRAME);

    sawing.opponents[0].x = sawing.anchor.x;
    sawing.opponents[0].vx = 0;
    sawing.controlAngle = i % 2 === 0 ? MAX_ANGLE * 0.2 : -MAX_ANGLE * 0.2;
    sawing.step(FRAME);
  }

  assert.ok(
    sawing.opponents[0].sawPower > still.opponents[0].sawPower,
    "旋回速度が乗るぶんsawPowerの伸びが大きい",
  );
});

test("時間切れでラウンドが終わり、リセットで最初から遊べる", () => {
  const world = new KiteDuelWorld(WIDTH, HEIGHT);

  for (let i = 0; i < 2000 && !world.isOver; i++) {
    world.step(0.1);
    assertFinite(world, "ラウンド中");
  }

  assert.equal(world.isOver, true, "ラウンドが終了する");
  assert.equal(world.timeRemaining, 0);

  const scoreAtEnd = world.score;
  world.step(FRAME);
  assert.equal(world.score, scoreAtEnd, "終了後は進めても状態が変わらない");

  world.reset();
  assert.equal(world.isOver, false);
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.timeRemaining, ROUND_SECONDS);
  assert.equal(world.opponents.length, 1);
});

test("画面サイズが変わっても凧とライバルは画面内に収まる", () => {
  const world = new KiteDuelWorld(WIDTH, HEIGHT);

  world.resize(375, 720);
  for (let i = 0; i < 120; i++) world.step(FRAME);

  const kite = world.kitePosition;
  assert.ok(kite.x >= -1 && kite.x <= 376, "凧が画面内(横)");
  assert.ok(kite.y >= -1 && kite.y <= 721, "凧が画面内(縦)");
  for (const opponent of world.opponents) {
    assert.ok(opponent.x >= -1 && opponent.x <= 376, "ライバルが画面内に留まる");
  }
  assertFinite(world, "リサイズ後");
});

test("しきい値に達するまでは何度重ねても切れたことにならない", () => {
  const world = new KiteDuelWorld(WIDTH, HEIGHT);
  world.opponents[0].x = world.anchor.x;
  world.opponents[0].vx = 0;

  world.step(FRAME);
  assert.ok(world.opponents[0].sawPower < CUT_THRESHOLD, "1フレームでは切れない");
  assert.equal(world.score, 0);
});
