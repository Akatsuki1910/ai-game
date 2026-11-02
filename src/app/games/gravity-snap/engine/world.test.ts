import assert from "node:assert/strict";
import { test } from "node:test";
import { directionFromPoint, GravitySnapWorld, START_LIVES } from "./world.ts";

const WIDTH = 960;
const HEIGHT = 540;
const FRAME = 1 / 60;

function assertFinite(world: GravitySnapWorld, label: string): void {
  assert.ok(
    Number.isFinite(world.ball.x) && Number.isFinite(world.ball.y),
    `${label}: ball position`,
  );
  assert.ok(
    Number.isFinite(world.ball.vx) && Number.isFinite(world.ball.vy),
    `${label}: ball velocity`,
  );
  assert.ok(Number.isFinite(world.orb.x) && Number.isFinite(world.orb.y), `${label}: orb position`);
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  for (const hazard of world.hazards) {
    assert.ok(Number.isFinite(hazard.x) && Number.isFinite(hazard.y), `${label}: hazard position`);
  }
}

test("起動直後はボールが中央にあり、ライフとスコアが既定値", () => {
  const world = new GravitySnapWorld(WIDTH, HEIGHT);

  assert.equal(world.ball.x, WIDTH / 2);
  assert.equal(world.ball.y, HEIGHT / 2);
  assert.equal(world.score, 0);
  assert.equal(world.lives, START_LIVES);
  assert.equal(world.isOver, false);
  assert.ok(world.orb.x >= 0 && world.orb.x <= WIDTH, "的が盤内にある");
  assert.ok(world.orb.y >= 0 && world.orb.y <= HEIGHT, "的が盤内にある");
  assert.equal(world.hazards.length, 0, "開始時はハザードなし");
});

test("重力方向を切り替えるとボールがその方向へ加速して動く", () => {
  const world = new GravitySnapWorld(WIDTH, HEIGHT);
  world.setDirection("down");
  for (let i = 0; i < 30; i++) world.step(FRAME);
  assert.ok(world.ball.y > HEIGHT / 2, "下方向でボールが下に動く");

  world.ball.x = WIDTH / 2;
  world.ball.y = HEIGHT / 2;
  world.ball.vx = 0;
  world.ball.vy = 0;
  world.setDirection("left");
  for (let i = 0; i < 30; i++) world.step(FRAME);
  assert.ok(world.ball.x < WIDTH / 2, "左方向でボールが左に動く");
});

test("壁に当たってもバウンドして画面内に留まる", () => {
  const world = new GravitySnapWorld(WIDTH, HEIGHT);
  world.setDirection("down");
  for (let i = 0; i < 600; i++) {
    world.step(FRAME);
    assertFinite(world, "壁衝突テスト中");
    assert.ok(world.ball.y >= world.ball.radius - 0.01, "ボールが下壁を貫通しない");
    assert.ok(world.ball.y <= world.height - world.ball.radius + 0.01, "ボールが画面内");
  }
});

test("的に重なると得点が入り、的は別の位置に再配置される", () => {
  const world = new GravitySnapWorld(WIDTH, HEIGHT);
  const events: number[] = [];
  world.onOrbCollected = (event) => events.push(event.score);

  const previousOrb = { x: world.orb.x, y: world.orb.y };
  world.orb.x = world.ball.x;
  world.orb.y = world.ball.y;
  world.step(FRAME);

  assert.equal(world.score, 1, "的を取ると得点が増える");
  assert.deepEqual(events, [1], "コールバックが呼ばれる");
  assert.ok(
    world.orb.x !== previousOrb.x || world.orb.y !== previousOrb.y,
    "的が再配置される（同じ座標に残らない）",
  );
});

test("ハザードに当たるとライフが減り、無敵時間中は連続で減らない", () => {
  const world = new GravitySnapWorld(WIDTH, HEIGHT);
  world.hazards.push({ id: 1, x: world.ball.x, y: world.ball.y, radius: 20 });

  const before = world.lives;
  world.step(FRAME);
  assert.equal(world.lives, before - 1, "ハザードに触れるとライフが1減る");

  // ノックバック後もハザードを同じ場所に置き直し、無敵時間中であることを確認する
  world.hazards[0].x = world.ball.x;
  world.hazards[0].y = world.ball.y;
  world.step(FRAME);
  assert.equal(world.lives, before - 1, "無敵時間中は連続でライフが減らない");
});

test("ライフが0になるとゲームオーバーになり、resetで最初からやり直せる", () => {
  const world = new GravitySnapWorld(WIDTH, HEIGHT);
  for (let i = 0; i < START_LIVES; i++) {
    world.invincibleRemaining = 0;
    world.hazards = [{ id: i, x: world.ball.x, y: world.ball.y, radius: 20 }];
    world.step(FRAME);
  }

  assert.equal(world.lives, 0);
  assert.equal(world.isOver, true, "ライフが尽きるとゲームオーバーになる");

  // ゲームオーバー後に進めても状態が壊れない
  world.step(FRAME);
  assertFinite(world, "ゲームオーバー後");

  world.reset();
  assert.equal(world.isOver, false);
  assert.equal(world.score, 0);
  assert.equal(world.lives, START_LIVES);
});

test("生存時間が長いほど重力加速度が強くなる", () => {
  const world = new GravitySnapWorld(WIDTH, HEIGHT);
  world.setDirection("down");
  world.step(FRAME);
  const earlySpeed = Math.hypot(world.ball.vx, world.ball.vy);

  world.ball.vx = 0;
  world.ball.vy = 0;
  world.elapsedSeconds = 120;
  world.step(FRAME);
  const lateSpeed = Math.hypot(world.ball.vx, world.ball.vy);

  assert.ok(lateSpeed > earlySpeed, "時間が経つほど1フレームで得る速度が大きい");
});

test("画面サイズが変わってもボール・的・ハザードが画面内に収まる", () => {
  const world = new GravitySnapWorld(WIDTH, HEIGHT);
  world.hazards.push({ id: 1, x: WIDTH * 0.5, y: HEIGHT * 0.5, radius: 20 });

  world.resize(375, 720);
  assert.ok(world.ball.x >= 0 && world.ball.x <= 375, "ボールが画面内");
  assert.ok(world.ball.y >= 0 && world.ball.y <= 720, "ボールが画面内");

  for (let i = 0; i < 60; i++) world.step(FRAME);
  assertFinite(world, "リサイズ後");
  assert.ok(world.ball.x >= 0 && world.ball.x <= 375);
  assert.ok(world.ball.y >= 0 && world.ball.y <= 720);
});

test("的は常に壁際(いずれかの辺)に出現する", () => {
  const world = new GravitySnapWorld(WIDTH, HEIGHT);
  for (let i = 0; i < 50; i++) {
    const orb = world.orb;
    const minWallDistance = Math.min(orb.x, WIDTH - orb.x, orb.y, HEIGHT - orb.y);
    assert.ok(minWallDistance < 15, `的は壁際にある: (${orb.x}, ${orb.y})`);
    world.reset();
  }
});

test("ハザードも壁際に出現する", () => {
  const world = new GravitySnapWorld(WIDTH, HEIGHT);
  for (let round = 0; round < 10; round++) {
    world.hazards = [];
    for (let i = 0; i < 3; i++) {
      world.orb.x = world.ball.x;
      world.orb.y = world.ball.y;
      world.step(FRAME);
    }
    assert.equal(world.hazards.length, 1, "3つ的を取るとハザードが1つ出現する");
    const hazard = world.hazards[0];
    const minWallDistance = Math.min(hazard.x, WIDTH - hazard.x, hazard.y, HEIGHT - hazard.y);
    assert.ok(minWallDistance < 22, `ハザードは壁際にある: (${hazard.x}, ${hazard.y})`);
  }
});

test("directionFromPoint は中心からの相対位置で4方向を判定する", () => {
  assert.equal(directionFromPoint(100, 50, 50, 50), "right");
  assert.equal(directionFromPoint(0, 50, 50, 50), "left");
  assert.equal(directionFromPoint(50, 100, 50, 50), "down");
  assert.equal(directionFromPoint(50, 0, 50, 50), "up");
});
