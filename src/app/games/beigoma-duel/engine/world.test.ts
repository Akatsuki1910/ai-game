import assert from "node:assert/strict";
import { test } from "node:test";
import { BeigomaDuelWorld, MAX_SPIN, STARTING_LIVES, THRUST_SPIN_COST } from "./world.ts";

const WIDTH = 960;
const HEIGHT = 540;
const FRAME = 1 / 60;

/** AI の自律攻撃を止めて、プレイヤー側の挙動だけを検証できるようにする。 */
function freezeOpponentAi(world: BeigomaDuelWorld): void {
  world.opponent.cooldown = Number.POSITIVE_INFINITY;
}

function assertFinite(world: BeigomaDuelWorld, label: string): void {
  assert.ok(
    Number.isFinite(world.player.x) && Number.isFinite(world.player.y),
    `${label}: player position`,
  );
  assert.ok(Number.isFinite(world.player.spin), `${label}: player spin`);
  assert.ok(
    Number.isFinite(world.opponent.x) && Number.isFinite(world.opponent.y),
    `${label}: opponent position`,
  );
  assert.ok(Number.isFinite(world.opponent.spin), `${label}: opponent spin`);
  assert.ok(Number.isFinite(world.score), `${label}: score`);
}

test("起動直後は両者のベーゴマが満タンのスピンで土俵の中にいる", () => {
  const world = new BeigomaDuelWorld(WIDTH, HEIGHT);

  assert.equal(world.player.spin, MAX_SPIN);
  assert.equal(world.opponent.spin, MAX_SPIN);
  assert.equal(world.lives, STARTING_LIVES);
  assert.equal(world.round, 1);
  assert.equal(world.score, 0);
  assert.equal(world.isOver, false);

  const distanceFromCenter = Math.hypot(world.player.x - world.bowlX, world.player.y - world.bowlY);
  assert.ok(distanceFromCenter < world.bowlRadius, "プレイヤーのベーゴマは土俵の中にいる");
  assert.notEqual(world.player.x, world.opponent.x, "二つのベーゴマは別の位置から始まる");
});

test("照準とパワーをドラッグ/キー操作どおりに調整できる", () => {
  const world = new BeigomaDuelWorld(WIDTH, HEIGHT);

  world.adjustAim(Math.PI / 2);
  assert.ok(Math.abs(world.playerAimAngle - Math.PI / 2) < 1e-6);

  world.adjustPower(0.5);
  assert.equal(world.playerChargePower, 0.5);
  world.adjustPower(10);
  assert.equal(world.playerChargePower, 1, "パワーは1を超えない");

  world.setAimFromDrag(100, -0.001);
  assert.ok(Math.abs(world.playerAimAngle - Math.PI) < 1e-2, "ドラッグの逆方向が照準になる");
  assert.ok(world.playerChargePower > 0 && world.playerChargePower <= 1);
});

test("発射するとスピンを消費して加速し、クールダウン中は再発射できない", () => {
  const world = new BeigomaDuelWorld(WIDTH, HEIGHT);
  freezeOpponentAi(world);

  const launched = world.launchThrust();
  assert.equal(launched, true);
  assert.equal(world.player.spin, MAX_SPIN - THRUST_SPIN_COST);
  assert.ok(Math.hypot(world.player.vx, world.player.vy) > 0, "発射で速度がつく");

  const relaunched = world.launchThrust();
  assert.equal(relaunched, false, "クールダウン中は発射できない");
  assert.equal(world.player.spin, MAX_SPIN - THRUST_SPIN_COST, "失敗した発射はスピンを消費しない");
});

test("土俵の壁に当たると押し返されてスピンが減り、座標は有限に保たれる", () => {
  const world = new BeigomaDuelWorld(WIDTH, HEIGHT);
  freezeOpponentAi(world);

  world.player.x = world.bowlX + world.bowlRadius - world.player.radius;
  world.player.y = world.bowlY;
  world.player.vx = 400;
  world.player.vy = 0;
  const spinBefore = world.player.spin;

  world.step(FRAME);

  const distanceFromCenter = Math.hypot(world.player.x - world.bowlX, world.player.y - world.bowlY);
  assert.ok(
    distanceFromCenter <= world.bowlRadius - world.player.radius + 1e-6,
    "壁の外へは出ない",
  );
  assert.ok(world.player.vx < 400, "壁に当たって押し返される");
  assert.ok(world.player.spin < spinBefore, "壁への衝突でスピンが減る");
  assertFinite(world, "壁衝突後");
});

test("二つのベーゴマが衝突すると弾き返り、双方のスピンが減る", () => {
  const world = new BeigomaDuelWorld(WIDTH, HEIGHT);
  freezeOpponentAi(world);

  world.player.x = world.bowlX - 30;
  world.player.y = world.bowlY;
  world.player.vx = 300;
  world.player.vy = 0;

  world.opponent.x = world.bowlX + 30;
  world.opponent.y = world.bowlY;
  world.opponent.vx = -100;
  world.opponent.vy = 0;

  const playerSpinBefore = world.player.spin;
  const opponentSpinBefore = world.opponent.spin;

  world.step(FRAME);

  assert.ok(world.player.spin < playerSpinBefore, "衝突でプレイヤーのスピンが減る");
  assert.ok(world.opponent.spin < opponentSpinBefore, "衝突で相手のスピンが減る");
  assert.ok(world.player.vx < 300, "衝突で速度が変化する(弾き返り)");
  const distance = Math.hypot(world.player.x - world.opponent.x, world.player.y - world.opponent.y);
  assert.ok(
    distance >= world.player.radius + world.opponent.radius - 1e-6,
    "衝突後は重なりが解消されている",
  );
  assertFinite(world, "ベーゴマ衝突後");
});

test("相手のスピンを0にすると勝ち、スコアが増えてラウンドが進み、両者のスピンが戻る", () => {
  const world = new BeigomaDuelWorld(WIDTH, HEIGHT);
  freezeOpponentAi(world);

  const results: string[] = [];
  world.onRoundResult = (result) => results.push(result);

  world.opponent.spin = 0;
  const roundBefore = world.round;

  world.step(FRAME);

  assert.deepEqual(results, ["win"]);
  assert.ok(world.score > 0, "勝利でスコアが増える");
  assert.equal(world.round, roundBefore + 1, "ラウンドが進む");
  assert.equal(world.player.spin, MAX_SPIN, "次のラウンドでスピンが全回復する");
  assert.equal(world.opponent.spin, MAX_SPIN, "相手のスピンも全回復する");
  assert.equal(world.lives, STARTING_LIVES, "ライフは減らない");
  assert.equal(world.isOver, false);
});

test("自分のスピンが0になるとライフが減り、ライフが尽きるとゲームオーバーになる", () => {
  const world = new BeigomaDuelWorld(WIDTH, HEIGHT);
  freezeOpponentAi(world);

  const results: string[] = [];
  world.onRoundResult = (result) => results.push(result);

  for (let life = STARTING_LIVES; life > 1; life--) {
    world.player.spin = 0;
    world.step(FRAME);
    assert.equal(world.isOver, false, `ライフが${life - 1}残っている間はゲームオーバーにならない`);
    assert.equal(world.lives, life - 1);
    assert.equal(world.player.spin, MAX_SPIN, "負けた後も次のラウンドのために全回復する");
  }

  world.player.spin = 0;
  world.step(FRAME);

  assert.equal(world.lives, 0);
  assert.equal(world.isOver, true, "ライフが尽きたらゲームオーバー");
  assert.deepEqual(results, ["lose", "lose", "lose"]);

  world.reset();
  assert.equal(world.isOver, false);
  assert.equal(world.lives, STARTING_LIVES);
  assert.equal(world.score, 0);
  assert.equal(world.round, 1);
});

test("時間経過だけでもスピンは自然に減っていく(待つだけの戦略を抑止)", () => {
  const world = new BeigomaDuelWorld(WIDTH, HEIGHT);
  freezeOpponentAi(world);

  for (let i = 0; i < 120; i++) world.step(FRAME);

  assert.ok(world.player.spin < MAX_SPIN, "何もしなくてもスピンは減る");
  assertFinite(world, "放置後");
});

test("画面サイズが変わっても座標は土俵内に収まり、有限値のまま", () => {
  const world = new BeigomaDuelWorld(WIDTH, HEIGHT);

  world.resize(375, 720);
  assert.ok(world.bowlRadius > 0);
  for (let i = 0; i < 60; i++) world.step(FRAME);

  assertFinite(world, "リサイズ後");
  const distance = Math.hypot(world.player.x - world.bowlX, world.player.y - world.bowlY);
  assert.ok(distance <= world.bowlRadius + 1, "リサイズ後もプレイヤーは土俵内付近に収まる");
});
