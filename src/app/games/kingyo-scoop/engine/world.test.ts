import assert from "node:assert/strict";
import { test } from "node:test";
import { CATCH_TIME, FISH_COUNT, KingyoScoopWorld, START_DURABILITY } from "./world.ts";

const WIDTH = 960;
const HEIGHT = 540;
const FRAME = 1 / 60;
const BOB_DIAGONAL_MAX = 26; // 定位置からの揺れの最大距離(振幅18pxの対角)に少し余裕を持たせた値。

function assertFinite(world: KingyoScoopWorld, label: string): void {
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.poi.durability), `${label}: durability`);
  assert.ok(Number.isFinite(world.poi.x) && Number.isFinite(world.poi.y), `${label}: poi 位置`);
  for (const fish of world.fish) {
    assert.ok(Number.isFinite(fish.x) && Number.isFinite(fish.y), `${label}: 金魚の位置`);
    assert.ok(Number.isFinite(fish.vx) && Number.isFinite(fish.vy), `${label}: 金魚の速度`);
  }
}

/** 毎フレーム、網をちょうど金魚の上に正確に重ね続ける(=狙いを外さない)。 */
function parkPoiOnFish(world: KingyoScoopWorld, fishIndex: number): void {
  const fish = world.fish[fishIndex];
  world.setPoiPosition(fish.x, fish.y);
}

test("起動直後は満タンの耐久度・スコア0で、指定数の金魚が各々の定位置付近にいる", () => {
  const world = new KingyoScoopWorld(WIDTH, HEIGHT);

  assert.equal(world.score, 0);
  assert.equal(world.poi.durability, START_DURABILITY);
  assert.equal(world.isOver, false);
  assert.equal(world.fish.length, FISH_COUNT);
  for (const fish of world.fish) {
    const homeX = WIDTH * fish.homeXRatio;
    const homeY = HEIGHT * fish.homeYRatio;
    const distanceFromHome = Math.hypot(fish.x - homeX, fish.y - homeY);
    assert.ok(distanceFromHome <= BOB_DIAGONAL_MAX, "金魚は定位置の近くで揺れている");
  }
});

test("金魚の動きは完全に決定的で、同条件なら毎回同じ軌道になる", () => {
  const worldA = new KingyoScoopWorld(WIDTH, HEIGHT);
  const worldB = new KingyoScoopWorld(WIDTH, HEIGHT);

  for (let i = 0; i < 120; i++) {
    worldA.step(FRAME);
    worldB.step(FRAME);
  }

  for (let i = 0; i < FISH_COUNT; i++) {
    assert.equal(worldA.fish[i].x, worldB.fish[i].x, `${i}番目の金魚のx座標が一致する`);
    assert.equal(worldA.fish[i].y, worldB.fish[i].y, `${i}番目の金魚のy座標が一致する`);
  }
});

test("網を浸けずに動かしているだけでは耐久度が減らない", () => {
  const world = new KingyoScoopWorld(WIDTH, HEIGHT);
  for (let i = 0; i < 120; i++) {
    world.movePoiBy(5, 0);
    world.step(FRAME);
  }
  assert.equal(world.poi.durability, START_DURABILITY, "浸けていない間は紙が傷まない");
  assert.equal(world.score, 0);
});

test("網を金魚に重ねたまま追従させ続けると、CATCH_TIME秒後にすくえてスコアが増える", () => {
  const world = new KingyoScoopWorld(WIDTH, HEIGHT);
  world.setDipped(true);
  const caught: number[] = [];
  world.onCatch = ({ score }) => caught.push(score);

  const framesNeeded = Math.ceil(CATCH_TIME / FRAME) + 2;
  for (let i = 0; i < framesNeeded; i++) {
    parkPoiOnFish(world, 0);
    world.step(FRAME);
    assertFinite(world, `${i}フレーム目`);
  }

  assert.equal(caught.length, 1, "CATCH_TIME経過後にちょうど1匹すくえる");
  assert.equal(world.score, 1);
  assert.ok(world.poi.durability < START_DURABILITY, "すくうと紙が少し傷む");
});

test("すくう途中で網を素早く動かすと進捗がリセットされ、すくえない", () => {
  const world = new KingyoScoopWorld(WIDTH, HEIGHT);
  world.setDipped(true);
  const caught: number[] = [];
  world.onCatch = ({ score }) => caught.push(score);

  const halfway = Math.floor(CATCH_TIME / FRAME / 2);
  for (let i = 0; i < halfway; i++) {
    parkPoiOnFish(world, 0);
    world.step(FRAME);
  }
  assert.ok(world.catchProgress > 0, "途中まで進捗が進んでいる");

  // 網を大きく振って逃げられる速さにする
  world.setPoiPosition(world.poi.x + 500, world.poi.y);
  world.step(FRAME);
  assert.equal(world.catchProgress, 0, "速く動かすと進捗がリセットされる");

  for (let i = 0; i < halfway; i++) {
    world.step(FRAME);
  }
  assert.equal(caught.length, 0, "進捗がリセットされたのでまだすくえていない");
});

test("浸けたまま動かし続けると耐久度が0になり破れてゲームオーバーになる", () => {
  const world = new KingyoScoopWorld(WIDTH, HEIGHT);
  world.setDipped(true);
  const breaks: number[] = [];
  world.onBreak = ({ score }) => breaks.push(score);

  let frame = 0;
  while (!world.isOver && frame < 10_000) {
    // 金魚からは離れた位置で振り続け、すくわずに傷みだけを進める
    world.setPoiPosition(world.width - world.poi.radius, world.height - world.poi.radius);
    world.step(FRAME);
    world.setPoiPosition(world.poi.radius, world.poi.radius);
    world.step(FRAME);
    frame += 2;
    assertFinite(world, `${frame}フレーム目`);
  }

  assert.equal(world.isOver, true, "耐久度が尽きると終了する");
  assert.equal(world.poi.durability, 0);
  assert.equal(breaks.length, 1, "破れたタイミングでonBreakが1回呼ばれる");

  // 終了後に進めても壊れない
  world.step(FRAME);
  assertFinite(world, "終了後");

  world.reset();
  assert.equal(world.isOver, false);
  assert.equal(world.score, 0);
  assert.equal(world.poi.durability, START_DURABILITY);
});

test("すくった金魚は同じ定位置に新しく現れる", () => {
  const world = new KingyoScoopWorld(WIDTH, HEIGHT);
  world.setDipped(true);
  const originalHomeXRatio = world.fish[0].homeXRatio;
  const originalHomeYRatio = world.fish[0].homeYRatio;

  const framesNeeded = Math.ceil(CATCH_TIME / FRAME) + 2;
  for (let i = 0; i < framesNeeded; i++) {
    parkPoiOnFish(world, 0);
    world.step(FRAME);
  }

  assert.equal(world.score, 1, "1匹すくえている");
  assert.equal(
    world.fish[0].homeXRatio,
    originalHomeXRatio,
    "すくった後も同じ定位置スロットを使う",
  );
  assert.equal(world.fish[0].homeYRatio, originalHomeYRatio);
});

test("画面サイズが変わっても網と金魚は池の中に収まり、定位置を基準に追従する", () => {
  const world = new KingyoScoopWorld(WIDTH, HEIGHT);

  world.resize(375, 720);
  assert.ok(world.poi.x >= 0 && world.poi.x <= 375, "網が池の中(x)");
  assert.ok(world.poi.y >= 0 && world.poi.y <= 720, "網が池の中(y)");
  for (const fish of world.fish) {
    assert.ok(fish.x >= 0 && fish.x <= 375, "金魚が池の中(x)");
    assert.ok(fish.y >= 0 && fish.y <= 720, "金魚が池の中(y)");
  }

  for (let i = 0; i < 60; i++) {
    world.step(FRAME);
  }
  assertFinite(world, "リサイズ後");
});
