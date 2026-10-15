import assert from "node:assert/strict";
import { test } from "node:test";
import { FlailWardWorld, START_LIVES } from "./world.ts";

const WIDTH = 960;
const HEIGHT = 540;
const FRAME = 1 / 60;

function assertFinite(world: FlailWardWorld, label: string): void {
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.ballAngle), `${label}: ballAngle`);
  assert.ok(Number.isFinite(world.angularVelocity), `${label}: angularVelocity`);
  for (const meteor of world.meteors) {
    assert.ok(
      Number.isFinite(meteor.distance) && Number.isFinite(meteor.angle),
      `${label}: meteor`,
    );
  }
}

test("起動直後はライフが満タンでスコア0、ゲームオーバーではない", () => {
  const world = new FlailWardWorld(WIDTH, HEIGHT);
  assert.equal(world.lives, START_LIVES);
  assert.equal(world.score, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.meteors.length, 0);
});

test("無操作でも時間経過でメテオが自動スポーンする", () => {
  const world = new FlailWardWorld(WIDTH, HEIGHT);
  for (let i = 0; i < 60 && world.meteors.length === 0; i++) world.step(FRAME);
  assert.ok(world.meteors.length > 0, "1秒以内に最初のメテオが湧く");
  assertFinite(world, "スポーン直後");
});

test("ポインタの方向へバネ-ダンパ物理でフレイルが追従して収束する", () => {
  const world = new FlailWardWorld(WIDTH, HEIGHT);
  // 中心から見て右方向(角度0)にポインタを置き続ける
  const targetX = world.centerX + 300;
  const targetY = world.centerY;
  for (let i = 0; i < 180; i++) {
    world.aimAt(targetX, targetY);
    world.step(FRAME);
  }
  const normalizedAngle = Math.atan2(Math.sin(world.ballAngle), Math.cos(world.ballAngle));
  assert.ok(
    Math.abs(normalizedAngle) < 0.05,
    `3秒追従させると目標角度0に収束する(実際: ${normalizedAngle})`,
  );
  assert.ok(Math.abs(world.angularVelocity) < 0.3, "収束後は角速度も小さい");
});

test("中心と同じ座標を狙っても例外にならず角度が変化しない", () => {
  const world = new FlailWardWorld(WIDTH, HEIGHT);
  const before = world.targetAngle;
  world.aimAt(world.centerX, world.centerY);
  assert.equal(world.targetAngle, before, "距離0の狙いは無視される");
  world.step(FRAME);
  assertFinite(world, "中心を狙った直後");
});

test("キーボード操作でフレイルを時計回りに回せる", () => {
  const world = new FlailWardWorld(WIDTH, HEIGHT);
  const startAngle = world.targetAngle;
  for (let i = 0; i < 60; i++) {
    world.rotateManually(1, FRAME);
    world.step(FRAME);
  }
  assert.ok(world.targetAngle > startAngle, "1秒間右回転させるとターゲット角度が増える");
  assert.ok(world.ballAngle > startAngle, "フレイル自体も追従して回転する");
});

test("フレイルがメテオに重なると弾き返してスコアとストリークが伸びる", () => {
  const world = new FlailWardWorld(WIDTH, HEIGHT);
  const ballPos = world.ballPosition;

  const deflected: number[] = [];
  world.onMeteorDeflected = ({ points }) => deflected.push(points);

  // フレイルの真上(ball位置と同じ角度・距離)にメテオを直接配置する
  world.meteors.push({
    id: 9001,
    angle: world.ballAngle,
    distance: world.flailRadius,
    speed: 0,
    size: 10,
  });
  assert.ok(Math.hypot(ballPos.x - world.ballPosition.x, ballPos.y - world.ballPosition.y) < 1e-6);

  world.step(FRAME);

  assert.equal(world.meteors.length, 0, "重なったメテオは除去される");
  assert.equal(deflected.length, 1, "弾き返しイベントが発火する");
  assert.ok(deflected[0] > 0, "得点が入る");
  assert.equal(world.score, deflected[0]);
  assert.equal(world.streak, 1);
  assert.equal(world.meteorsDeflected, 1);
  assert.equal(world.lives, START_LIVES, "弾いた場合はライフが減らない");
  assertFinite(world, "弾き返し後");
});

test("フレイルから離れた位置でコアに到達するとライフが減りストリークが切れる", () => {
  const world = new FlailWardWorld(WIDTH, HEIGHT);
  const hits: number[] = [];
  world.onCoreHit = ({ livesRemaining }) => hits.push(livesRemaining);

  // フレイルとは正反対の角度から接近させ、確実にフレイルを素通りさせる
  world.meteors.push({
    id: 9002,
    angle: world.ballAngle + Math.PI,
    distance: world.coreRadius + 1,
    speed: 1000,
    size: 10,
  });

  world.step(FRAME);

  assert.equal(world.meteors.length, 0, "コアに到達したメテオは除去される");
  assert.equal(hits.length, 1, "コア被弾イベントが発火する");
  assert.equal(world.lives, START_LIVES - 1);
  assert.equal(world.meteorsReachedCore, 1);
  assert.equal(world.streak, 0);
  assertFinite(world, "コア被弾後");
});

test("ライフが0になるとゲームオーバーになり、以後のstepは何もしない", () => {
  const world = new FlailWardWorld(WIDTH, HEIGHT);
  for (let i = 0; i < START_LIVES; i++) {
    world.meteors.push({
      id: 9100 + i,
      angle: world.ballAngle + Math.PI,
      distance: world.coreRadius + 1,
      speed: 1000,
      size: 10,
    });
    world.step(FRAME);
  }

  assert.equal(world.lives, 0);
  assert.equal(world.isOver, true);

  const scoreBefore = world.score;
  world.meteors.push({ id: 9999, angle: 0, distance: world.coreRadius + 1, speed: 1000, size: 10 });
  world.step(FRAME);
  assert.equal(world.score, scoreBefore, "ゲームオーバー後はstepが進行しない");
  assert.equal(world.meteors.length, 1, "ゲームオーバー後はメテオも処理されない");

  world.reset();
  assert.equal(world.isOver, false);
  assert.equal(world.lives, START_LIVES);
  assert.equal(world.score, 0);
  assert.equal(world.meteors.length, 0);
});

test("画面サイズが変わってもコア/フレイル/ボールの半径は画面内に収まり、メテオも有限値を保つ", () => {
  const world = new FlailWardWorld(WIDTH, HEIGHT);
  for (let i = 0; i < 30; i++) world.step(FRAME);

  // PC横長 → スマホ縦長
  world.resize(375, 720);
  assert.ok(world.coreRadius > 0 && world.coreRadius < Math.min(world.width, world.height));
  assert.ok(world.flailRadius > 0 && world.flailRadius < Math.max(world.width, world.height));
  assert.ok(world.ballRadius > 0);

  for (let i = 0; i < 60; i++) world.step(FRAME);
  assertFinite(world, "リサイズ後");
});
