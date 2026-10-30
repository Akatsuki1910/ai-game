import assert from "node:assert/strict";
import { test } from "node:test";
import { type TossEvent, WokTossWorld } from "./world.ts";

const WIDTH = 800;
const HEIGHT = 600;
const FRAME = 1 / 60;

function assertFinite(world: WokTossWorld, label: string): void {
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.lives), `${label}: lives`);
  assert.ok(Number.isFinite(world.combo), `${label}: combo`);
  assert.ok(Number.isFinite(world.tiltAngle), `${label}: tiltAngle`);
  for (const ingredient of world.ingredients) {
    assert.ok(
      Number.isFinite(ingredient.x) && Number.isFinite(ingredient.y),
      `${label}: ingredient position`,
    );
  }
}

/** 具材をウォック中央の上空に置き、重力落下だけでバウンドさせられる状態を作る。 */
function dropIngredientAboveCenter(world: WokTossWorld, dropHeight: number): void {
  const bounds = world.getWokBounds();
  const ingredient = world.ingredients[0];
  ingredient.x = bounds.centerX;
  ingredient.y = world.surfaceYAt(bounds.centerX) - dropHeight;
  ingredient.vx = 0;
  ingredient.vy = 0;
}

test("起動直後に具材・ライフ・スコアが揃っている", () => {
  const world = new WokTossWorld(WIDTH, HEIGHT);

  assert.ok(world.ingredients.length >= 1, "具材が少なくとも1つ出現している");
  assert.equal(world.score, 0);
  assert.equal(world.lives, 3);
  assert.equal(world.combo, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.tiltAngle, 0);
});

test("傾きの目標値に向かって徐々に追従する", () => {
  const world = new WokTossWorld(WIDTH, HEIGHT);
  world.setTiltTarget(1);

  for (let i = 0; i < 60; i++) world.step(FRAME);

  assert.ok(world.tiltAngle > 0.45, "1秒経つとほぼ最大傾きに近づく");
  assert.ok(world.tiltAngle <= 0.5 + 1e-6, "最大傾き(0.5rad)を超えない");
});

test("具材が落下してウォックの底で弾むとスコア・コンボが増える", () => {
  const world = new WokTossWorld(WIDTH, HEIGHT);
  world.setTiltTarget(0);
  dropIngredientAboveCenter(world, 200);

  const tosses: TossEvent[] = [];
  world.onToss = (event) => tosses.push(event);

  let bounced = false;
  for (let i = 0; i < 90 && !bounced; i++) {
    world.step(FRAME);
    if (tosses.length > 0) bounced = true;
    assertFinite(world, "落下中");
  }

  assert.equal(tosses.length, 1, "1回バウンドした");
  assert.equal(world.combo, 1, "コンボが1になる");
  assert.ok(world.score > 0, "得点が入っている");
  assert.ok(tosses[0].points > 0);

  const ingredient = world.ingredients.find((i) => i.id === tosses[0].ingredient.id);
  assert.ok(ingredient, "弾んだ具材はまだウォックの中にいる");
  assert.ok((ingredient?.vy ?? 0) < 0, "弾んだ直後は上向きの速度を持つ");
});

test("右に傾けて弾ませると右方向へ、左に傾けると左方向へ押し出される", () => {
  const rightWorld = new WokTossWorld(WIDTH, HEIGHT);
  rightWorld.setTiltTarget(1);
  dropIngredientAboveCenter(rightWorld, 200);
  let rightBounceVx: number | null = null;
  rightWorld.onToss = ({ ingredient }) => {
    rightBounceVx = ingredient.vx;
  };
  for (let i = 0; i < 90 && rightBounceVx === null; i++) rightWorld.step(FRAME);
  assert.ok(rightBounceVx !== null, "右傾きでバウンドが発生する");
  assert.ok((rightBounceVx ?? 0) > 0, "右に傾けると右方向へ押し出される");

  const leftWorld = new WokTossWorld(WIDTH, HEIGHT);
  leftWorld.setTiltTarget(-1);
  dropIngredientAboveCenter(leftWorld, 200);
  let leftBounceVx: number | null = null;
  leftWorld.onToss = ({ ingredient }) => {
    leftBounceVx = ingredient.vx;
  };
  for (let i = 0; i < 90 && leftBounceVx === null; i++) leftWorld.step(FRAME);
  assert.ok(leftBounceVx !== null, "左傾きでバウンドが発生する");
  assert.ok((leftBounceVx ?? 0) < 0, "左に傾けると左方向へ押し出される");
});

test("ウォックの外(縁の高さより下)に落ちるとライフが減りコンボがリセットされる", () => {
  const world = new WokTossWorld(WIDTH, HEIGHT);
  const bounds = world.getWokBounds();
  const ingredient = world.ingredients[0];
  world.combo = 4;

  ingredient.x = bounds.centerX + bounds.halfWidth + ingredient.radius * 2;
  ingredient.y = world.surfaceYAt(ingredient.x) - ingredient.radius + 5;
  ingredient.vx = 0;
  ingredient.vy = 50;

  const misses: number[] = [];
  world.onMiss = ({ livesRemaining }) => misses.push(livesRemaining);

  world.step(FRAME);

  assert.equal(misses.length, 1, "縁の外に落ちたらミス判定になる");
  assert.equal(world.lives, 2, "ライフが1減る");
  assert.equal(world.combo, 0, "コンボがリセットされる");
  assert.ok(!world.ingredients.some((i) => i.id === ingredient.id), "こぼれた具材は取り除かれる");
  assertFinite(world, "ミス後");
});

test("ライフが0になるとゲームオーバーになり、以後stepしても壊れない", () => {
  const world = new WokTossWorld(WIDTH, HEIGHT);
  const bounds = world.getWokBounds();

  for (let miss = 0; miss < 3; miss++) {
    if (world.ingredients.length === 0) {
      // ランダム出現タイマーが働くまで進める(通常は即座に補充されるため実際には到達しない)
      for (let i = 0; i < 180 && world.ingredients.length === 0; i++) world.step(FRAME);
    }
    const ingredient = world.ingredients[0];
    ingredient.x = bounds.centerX + bounds.halfWidth + ingredient.radius * 2;
    ingredient.y = world.surfaceYAt(ingredient.x) - ingredient.radius + 5;
    ingredient.vx = 0;
    ingredient.vy = 50;
    world.step(FRAME);
  }

  assert.equal(world.isOver, true, "3回こぼすとゲームオーバーになる");
  assert.equal(world.lives, 0);

  const scoreBefore = world.score;
  world.step(FRAME);
  assert.equal(world.score, scoreBefore, "ゲームオーバー後はstepしても状態が変わらない");
  assertFinite(world, "ゲームオーバー後");

  world.reset();
  assert.equal(world.isOver, false);
  assert.equal(world.lives, 3);
  assert.equal(world.score, 0);
  assert.ok(world.ingredients.length >= 1, "リセットで具材が出現し直す");
});

test("画面サイズが変わってもウォックと具材が破綻しない", () => {
  const world = new WokTossWorld(WIDTH, HEIGHT);

  world.resize(375, 720);
  assertFinite(world, "リサイズ直後");
  const boundsAfterShrink = world.getWokBounds();
  assert.ok(boundsAfterShrink.centerX > 0 && boundsAfterShrink.centerX < 375);

  for (let i = 0; i < 60; i++) world.step(FRAME);
  assertFinite(world, "リサイズ後に進行");

  world.resize(1024, 480);
  for (let i = 0; i < 60; i++) world.step(FRAME);
  assertFinite(world, "再度リサイズ後");
});
