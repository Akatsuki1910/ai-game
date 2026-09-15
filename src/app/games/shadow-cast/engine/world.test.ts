import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clampPuppetXRatio,
  DEPTH_MAX,
  DEPTH_MIN,
  depthRatioFromPointerYRatio,
  generateTarget,
  LIGHT_X_RATIO,
  maxPuppetOffsetForDepth,
  projectShadow,
  SCALE_MAX,
  SCALE_MIN,
  SHADOW_MARGIN_RATIO,
  ShadowCastWorld,
} from "./world.ts";

const FRAME = 1 / 60;

/** 現在のお題にぴったり重なる人形位置(奥行き・左右)を逆算する。 */
function puppetPositionForTarget(world: ShadowCastWorld): { xRatio: number; depthRatio: number } {
  const depthRatio = 1 / world.target.scale;
  const xRatio = LIGHT_X_RATIO + (world.target.shadowXRatio - LIGHT_X_RATIO) * depthRatio;
  return { xRatio, depthRatio };
}

/** お題に人形を正確に重ねたままステップを進める、完璧なプレイヤーのシミュレーション。 */
function holdOnTarget(world: ShadowCastWorld, frames: number): void {
  for (let i = 0; i < frames; i++) {
    if (world.isOver) return;
    const { xRatio, depthRatio } = puppetPositionForTarget(world);
    world.setPointer(xRatio, depthRatio * (0.88 - 0.1) + 0.1);
    world.step(FRAME);
  }
}

test("depthRatioFromPointerYRatio は範囲外の値を [DEPTH_MIN, DEPTH_MAX] にクランプする", () => {
  assert.equal(depthRatioFromPointerYRatio(-10), DEPTH_MIN);
  assert.equal(depthRatioFromPointerYRatio(10), DEPTH_MAX);
});

test("maxPuppetOffsetForDepth は光源に近いほど可動範囲が狭くなる", () => {
  const nearLight = maxPuppetOffsetForDepth(DEPTH_MIN);
  const nearWall = maxPuppetOffsetForDepth(DEPTH_MAX);
  assert.ok(nearLight < nearWall, "光源に近いほど左右に動ける幅は狭い");
});

test("clampPuppetXRatio は可動範囲外の位置を範囲内へ丸める", () => {
  const depthRatio = DEPTH_MIN;
  const clamped = clampPuppetXRatio(999, depthRatio);
  const maxOffset = maxPuppetOffsetForDepth(depthRatio);
  assert.ok(Math.abs(clamped - LIGHT_X_RATIO) <= maxOffset + 1e-9);
});

test("projectShadow: 光源の真下(人形が光源のx座標と同じ)では影も中央に映る", () => {
  const { shadowXRatio } = projectShadow(LIGHT_X_RATIO, 0.5);
  assert.ok(Math.abs(shadowXRatio - LIGHT_X_RATIO) < 1e-9);
});

test("projectShadow: 光源に近いほど拡大率が高く、壁に近いほど等倍に近づく", () => {
  const near = projectShadow(LIGHT_X_RATIO, DEPTH_MIN);
  const far = projectShadow(LIGHT_X_RATIO, DEPTH_MAX);
  assert.ok(near.scale > far.scale);
  assert.ok(near.scale <= SCALE_MAX + 1e-9);
  assert.ok(far.scale >= SCALE_MIN - 1e-9);
});

test("projectShadow: 可動範囲いっぱいに動かしても影はスクリーンの余白内に収まる", () => {
  for (const depthRatio of [DEPTH_MIN, (DEPTH_MIN + DEPTH_MAX) / 2, DEPTH_MAX]) {
    const maxOffset = maxPuppetOffsetForDepth(depthRatio);
    const { shadowXRatio } = projectShadow(LIGHT_X_RATIO + maxOffset, depthRatio);
    assert.ok(shadowXRatio <= 1 - SHADOW_MARGIN_RATIO + 1e-9);
    assert.ok(shadowXRatio >= SHADOW_MARGIN_RATIO - 1e-9);
  }
});

test("generateTarget は常に到達可能な範囲(比率0〜1, スケール範囲内)でお題を作る", () => {
  for (let i = 0; i < 50; i++) {
    const target = generateTarget();
    assert.ok(target.shadowXRatio >= SHADOW_MARGIN_RATIO - 1e-9);
    assert.ok(target.shadowXRatio <= 1 - SHADOW_MARGIN_RATIO + 1e-9);
    assert.ok(target.scale >= SCALE_MIN - 1e-9);
    assert.ok(target.scale <= SCALE_MAX + 1e-9);
  }
});

test("起動直後はスコア0・コンボ0・時間満タンで始まる", () => {
  const world = new ShadowCastWorld();
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.isOver, false);
  assert.ok(world.timeRemaining > 0);
});

test("お題にぴったり人形を重ね続けると、規定時間の保持でコンボと得点が進む", () => {
  const world = new ShadowCastWorld();
  const comboBefore = world.combo;
  const scoreBefore = world.score;

  holdOnTarget(world, 200);

  assert.ok(world.combo > comboBefore, "保持し続けるとコンボが進む");
  assert.ok(world.score > scoreBefore, "保持し続けると得点が入る");
});

test("お題から大きく外れた位置では保持メーターが進まない", () => {
  const world = new ShadowCastWorld();
  world.setPointer(LIGHT_X_RATIO, 0.1);
  world.moveBy(0, 0);
  // お題と正反対側の隅へ大きくずらす
  world.setPointer(world.target.shadowXRatio > 0.5 ? 0.02 : 0.98, 0.15);
  for (let i = 0; i < 30; i++) world.step(FRAME);

  assert.equal(world.holdSeconds, 0, "外れた位置では保持メーターが増えない");
  assert.equal(world.combo, 0);
});

test("一度マッチしたあと外れると、保持メーターは時間経過で減っていく(すぐには0に戻らない)", () => {
  const world = new ShadowCastWorld();
  const { xRatio, depthRatio } = puppetPositionForTarget(world);
  world.setPointer(xRatio, depthRatio * (0.88 - 0.1) + 0.1);
  world.step(FRAME);
  assert.ok(world.holdSeconds > 0, "マッチ中は保持メーターが増える");

  const holdWhileMatched = world.holdSeconds;
  world.setPointer(0.02, 0.15);
  world.step(FRAME);

  assert.ok(world.holdSeconds < holdWhileMatched, "外れると保持メーターは減り始める");
  assert.ok(world.holdSeconds >= 0, "保持メーターは負にならない");
});

test("moveBy はキーボード操作相当の相対移動で、可動範囲外に出ない", () => {
  const world = new ShadowCastWorld();
  for (let i = 0; i < 200; i++) world.moveBy(0.05, 0.05);

  const maxOffset = maxPuppetOffsetForDepth(world.depthRatio);
  assert.ok(Math.abs(world.puppetXRatio - LIGHT_X_RATIO) <= maxOffset + 1e-9);
  assert.ok(world.depthRatio <= DEPTH_MAX + 1e-9);
});

test("持ち時間が尽きるとゲームオーバーになり、以後は状態が変化しない", () => {
  const world = new ShadowCastWorld();
  for (let i = 0; i < 10_000 && !world.isOver; i++) world.step(FRAME);

  assert.equal(world.isOver, true);
  assert.equal(world.timeRemaining, 0);

  const scoreAtOver = world.score;
  const comboAtOver = world.combo;
  holdOnTarget(world, 60);
  assert.equal(world.score, scoreAtOver, "終了後はスコアが変化しない");
  assert.equal(world.combo, comboAtOver, "終了後はコンボが変化しない");
});

test("reset() すると進行状況を問わず最初の状態に戻る", () => {
  const world = new ShadowCastWorld();
  holdOnTarget(world, 200);
  assert.ok(world.combo > 0);

  world.reset();

  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.holdSeconds, 0);
  assert.equal(world.isOver, false);
  assert.ok(world.timeRemaining > 0);
});

test("コンボが進むほど許容誤差と必要保持時間が狭く/短くなる(難化する)", () => {
  const world = new ShadowCastWorld();
  const toleranceXBefore = world.toleranceXRatio;
  const toleranceScaleBefore = world.toleranceScale;

  holdOnTarget(world, 200);
  assert.ok(world.combo > 0);

  assert.ok(world.toleranceXRatio <= toleranceXBefore);
  assert.ok(world.toleranceScale <= toleranceScaleBefore);
});
