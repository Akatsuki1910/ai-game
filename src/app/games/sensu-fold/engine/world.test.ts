import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ANGLE_MAX_DEG,
  ANGLE_MIN_DEG,
  INITIAL_WRINKLES,
  MIN_TOLERANCE_DEG,
  SensuFoldWorld,
} from "./world.ts";

function assertFinite(world: SensuFoldWorld, label: string): void {
  assert.ok(Number.isFinite(world.currentAngleDeg), `${label}: currentAngleDeg`);
  assert.ok(Number.isFinite(world.targetCenterDeg), `${label}: targetCenterDeg`);
  assert.ok(Number.isFinite(world.toleranceDeg), `${label}: toleranceDeg`);
  assert.ok(Number.isFinite(world.score), `${label}: score`);
}

/** 現在角度をターゲット中心にぴったり合わせて pin() する(成功させる)ヘルパー。 */
function pinOnTarget(world: SensuFoldWorld): void {
  world.setAngleRatio(world.targetCenterDeg / ANGLE_MAX_DEG);
  world.pin();
}

test("起動直後は1ラウンド目・3パネル・ライフ満タン・スコア0で始まる", () => {
  const world = new SensuFoldWorld();

  assert.equal(world.round, 1);
  assert.equal(world.panelCount, 3);
  assert.equal(world.foldIndex, 0);
  assert.equal(world.completedAngles.length, 0);
  assert.equal(world.currentAngleDeg, 0);
  assert.equal(world.wrinkles, INITIAL_WRINKLES);
  assert.equal(world.score, 0);
  assert.equal(world.isOver, false);
  assertFinite(world, "起動直後");
});

test("setAngleRatio() は0〜1の比率を0〜180度へ変換し、範囲外は clamp される", () => {
  const world = new SensuFoldWorld();

  world.setAngleRatio(0);
  assert.equal(world.currentAngleDeg, ANGLE_MIN_DEG);

  world.setAngleRatio(1);
  assert.equal(world.currentAngleDeg, ANGLE_MAX_DEG);

  world.setAngleRatio(0.5);
  assert.equal(world.currentAngleDeg, 90);

  world.setAngleRatio(-1);
  assert.equal(world.currentAngleDeg, ANGLE_MIN_DEG, "負の比率は0度にclampされる");

  world.setAngleRatio(2);
  assert.equal(world.currentAngleDeg, ANGLE_MAX_DEG, "1を超える比率は180度にclampされる");
});

test("adjustAngle() は現在角度に加算し、0〜180度の範囲を超えない", () => {
  const world = new SensuFoldWorld();

  world.adjustAngle(30);
  assert.equal(world.currentAngleDeg, 30);
  world.adjustAngle(-100);
  assert.equal(world.currentAngleDeg, ANGLE_MIN_DEG, "0度を下回らない");

  world.setAngleRatio(1);
  world.adjustAngle(50);
  assert.equal(world.currentAngleDeg, ANGLE_MAX_DEG, "180度を超えない");
});

test("step() は経過時間に応じて正弦波でターゲット中心を揺らす", () => {
  const world = new SensuFoldWorld();

  world.step(1);
  const expected = 90 + 55 * Math.sin(0.6 * 1);
  assert.ok(
    Math.abs(world.targetCenterDeg - expected) < 1e-9,
    "targetCenterDeg は既定の速度・振幅の正弦波に一致する",
  );
  assertFinite(world, "1秒経過後");
});

test("ターゲット帯の範囲内でpinすると成功しスコアが増え、次のパネルへ進む", () => {
  const world = new SensuFoldWorld();
  const events: Array<{ isSuccess: boolean; precision: number }> = [];
  world.onFoldPinned = (event) => events.push(event);

  pinOnTarget(world);

  assert.equal(events.length, 1);
  assert.equal(events[0].isSuccess, true);
  assert.ok(events[0].precision > 0.9, "ぴったり合わせたので精度はほぼ1");
  assert.equal(world.foldIndex, 1);
  assert.equal(world.completedAngles.length, 1);
  assert.equal(world.currentAngleDeg, 0, "確定後は次のパネルのために角度が0へ戻る");
  assert.ok(world.score > 0);
  assert.equal(world.wrinkles, INITIAL_WRINKLES, "成功時はライフが減らない");
});

test("許容誤差ちょうどの境界値でも成功と判定する(inclusive)", () => {
  const world = new SensuFoldWorld();
  world.setAngleRatio((world.targetCenterDeg + world.toleranceDeg) / ANGLE_MAX_DEG);

  world.pin();

  assert.equal(world.foldIndex, 1, "境界値ちょうどは成功扱い");
});

test("許容誤差を少しでも超えるとpinは失敗しライフが減り角度は0に戻る", () => {
  const world = new SensuFoldWorld();
  const events: Array<{ isSuccess: boolean }> = [];
  world.onFoldPinned = (event) => events.push(event);
  world.setAngleRatio((world.targetCenterDeg + world.toleranceDeg + 0.5) / ANGLE_MAX_DEG);

  world.pin();

  assert.equal(events.length, 1);
  assert.equal(events[0].isSuccess, false);
  assert.equal(world.foldIndex, 0, "失敗した折り目のインデックスは進まない");
  assert.equal(world.currentAngleDeg, 0, "失敗すると角度は0に springback する");
  assert.equal(world.wrinkles, INITIAL_WRINKLES - 1);
  assert.equal(world.score, 0);
});

test("パネルをすべて折り終えるとラウンドがクリアされ、次ラウンドは難しくなる", () => {
  const world = new SensuFoldWorld();
  const initialPanelCount = world.panelCount;
  const initialTolerance = world.toleranceDeg;
  const events: Array<{ round: number; panelCount: number }> = [];
  world.onRoundCleared = (event) => events.push(event);

  for (let i = 0; i < initialPanelCount; i++) pinOnTarget(world);

  assert.equal(events.length, 1, "全パネル折り終えた瞬間に1回だけラウンドクリアが発火する");
  assert.equal(world.round, 2);
  assert.equal(world.panelCount, initialPanelCount + 1, "次ラウンドはパネルが1枚増える");
  assert.equal(world.foldIndex, 0, "新ラウンドは0枚目から");
  assert.equal(world.completedAngles.length, 0, "新ラウンドで折り目の記録がリセットされる");
  assert.ok(world.toleranceDeg < initialTolerance, "許容誤差が縮む");
  assert.ok(world.score > 0);
});

test("ラウンドを重ねても許容誤差とパネル数には下限/上限があり、それを超えない", () => {
  const world = new SensuFoldWorld();

  for (let round = 0; round < 15; round++) {
    for (let i = 0; i < world.panelCount; i++) pinOnTarget(world);
    assertFinite(world, `ラウンド${round}クリア後`);
  }

  assert.equal(world.toleranceDeg, MIN_TOLERANCE_DEG, "許容誤差は下限で頭打ちになる");
  assert.equal(world.panelCount, 8, "パネル数は上限(8枚)で頭打ちになる");
});

test("ライフが尽きるとゲームオーバーになり、以後は操作しても状態が変化しない", () => {
  const world = new SensuFoldWorld();
  let gameOverEvent: { round: number; score: number } | null = null;
  world.onGameOver = (event) => {
    gameOverEvent = event;
  };

  const missRatio = (world.targetCenterDeg + world.toleranceDeg + 10) / ANGLE_MAX_DEG;
  for (let i = 0; i < INITIAL_WRINKLES; i++) {
    world.setAngleRatio(missRatio);
    world.pin();
  }

  assert.equal(world.wrinkles, 0);
  assert.equal(world.isOver, true);
  assert.ok(gameOverEvent !== null, "ゲームオーバーイベントが発火する");

  const frozenAngle = world.currentAngleDeg;
  const frozenScore = world.score;
  const frozenTarget = world.targetCenterDeg;

  world.setAngleRatio(1);
  world.adjustAngle(50);
  world.pin();
  world.step(5);

  assert.equal(world.currentAngleDeg, frozenAngle, "終了後は角度操作を受け付けない");
  assert.equal(world.score, frozenScore, "終了後はスコアが変化しない");
  assert.equal(world.targetCenterDeg, frozenTarget, "終了後はターゲットも動かない");
});

test("reset() で進行状況がすべて初期状態に戻る", () => {
  const world = new SensuFoldWorld();
  for (let i = 0; i < world.panelCount; i++) pinOnTarget(world);
  world.step(3);
  assert.ok(world.round > 1, "前提: ラウンドが進んでいる");

  world.reset();

  assert.equal(world.round, 1);
  assert.equal(world.panelCount, 3);
  assert.equal(world.foldIndex, 0);
  assert.equal(world.completedAngles.length, 0);
  assert.equal(world.currentAngleDeg, 0);
  assert.equal(world.wrinkles, INITIAL_WRINKLES);
  assert.equal(world.score, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.targetCenterDeg, 90);
});
