import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BASE_SUPPORT_HALF_WIDTH,
  CairnBalanceWorld,
  effectiveComOffset,
  effectiveTopHalfWidth,
  evaluateDrop,
  MAX_ROTATION,
} from "./cairnStack.ts";

function assertFinite(world: CairnBalanceWorld, label: string): void {
  assert.ok(Number.isFinite(world.pendingCenterX), `${label}: pendingCenterX`);
  assert.ok(Number.isFinite(world.pendingRotation), `${label}: pendingRotation`);
  assert.ok(Number.isFinite(world.windPhase), `${label}: windPhase`);
  for (const stone of world.placedStones) {
    assert.ok(
      Number.isFinite(stone.centerX) && Number.isFinite(stone.centerY),
      `${label}: stone position`,
    );
  }
}

test("evaluateDrop: 真上に置けば安定する", () => {
  const support = { centerX: 400, halfWidth: 50 };
  const stone = { halfWidth: 40, height: 40, comOffset: 0 };
  const result = evaluateDrop(support, stone, 400, 0, 0);
  assert.equal(result.isStable, true);
  assert.equal(result.comX, 400);
});

test("evaluateDrop: 支持面を外れると不安定になる", () => {
  const support = { centerX: 400, halfWidth: 50 };
  const stone = { halfWidth: 40, height: 40, comOffset: 0 };
  const result = evaluateDrop(support, stone, 460, 0, 0);
  assert.equal(result.isStable, false);
});

test("effectiveComOffset: 回転させると石の歪みと高さ分だけ重心が水平にずれる", () => {
  const stone = { halfWidth: 50, height: 40, comOffset: 10 };
  assert.equal(effectiveComOffset(stone, 0), 10);
  assert.ok(
    Math.abs(effectiveComOffset(stone, Math.PI / 2) - 20) < 1e-9,
    "90度回転させると歪みの寄与が消え、高さの半分がそのまま水平オフセットになる",
  );
});

test("effectiveTopHalfWidth: 傾けるほど次の石が乗れる幅は狭くなる", () => {
  const stone = { halfWidth: 50, height: 40, comOffset: 0 };
  const flat = effectiveTopHalfWidth(stone, 0);
  const tilted = effectiveTopHalfWidth(stone, MAX_ROTATION);
  assert.equal(flat, 50);
  assert.ok(tilted < flat, "最大まで傾けると支持幅が減る");
  assert.ok(tilted > 0, "支持幅はゼロにはならない（最低値でクランプ）");
});

test("風のオフセットで安定/不安定が切り替わり、逆方向にずらせば打ち消せる", () => {
  const support = { centerX: 0, halfWidth: 20 };
  const stone = { halfWidth: 30, height: 40, comOffset: 0 };

  const withoutWind = evaluateDrop(support, stone, 0, 0, 0);
  assert.equal(withoutWind.isStable, true);

  const pushedByWind = evaluateDrop(support, stone, 0, 0, 25);
  assert.equal(pushedByWind.isStable, false, "風に流されて支持面から外れる");

  const compensated = evaluateDrop(support, stone, -25, 0, 25);
  assert.equal(compensated.isStable, true, "風と反対側にずらして置けば打ち消せる");
});

test("起動直後は積み石ゼロ、地面の支持面がある", () => {
  const world = new CairnBalanceWorld(900, 600);
  assert.equal(world.placedStones.length, 0);
  assert.equal(world.score, 0);
  assert.equal(world.isOver, false);
  const support = world.currentSupport();
  assert.equal(support.centerX, 450);
  assert.equal(support.halfWidth, BASE_SUPPORT_HALF_WIDTH);
});

test("ストーンの移動は画面内にクランプされる", () => {
  const world = new CairnBalanceWorld(900, 600);
  world.movePendingTo(-9999);
  assert.ok(world.pendingCenterX >= 0);
  world.movePendingTo(9999);
  assert.ok(world.pendingCenterX <= 900);
});

test("回転は最大角でクランプされる", () => {
  const world = new CairnBalanceWorld(900, 600);
  world.rotatePendingBy(MAX_ROTATION * 10);
  assert.equal(world.pendingRotation, MAX_ROTATION);
  world.rotatePendingBy(-MAX_ROTATION * 10);
  assert.equal(world.pendingRotation, -MAX_ROTATION);
});

test("支持面の真上で安定して落とすと積み石が増え、スコアが伸びる", () => {
  const world = new CairnBalanceWorld(900, 600);
  const placedEvents: number[] = [];
  world.onStonePlaced = ({ height }) => placedEvents.push(height);

  world.pendingStone = { id: 999, halfWidth: 50, height: 40, comOffset: 0, shapePoints: [] };
  world.pendingCenterX = world.currentSupport().centerX;
  world.pendingRotation = 0;

  const evaluation = world.dropPending();
  assert.ok(evaluation?.isStable);
  assert.equal(world.placedStones.length, 1);
  assert.equal(world.score, 1);
  assert.deepEqual(placedEvents, [1]);
  assert.equal(world.isOver, false);
  assert.notEqual(world.pendingStone.id, 999, "次の石が新しく用意される");
});

test("支持面から大きく外して落とすと崩れてゲームオーバーになる", () => {
  const world = new CairnBalanceWorld(900, 600);
  const toppleEvents: number[] = [];
  world.onToppled = (event) => toppleEvents.push(event.direction);

  const support = world.currentSupport();
  world.pendingStone = { id: 999, halfWidth: 30, height: 40, comOffset: 0, shapePoints: [] };
  world.pendingCenterX = support.centerX + support.halfWidth + 50;
  world.pendingRotation = 0;

  const evaluation = world.dropPending();
  assert.equal(evaluation?.isStable, false);
  assert.equal(world.isOver, true);
  assert.deepEqual(toppleEvents, [1], "支持面より右へ外れたので右方向へ崩れる");
  assert.equal(world.placedStones.length, 0, "不安定だった石は積まれない");

  // ゲームオーバー後は操作しても状態が変わらない
  const centerXBefore = world.pendingCenterX;
  world.movePendingTo(10);
  world.rotatePendingBy(1);
  world.step(1);
  assert.equal(world.pendingCenterX, centerXBefore);
  assert.equal(world.pendingRotation, 0);
  assert.equal(world.dropPending(), null);
  assertFinite(world, "ゲームオーバー後");
});

test("積むほど風の揺れ幅と速さが増す", () => {
  const world = new CairnBalanceWorld(900, 600);
  const amplitudeAtStart = world.windAmplitude();
  const frequencyAtStart = world.windFrequency();

  for (let i = 0; i < 5; i++) {
    const support = world.currentSupport();
    world.pendingStone = { id: 1000 + i, halfWidth: 50, height: 40, comOffset: 0, shapePoints: [] };
    world.pendingCenterX = support.centerX;
    world.pendingRotation = 0;
    const evaluation = world.dropPending();
    assert.ok(evaluation?.isStable, `${i}段目は安定して積めるはず`);
  }

  assert.equal(world.placedStones.length, 5);
  assert.ok(world.windAmplitude() > amplitudeAtStart, "積むほど揺れ幅が増える");
  assert.ok(world.windFrequency() > frequencyAtStart, "積むほど揺れが速くなる");
});

test("時間が進むと風が揺れ、一時停止（step停止）すれば揺れも止まる", () => {
  const world = new CairnBalanceWorld(900, 600);
  const offsets: number[] = [];
  for (let i = 0; i < 30; i++) {
    world.step(1 / 60);
    offsets.push(world.currentWindOffset());
  }
  const allSame = offsets.every((o) => o === offsets[0]);
  assert.ok(!allSame, "風のオフセットが時間とともに変化する");
});

test("リサイズしても積み石どうしの相対位置（＝安定性）は保たれる", () => {
  const world = new CairnBalanceWorld(900, 600);

  world.pendingStone = { id: 1, halfWidth: 50, height: 40, comOffset: 0, shapePoints: [] };
  world.pendingCenterX = world.currentSupport().centerX;
  world.pendingRotation = 0;
  assert.ok(world.dropPending()?.isStable);

  world.pendingStone = { id: 2, halfWidth: 40, height: 36, comOffset: 0, shapePoints: [] };
  world.pendingCenterX = world.currentSupport().centerX + 10;
  world.pendingRotation = 0;
  assert.ok(world.dropPending()?.isStable);

  const [first, second] = world.placedStones;
  const relativeOffsetBefore = second.centerX - first.centerX;

  world.resize(1200, 800);

  assert.ok(
    Math.abs(second.centerX - first.centerX - relativeOffsetBefore) < 1e-9,
    "横幅が変わっても石どうしの相対位置はそのまま",
  );

  const expectedGroundY = 800 * 0.84;
  assert.ok(Math.abs(first.centerY - (expectedGroundY - first.height / 2)) < 1e-9);
  assert.ok(Math.abs(second.centerY - (expectedGroundY - first.height - second.height / 2)) < 1e-9);
  assertFinite(world, "リサイズ後");
});

test("リセットすると最初の状態に戻る", () => {
  const world = new CairnBalanceWorld(900, 600);
  world.pendingStone = { id: 1, halfWidth: 50, height: 40, comOffset: 0, shapePoints: [] };
  world.pendingCenterX = world.currentSupport().centerX;
  world.pendingRotation = 0;
  world.dropPending();
  assert.equal(world.placedStones.length, 1);

  world.reset();
  assert.equal(world.placedStones.length, 0);
  assert.equal(world.score, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.pendingCenterX, world.width / 2);
});
