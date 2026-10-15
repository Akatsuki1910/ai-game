import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type GateResultEvent,
  gateHalfWidthAt,
  type HitEvent,
  MAX_LIVES,
  RapidsWeaveWorld,
  riverCenterX,
  riverHalfWidth,
} from "./world.ts";

const FRAME = 1 / 60;

function assertFinite(world: RapidsWeaveWorld, label: string): void {
  assert.ok(Number.isFinite(world.lateralX), `${label}: lateralX`);
  assert.ok(Number.isFinite(world.lateralVelocity), `${label}: lateralVelocity`);
  assert.ok(Number.isFinite(world.distance), `${label}: distance`);
  assert.ok(Number.isFinite(world.speed), `${label}: speed`);
  assert.ok(Number.isFinite(world.score), `${label}: score`);
}

/** 無敵時間が切れるまで、安全な川の中央に留まりながら時間を進める。 */
function waitOutInvulnerability(world: RapidsWeaveWorld): void {
  while (world.invulnerableSeconds > 0) {
    world.lateralX = riverCenterX(world.distance);
    world.lateralVelocity = 0;
    world.step(FRAME);
  }
}

/** 強制的に岸へ衝突させる(川幅を大きく超える位置へワープしてから1フレーム進める)。 */
function forceBankHit(world: RapidsWeaveWorld): void {
  world.lateralX = riverCenterX(world.distance) + riverHalfWidth(world.distance) + 500;
  world.step(FRAME);
}

test("起動直後は川の中央に浮かび、ライフ満タン・スコア0で岩とゲートが先読み済み", () => {
  const world = new RapidsWeaveWorld();

  assert.equal(world.lives, MAX_LIVES);
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.lateralX, riverCenterX(0));
  assert.ok(world.rocks.length > 0, "岩が先読みで配置されている");
  assert.ok(world.gates.length > 0, "ゲートが先読みで配置されている");

  // 開始直後の安全地帯には岩もゲートも湧かない
  for (const rock of world.rocks) assert.ok(rock.distance > 100, "開始直後に岩がない");
  for (const gate of world.gates) assert.ok(gate.distance > 100, "開始直後にゲートがない");
});

test("傾け続けると横方向に加速して移動する", () => {
  const world = new RapidsWeaveWorld();
  const startX = world.lateralX;

  world.setLean(1);
  for (let i = 0; i < 20; i++) world.step(FRAME);

  assert.ok(world.lateralX > startX, "右に傾け続けると右へ移動する");
  assertFinite(world, "傾けた後");
});

test("岸に当たるとライフが減り、無敵時間の間は連続では減らない", () => {
  const world = new RapidsWeaveWorld();
  const hits: HitEvent[] = [];
  world.onHit = (event) => hits.push(event);

  forceBankHit(world);
  assert.equal(hits.length, 1, "1回目の衝突でヒットイベントが1つ発生する");
  assert.equal(hits[0].reason, "bank");
  assert.equal(world.lives, MAX_LIVES - 1);
  assert.ok(world.invulnerableSeconds > 0, "衝突後は無敵時間に入る");

  // 無敵時間中に岸へ押し続けても、追加でライフは減らない
  forceBankHit(world);
  forceBankHit(world);
  assert.equal(hits.length, 1, "無敵時間中はヒットが増えない");
  assert.equal(world.lives, MAX_LIVES - 1);

  // 岸の外に出ない(位置は川幅の内側にクランプされる)
  const halfWidth = riverHalfWidth(world.distance);
  const center = riverCenterX(world.distance);
  assert.ok(world.lateralX >= center - halfWidth && world.lateralX <= center + halfWidth);
});

test("岸に3回当たるとゲームオーバーになり、リセットで最初から遊べる", () => {
  const world = new RapidsWeaveWorld();

  for (let i = 0; i < MAX_LIVES; i++) {
    waitOutInvulnerability(world);
    forceBankHit(world);
  }

  assert.equal(world.isOver, true, "ライフが尽きるとラウンドが終わる");
  assert.equal(world.lives, 0);

  // 終了後に進めても壊れない
  world.step(FRAME);
  assertFinite(world, "ゲームオーバー後");

  world.reset();
  assert.equal(world.isOver, false);
  assert.equal(world.lives, MAX_LIVES);
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
});

test("岩に当たるとライフが減る(無敵時間外)", () => {
  const world = new RapidsWeaveWorld();
  const hits: HitEvent[] = [];
  world.onHit = (event) => hits.push(event);

  const rockDistance = world.distance + 5;
  world.rocks = [
    { id: 9001, distance: rockDistance, x: world.lateralX, radius: 20, isResolved: false },
  ];

  while (world.distance < rockDistance) world.step(FRAME);

  assert.equal(hits.length, 1, "岩に当たってヒットイベントが発生する");
  assert.equal(hits[0].reason, "rock");
  assert.equal(world.lives, MAX_LIVES - 1);
  assert.equal(world.rocks[0].isResolved, true);
});

test("無敵時間中は岩を素通りできる", () => {
  const world = new RapidsWeaveWorld();
  forceBankHit(world); // 無敵時間に入る
  assert.ok(world.invulnerableSeconds > 0);
  const livesAfterBankHit = world.lives;

  const rockDistance = world.distance + 1;
  world.rocks = [
    { id: 9002, distance: rockDistance, x: world.lateralX, radius: 20, isResolved: false },
  ];
  while (world.distance < rockDistance) world.step(FRAME);

  assert.equal(world.rocks[0].isResolved, true, "通過したので解決済みになる");
  assert.equal(world.lives, livesAfterBankHit, "無敵時間中はライフが減らない");
});

test("ゲートの間を通過するとコンボと得点が増え、外すとコンボが切れる", () => {
  const world = new RapidsWeaveWorld();
  const results: GateResultEvent[] = [];
  world.onGateResult = (event) => results.push(event);

  const gate1Distance = world.distance + 5;
  world.gates = [
    {
      id: 9101,
      distance: gate1Distance,
      gapCenterX: world.lateralX,
      gapHalfWidth: 40,
      isResolved: false,
      wasSuccess: false,
    },
  ];
  while (world.distance < gate1Distance) world.step(FRAME);

  assert.equal(results.length, 1);
  assert.equal(results[0].isSuccess, true, "ゲートの間を通ると成功する");
  assert.equal(world.combo, 1);
  assert.ok(results[0].points > 0, "得点が入る");
  const scoreAfterFirstGate = world.score;

  const gate2Distance = world.distance + 5;
  world.gates.push({
    id: 9102,
    distance: gate2Distance,
    gapCenterX: world.lateralX + 500, // 遠く外側に置いて確実に外す
    gapHalfWidth: 10,
    isResolved: false,
    wasSuccess: false,
  });
  while (world.distance < gate2Distance) world.step(FRAME);

  assert.equal(results.length, 2);
  assert.equal(results[1].isSuccess, false, "ゲートを外すと失敗になる");
  assert.equal(world.combo, 0, "外すとコンボが切れる");
  assert.ok(world.score >= scoreAfterFirstGate, "得点が減ることはない");
});

test("時間が経つほど前進速度が上がり、上限でクランプされる", () => {
  const world = new RapidsWeaveWorld();
  const initialSpeed = world.speed;

  for (let i = 0; i < 600; i++) world.step(FRAME); // 10秒分

  assert.ok(world.speed > initialSpeed, "速度が時間とともに上がる");

  for (let i = 0; i < 6000; i++) world.step(FRAME); // さらに100秒分

  assert.ok(Number.isFinite(world.speed));
  const speedAfterLongRun = world.speed;
  for (let i = 0; i < 600; i++) world.step(FRAME);
  assert.ok(world.speed - speedAfterLongRun < 1, "速度は上限でほぼ飽和する");
});

test("長時間プレイしても値が有限に保たれ、配列が無限に増えない", () => {
  const world = new RapidsWeaveWorld();

  for (let i = 0; i < 3000; i++) {
    world.setLean(Math.sin(i * 0.1));
    world.step(FRAME);
    if (world.isOver) world.reset();
  }

  assertFinite(world, "長時間プレイ後");
  assert.ok(world.rocks.length < 50, "岩の配列が無限に増えない");
  assert.ok(world.gates.length < 50, "ゲートの配列が無限に増えない");
});

test("川幅・ゲート幅は距離が進むほど狭くなり、最小値以下にはならない", () => {
  assert.ok(riverHalfWidth(0) > riverHalfWidth(5000));
  assert.ok(riverHalfWidth(1_000_000) > 0, "最小幅より狭くならない");
  assert.ok(gateHalfWidthAt(0) > gateHalfWidthAt(5000));
  assert.ok(gateHalfWidthAt(1_000_000) > 0, "ゲートの最小幅より狭くならない");
});
