import assert from "node:assert/strict";
import { test } from "node:test";
import { HaneRallyWorld, START_LIVES } from "./world.ts";

const WIDTH = 960;
const HEIGHT = 540;
const FRAME = 1 / 60;

function assertFinite(world: HaneRallyWorld, label: string): void {
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.rally), `${label}: rally`);
  assert.ok(
    Number.isFinite(world.shuttle.x) && Number.isFinite(world.shuttle.y),
    `${label}: shuttle position`,
  );
  assert.ok(
    Number.isFinite(world.shuttle.vx) && Number.isFinite(world.shuttle.vy),
    `${label}: shuttle velocity`,
  );
  assert.ok(
    Number.isFinite(world.paddle.x) && Number.isFinite(world.paddle.y),
    `${label}: paddle position`,
  );
}

/** 毎フレーム、羽根のx座標にパドルを正確に追従させる(=完璧に振り続ける)。 */
function trackShuttlePerfectly(world: HaneRallyWorld, paddleY: number): void {
  world.setPaddlePosition(world.shuttle.x, paddleY);
}

test("起動直後は羽根・パドルが揃い、ライフ満タンでスコア0から始まる", () => {
  const world = new HaneRallyWorld(WIDTH, HEIGHT);

  assert.equal(world.score, 0);
  assert.equal(world.rally, 0);
  assert.equal(world.bestRally, 0);
  assert.equal(world.lives, START_LIVES);
  assert.equal(world.isOver, false);
  assert.ok(world.shuttle.y < world.paddle.y, "羽根はパドルより上から落ち始める");
});

test("パドルを羽根の落下位置に合わせ続けると打ち返しが連続して起き、ラリーとスコアが伸びる", () => {
  const world = new HaneRallyWorld(WIDTH, HEIGHT);
  const paddleY = HEIGHT * 0.82;
  const hits: number[] = [];
  world.onHit = ({ rally }) => hits.push(rally);

  for (let i = 0; i < 600 && hits.length < 5; i++) {
    trackShuttlePerfectly(world, paddleY);
    world.step(FRAME);
    assertFinite(world, `${i}フレーム目`);
  }

  assert.ok(hits.length >= 5, `5回以上打ち返せている(実際: ${hits.length}回)`);
  assert.equal(world.rally, hits.length, "連続で打ち返している間はラリー数がそのまま伸びる");
  assert.equal(world.score, hits.length, "打ち返した回数だけスコアが増える");
  assert.equal(world.lives, START_LIVES, "打ち返し続けている間はライフが減らない");
  assert.equal(world.bestRally, world.rally, "伸ばしている最中のベストは現在のラリーと一致する");
});

test("パドルを羽根から離しておくと落下してミスになり、ライフが減ってラリーが0に戻る", () => {
  const world = new HaneRallyWorld(WIDTH, HEIGHT);
  world.setPaddlePosition(world.width - world.paddle.radius, world.height - world.paddle.radius);

  const misses: number[] = [];
  world.onMiss = ({ livesRemaining }) => misses.push(livesRemaining);

  for (let i = 0; i < 600 && misses.length === 0; i++) {
    world.step(FRAME);
    assertFinite(world, `${i}フレーム目`);
  }

  assert.equal(misses.length, 1, "離れたパドルでは1回で確実にミスする");
  assert.equal(world.lives, START_LIVES - 1);
  assert.equal(world.rally, 0, "ミスするとラリーは0に戻る");
  assert.equal(world.isOver, false, "1回のミスではまだラウンドは終わらない");
});

test("ライフが尽きるとラウンドが終わり、リセットで最初の状態に戻る", () => {
  const world = new HaneRallyWorld(WIDTH, HEIGHT);

  for (let life = 0; life < START_LIVES; life++) {
    world.setPaddlePosition(world.width - world.paddle.radius, world.height - world.paddle.radius);
    for (let i = 0; i < 600 && !world.isOver && world.lives > START_LIVES - 1 - life; i++) {
      world.step(FRAME);
    }
  }

  assert.equal(world.isOver, true, "ライフが0になるとラウンドが終わる");
  assert.equal(world.lives, 0);

  // 終了後に進めても壊れない
  world.step(FRAME);
  assertFinite(world, "ラウンド終了後");

  world.reset();
  assert.equal(world.isOver, false);
  assert.equal(world.score, 0);
  assert.equal(world.rally, 0);
  assert.equal(world.lives, START_LIVES);
});

test("パドルを速く振るほど強く打ち返せる(羽根の初速が大きくなる)", () => {
  const paddleY = HEIGHT * 0.82;

  /**
   * パドルを `fromX` から `toX` へ1フレームで振った直後の状態を作り、羽根を
   * その着地点にちょうど接触させる(衝突の瞬間の打撃速度だけを比較したいため)。
   */
  function primeSwingAndPlaceShuttle(world: HaneRallyWorld, fromX: number, toX: number): void {
    world.setPaddlePosition(fromX, paddleY);
    world.step(FRAME); // 前フレーム位置を fromX として確定させる。
    world.setPaddlePosition(toX, paddleY);
    world.shuttle.x = toX;
    world.shuttle.y = world.paddle.y - world.paddle.radius - world.shuttle.radius + 1;
    world.shuttle.vx = 0;
    world.shuttle.vy = 200;
  }

  const slowWorld = new HaneRallyWorld(WIDTH, HEIGHT);
  primeSwingAndPlaceShuttle(slowWorld, WIDTH / 2, WIDTH / 2); // 振らずに静止させたまま打つ
  slowWorld.step(FRAME);

  const fastWorld = new HaneRallyWorld(WIDTH, HEIGHT);
  primeSwingAndPlaceShuttle(fastWorld, WIDTH / 2 - 400, WIDTH / 2); // 同じ1フレームで大きく横に振る
  fastWorld.step(FRAME);

  assert.equal(slowWorld.rally, 1, "静止したパドルでも打ち返せる");
  assert.equal(fastWorld.rally, 1, "素早く振ったパドルでも打ち返せる");
  assert.ok(
    Math.abs(fastWorld.shuttle.vy) > Math.abs(slowWorld.shuttle.vy),
    "速く振った方が打ち返しの勢いが大きい",
  );
  assert.ok(
    Math.abs(fastWorld.shuttle.vx) > Math.abs(slowWorld.shuttle.vx),
    "速く振った方が羽根に伝わる横速度が大きい",
  );
});

test("風の強さはラリーが伸びるほど大きくなる", () => {
  const world = new HaneRallyWorld(WIDTH, HEIGHT);
  const windAtStart = world.windAmplitude;

  world.rally = 4;
  assert.ok(world.windAmplitude > windAtStart, "ラリーが伸びると風が強まる");
});

test("画面サイズが変わっても羽根とパドルが画面内に収まる", () => {
  const world = new HaneRallyWorld(WIDTH, HEIGHT);

  // PC横長 → スマホ縦長
  world.resize(375, 720);
  assert.ok(world.paddle.x >= 0 && world.paddle.x <= 375, "パドルが画面内");
  assert.ok(world.paddle.y >= 0 && world.paddle.y <= 720, "パドルが画面内");

  for (let i = 0; i < 60; i++) {
    trackShuttlePerfectly(world, world.height * 0.82);
    world.step(FRAME);
  }
  assert.ok(world.shuttle.x >= 0 && world.shuttle.x <= 375, "羽根が画面内に留まる");
  assertFinite(world, "リサイズ後");
});
