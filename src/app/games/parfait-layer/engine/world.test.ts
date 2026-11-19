import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeLayerQuality,
  createRecipe,
  GLASS_CAPACITY,
  INGREDIENT_IDS,
  INITIAL_LIVES,
  ParfaitLayerWorld,
} from "./world.ts";

const FRAME = 1 / 60;

/** テストを決定的にするための固定乱数(常に同じ値を返す)。 */
function fixedRandom(value: number): () => number {
  return () => value;
}

/** 連続した値を順に返す乱数(同じ材料が続くケースを再現するため)。 */
function sequenceRandom(values: readonly number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

test("起動直後はラウンド1・ライフ満タン・レシピがあり、注いでも崩れてもいない", () => {
  const world = new ParfaitLayerWorld(fixedRandom(0.5));

  assert.equal(world.round, 1);
  assert.equal(world.score, 0);
  assert.equal(world.lives, INITIAL_LIVES);
  assert.equal(world.recipeIndex, 0);
  assert.equal(world.committedLayers.length, 0);
  assert.equal(world.isPouring, false);
  assert.equal(world.currentPourVolume, 0);
  assert.equal(world.isGameOver, false);
  assert.ok(world.recipe.length >= 3);
  assert.equal(world.selectedIngredientId, INGREDIENT_IDS[0]);
});

test("createRecipe はラウンド1で3層以上、総目標量がグラス容量に収まるレシピを返す", () => {
  const recipe = createRecipe(1, fixedRandom(0.5));
  assert.ok(recipe.length >= 3);
  const totalMax = recipe.reduce((sum, layer) => sum + layer.maxVolume, 0);
  assert.ok(totalMax < GLASS_CAPACITY, `合計目標量がグラス容量未満: ${totalMax}`);
  for (const layer of recipe) {
    assert.ok(layer.minVolume > 0 && layer.minVolume < layer.maxVolume);
  }
});

test("createRecipe はラウンドが進むほど層数が増える", () => {
  const early = createRecipe(1, fixedRandom(0.5));
  const later = createRecipe(7, fixedRandom(0.5));
  assert.ok(later.length > early.length);
});

test("createRecipe は同じ乱数値が続いても隣り合う層の材料が連続しない", () => {
  const recipe = createRecipe(1, fixedRandom(0.1));
  for (let i = 1; i < recipe.length; i++) {
    assert.notEqual(
      recipe[i].ingredientId,
      recipe[i - 1].ingredientId,
      `層${i}が前と重複していない`,
    );
  }
});

test("computeLayerQuality は帯の内側なら常に100、外れるほど下がる", () => {
  const layer = { ingredientId: INGREDIENT_IDS[0], minVolume: 0.2, maxVolume: 0.26 };
  assert.equal(computeLayerQuality(0.2, layer), 100);
  assert.equal(computeLayerQuality(0.23, layer), 100);
  assert.equal(computeLayerQuality(0.26, layer), 100);

  const slightlyOver = computeLayerQuality(0.28, layer);
  const wayOver = computeLayerQuality(0.5, layer);
  assert.ok(slightlyOver < 100 && slightlyOver > 0, "帯からわずかに外れると減点される");
  assert.ok(wayOver < slightlyOver, "大きく外れるほど下がる");
  assert.equal(computeLayerQuality(10, layer), 0, "大きく外れきると0になる");
});

test("startPour → step で流量が増えながら注がれ、stopPour で正しい材料なら層が確定してスコアが増える", () => {
  const world = new ParfaitLayerWorld(fixedRandom(0.5));
  const target = world.currentLayerTarget;
  world.selectIngredient(target.ingredientId);

  world.startPour();
  const center = (target.minVolume + target.maxVolume) / 2;
  // 帯の中心に近づくまで少しずつ注ぐ(長押しの加速も自然に乗る)。
  while (world.currentPourVolume < center && world.isPouring) {
    world.step(FRAME);
  }
  assert.ok(world.currentPourVolume > 0, "注いだ分だけ量が増えている");

  world.stopPour();

  assert.equal(world.isPouring, false);
  assert.equal(world.committedLayers.length, 1);
  assert.equal(world.committedLayers[0].ingredientId, target.ingredientId);
  assert.equal(world.recipeIndex, 1);
  assert.equal(world.currentPourVolume, 0, "確定後は注ぎかけの量がリセットされる");
  assert.ok(world.score > 0, "帯に近い量を注げば得点が入る");
});

test("startPour は既に注いでいる間は再入しても状態を壊さない", () => {
  const world = new ParfaitLayerWorld(fixedRandom(0.5));
  world.startPour();
  world.step(FRAME * 10);
  const volumeBefore = world.currentPourVolume;

  world.startPour(); // 連打しても量がリセットされない

  assert.equal(world.currentPourVolume, volumeBefore);
});

test("stopPour はそもそも注いでいない間に呼んでも何も起きない", () => {
  const world = new ParfaitLayerWorld(fixedRandom(0.5));
  const before = { ...world, committedLayers: [...world.committedLayers] };

  world.stopPour();

  assert.equal(world.recipeIndex, before.recipeIndex);
  assert.equal(world.committedLayers.length, 0);
  assert.equal(world.score, 0);
});

test("違う材料を注いで離すとライフが減り、レシピの進行は進まない(やり直し)", () => {
  const world = new ParfaitLayerWorld(fixedRandom(0.5));
  const target = world.currentLayerTarget;
  const wrongIngredient = INGREDIENT_IDS.find((id) => id !== target.ingredientId);
  assert.ok(wrongIngredient);
  world.selectIngredient(wrongIngredient as (typeof INGREDIENT_IDS)[number]);

  const events: string[] = [];
  world.onPourFailed = (event) => events.push(event.reason);

  world.startPour();
  world.step(FRAME * 5);
  world.stopPour();

  assert.equal(world.lives, INITIAL_LIVES - 1);
  assert.equal(world.recipeIndex, 0, "違う材料では層が確定しない");
  assert.equal(world.committedLayers.length, 0);
  assert.deepEqual(events, ["wrong-ingredient"]);

  // 選び直して正しい材料なら続けられる
  world.selectIngredient(target.ingredientId);
  world.startPour();
  world.step(FRAME * 5);
  world.stopPour();
  assert.equal(world.recipeIndex, 1, "正しい材料で選び直せば層が確定する");
});

test("長押しを続けて容量を超えるほど注ぐと、あふれてライフが減り強制的に注ぎが止まる", () => {
  const world = new ParfaitLayerWorld(fixedRandom(0.5));
  world.selectIngredient(world.currentLayerTarget.ingredientId);

  const events: string[] = [];
  world.onPourFailed = (event) => events.push(event.reason);

  world.startPour();
  for (let i = 0; i < 600 && world.isPouring; i++) world.step(FRAME);

  assert.equal(world.isPouring, false);
  assert.deepEqual(events, ["overflow"]);
  assert.equal(world.lives, INITIAL_LIVES - 1);
  assert.equal(world.currentPourVolume, 0);
});

test("ライフが0になるとゲームオーバーになり、以後の注ぎ操作を無視する", () => {
  const world = new ParfaitLayerWorld(fixedRandom(0.5));
  const target = world.currentLayerTarget;
  const wrongIngredient = INGREDIENT_IDS.find((id) => id !== target.ingredientId);
  assert.ok(wrongIngredient);
  world.selectIngredient(wrongIngredient as (typeof INGREDIENT_IDS)[number]);

  for (let i = 0; i < INITIAL_LIVES; i++) {
    world.startPour();
    world.step(FRAME);
    world.stopPour();
  }

  assert.equal(world.isGameOver, true);
  assert.equal(world.lives, 0);

  world.startPour();
  assert.equal(world.isPouring, false, "ゲームオーバー後は注ぎ始められない");
});

test("レシピを最後まで注ぎ切るとボーナスが入り、次のラウンド(層が増えたレシピ)へ進む", () => {
  const world = new ParfaitLayerWorld(fixedRandom(0.5));
  const events: Array<{ round: number }> = [];
  world.onParfaitCompleted = (event) => events.push({ round: event.round });

  const firstRoundLayerCount = world.recipe.length;
  for (let layer = 0; layer < firstRoundLayerCount; layer++) {
    const target = world.currentLayerTarget;
    world.selectIngredient(target.ingredientId);
    world.startPour();
    const center = (target.minVolume + target.maxVolume) / 2;
    while (world.currentPourVolume < center && world.isPouring) world.step(FRAME);
    world.stopPour();
  }

  assert.equal(world.round, 2);
  assert.equal(world.recipeIndex, 0);
  assert.equal(world.committedLayers.length, 0);
  assert.deepEqual(events, [{ round: 2 }]);
  assert.ok(
    world.score >= firstRoundLayerCount * 100,
    "各層の得点に加えて完成ボーナスが入っている",
  );
});

test("reset() すると進行中の状態を問わず最初の状態に戻る", () => {
  const world = new ParfaitLayerWorld(fixedRandom(0.5));
  const target = world.currentLayerTarget;
  world.selectIngredient(target.ingredientId);
  world.startPour();
  world.step(FRAME * 20);
  world.stopPour();
  assert.ok(world.recipeIndex > 0 || world.score > 0);

  world.reset();

  assert.equal(world.round, 1);
  assert.equal(world.score, 0);
  assert.equal(world.lives, INITIAL_LIVES);
  assert.equal(world.recipeIndex, 0);
  assert.equal(world.committedLayers.length, 0);
  assert.equal(world.isPouring, false);
  assert.equal(world.isGameOver, false);
});

test("cancelPour は採点せずに注ぎを中断し、スコアも進行も変化させない", () => {
  const world = new ParfaitLayerWorld(fixedRandom(0.5));
  world.selectIngredient(world.currentLayerTarget.ingredientId);
  world.startPour();
  world.step(FRAME * 20);
  assert.ok(world.currentPourVolume > 0);

  world.cancelPour();

  assert.equal(world.isPouring, false);
  assert.equal(world.currentPourVolume, 0);
  assert.equal(world.score, 0);
  assert.equal(world.recipeIndex, 0);

  world.cancelPour(); // 注いでいない間に呼んでも何も起きない
  assert.equal(world.currentPourVolume, 0);
});

test("乱数が同じ値を返し続けても createRecipe は無限ループせず層数ぶんのレシピを返す", () => {
  const recipe = createRecipe(5, sequenceRandom([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
  assert.equal(recipe.length, 5);
});
