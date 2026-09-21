import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CURRENT_SPEED_MAX_FRAC,
  KoiClimbWorld,
  STAMINA_HIT_PENALTY,
  STAMINA_MAX,
} from "./world.ts";

const WIDTH = 800;
const HEIGHT = 600;
const FRAME = 1 / 60;

function assertFinite(world: KoiClimbWorld, label: string): void {
  assert.ok(Number.isFinite(world.koi.x) && Number.isFinite(world.koi.y), `${label}: koi position`);
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.stamina), `${label}: stamina`);
  for (const obstacle of world.obstacles) {
    assert.ok(
      Number.isFinite(obstacle.x) && Number.isFinite(obstacle.y),
      `${label}: obstacle position`,
    );
  }
  for (const pearl of world.pearls) {
    assert.ok(Number.isFinite(pearl.x) && Number.isFinite(pearl.y), `${label}: pearl position`);
  }
}

/** 鯉のちょうど真上に障害物/真珠を置き、次のstepで必ず衝突させる。 */
function parkOnKoi<T extends { x: number; y: number }>(world: KoiClimbWorld, item: T): void {
  item.x = world.koi.x;
  item.y = world.koi.y;
}

/**
 * 初期配置はランダムなため、意図しない障害物/真珠がたまたま鯉の近くに湧いて
 * 衝突テストの結果をぶれさせないよう、すべて盤外の安全な場所へ退避させる。
 */
function moveEverythingAway(world: KoiClimbWorld): void {
  for (const obstacle of world.obstacles) {
    obstacle.x = -100000;
    obstacle.y = -100000;
  }
  for (const pearl of world.pearls) {
    pearl.x = -100000;
    pearl.y = -100000;
  }
}

test("起動直後に鯉・障害物・真珠が揃っている", () => {
  const world = new KoiClimbWorld(WIDTH, HEIGHT);

  assert.equal(world.obstacles.length, 6, "障害物が6個配置されている");
  assert.equal(world.pearls.length, 4, "真珠が4個配置されている");
  assert.equal(world.score, 0);
  assert.equal(world.stamina, STAMINA_MAX);
  assert.equal(world.combo, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.koi.x, world.width / 2, "鯉は水平中央から始まる");
});

test("推進すると鯉が動き、ポインタ方向への推進でも同様に動く", () => {
  const world = new KoiClimbWorld(WIDTH, HEIGHT);
  const start = { x: world.koi.x, y: world.koi.y };

  world.setThrust(1, 0);
  for (let i = 0; i < 30; i++) world.step(FRAME);
  assert.ok(world.koi.x > start.x, "キー入力相当の推進で右へ動く");

  world.setThrust(0, 0);
  world.reset();
  world.setThrustTowardStagePoint(world.width, world.koi.y);
  for (let i = 0; i < 30; i++) world.step(FRAME);
  assert.ok(world.koi.x > world.width / 2, "ポインタ方向への推進でも同様に動く");

  assertFinite(world, "移動後");
});

test("鯉は画面外にはみ出さない", () => {
  const world = new KoiClimbWorld(WIDTH, HEIGHT);
  world.setThrust(-1, -1);
  for (let i = 0; i < 300; i++) world.step(FRAME);

  assert.ok(world.koi.x >= 0 && world.koi.x <= world.width, "鯉が画面内(横)");
  assert.ok(world.koi.y >= 0 && world.koi.y <= world.height, "鯉が画面内(縦)");
});

test("時間経過で距離とスコアが進み、体力が徐々に減っていく", () => {
  const world = new KoiClimbWorld(WIDTH, HEIGHT);

  for (let i = 0; i < 60; i++) world.step(FRAME);

  assert.ok(world.distanceClimbed > 0, "距離が進んでいる");
  assert.ok(world.score > 0, "スコアが進んでいる");
  assert.ok(world.stamina < STAMINA_MAX, "体力が消費されている");
  assertFinite(world, "1秒経過後");
});

test("障害物に当たると体力が減ってコンボがリセットされ、当たった障害物は上方へ再配置される", () => {
  const world = new KoiClimbWorld(WIDTH, HEIGHT);
  moveEverythingAway(world);
  const obstacle = world.obstacles[0];
  parkOnKoi(world, obstacle);

  const hits: number[] = [];
  world.onObstacleHit = () => hits.push(1);

  const staminaBefore = world.stamina;
  world.step(FRAME);

  assert.equal(hits.length, 1, "衝突イベントが1回発生する");
  assert.ok(world.stamina < staminaBefore, "体力が減っている");
  assert.equal(world.combo, 0, "コンボがリセットされる");
  assert.ok(obstacle.y < 0, "当たった障害物は画面上方へ再配置される");
  assertFinite(world, "衝突後");
});

test("無敵時間中は同じフレームで複数回被弾しない", () => {
  const world = new KoiClimbWorld(WIDTH, HEIGHT);
  moveEverythingAway(world);
  parkOnKoi(world, world.obstacles[0]);
  parkOnKoi(world, world.obstacles[1]);

  let hitCount = 0;
  world.onObstacleHit = () => hitCount++;

  const staminaBefore = world.stamina;
  world.step(FRAME);

  assert.equal(hitCount, 1, "同一フレームでは1回しか被弾しない");
  // 被弾ペナルティに加えて経過時間ぶんの自然減少もわずかに乗るため、誤差を許容して比較する。
  const staminaLost = staminaBefore - world.stamina;
  assert.ok(
    Math.abs(staminaLost - STAMINA_HIT_PENALTY) < 1,
    `体力の減少量はほぼ1回分(${STAMINA_HIT_PENALTY})のはず: 実際は${staminaLost}`,
  );
});

test("真珠を取ると得点とコンボが伸び、体力が回復する（上限あり）", () => {
  const world = new KoiClimbWorld(WIDTH, HEIGHT);
  moveEverythingAway(world);
  world.stamina = 50;

  const collected: number[] = [];
  world.onPearlCollected = ({ points, combo }) => collected.push(points * 100 + combo);

  parkOnKoi(world, world.pearls[0]);
  world.step(FRAME);
  assert.equal(collected.length, 1, "1個目の真珠を取った");
  assert.equal(world.combo, 1, "コンボが1になる");
  assert.ok(world.stamina > 50, "体力が回復する");
  const scoreAfterFirst = world.score;

  parkOnKoi(world, world.pearls[1]);
  world.step(FRAME);
  assert.equal(world.combo, 2, "連続で取るとコンボが伸びる");
  assert.ok(world.score - scoreAfterFirst > 20, "コンボボーナスで2個目のほうが得点が大きい");

  world.stamina = STAMINA_MAX;
  parkOnKoi(world, world.pearls[2]);
  world.step(FRAME);
  assert.equal(world.stamina, STAMINA_MAX, "体力は上限を超えて回復しない");

  assertFinite(world, "取得後");
});

test("画面外まで流れた障害物・真珠は再び上方から出現する", () => {
  const world = new KoiClimbWorld(WIDTH, HEIGHT);
  const obstacle = world.obstacles[0];
  obstacle.y = world.height + obstacle.radius + 1;
  const pearl = world.pearls[0];
  pearl.y = world.height + pearl.radius + 1;

  world.step(FRAME);

  assert.ok(obstacle.y < 0, "画面外に出た障害物は上方から出現し直す");
  assert.ok(pearl.y < 0, "画面外に出た真珠は上方から出現し直す");
});

test("体力が尽きるとゲームオーバーになり、終了後は状態が進まない", () => {
  const world = new KoiClimbWorld(WIDTH, HEIGHT);
  moveEverythingAway(world);
  world.stamina = 0;

  let sweptAway = 0;
  world.onSweptAway = () => sweptAway++;

  world.step(FRAME);

  assert.equal(world.isOver, true, "体力切れでラウンドが終わる");
  assert.equal(sweptAway, 1, "押し流されたイベントが発火する");

  const scoreAtOver = world.score;
  const distanceAtOver = world.distanceClimbed;
  world.step(FRAME);
  assert.equal(world.score, scoreAtOver, "終了後はスコアが進まない");
  assert.equal(world.distanceClimbed, distanceAtOver, "終了後は距離が進まない");
  assertFinite(world, "終了後");
});

test("リセットで最初の状態に戻る", () => {
  const world = new KoiClimbWorld(WIDTH, HEIGHT);
  for (let i = 0; i < 120; i++) world.step(FRAME);
  world.reset();

  assert.equal(world.isOver, false);
  assert.equal(world.score, 0);
  assert.equal(world.distanceClimbed, 0);
  assert.equal(world.stamina, STAMINA_MAX);
  assert.equal(world.combo, 0);
  assert.equal(world.pearlsCollected, 0);
  assert.equal(world.koi.x, world.width / 2);
});

test("流速は時間とともに上がり、上限で頭打ちになる", () => {
  const world = new KoiClimbWorld(WIDTH, HEIGHT);
  const initialSpeed = world.currentSpeed;

  // 体力切れによるラウンド終了で流速の進行が止まらないよう、都度満タンに固定する。
  for (let i = 0; i < 60; i++) {
    world.stamina = STAMINA_MAX;
    world.step(FRAME);
  }
  const afterOneSecond = world.currentSpeed;
  assert.ok(afterOneSecond > initialSpeed, "流速が上がっている");

  for (let i = 0; i < 60 * 150; i++) {
    world.stamina = STAMINA_MAX;
    world.step(FRAME);
  }
  assert.equal(
    world.currentSpeed,
    world.height * CURRENT_SPEED_MAX_FRAC,
    "流速は上限で頭打ちになる",
  );
});

test("画面サイズが変わっても盤面が画面内に収まる", () => {
  const world = new KoiClimbWorld(WIDTH, HEIGHT);

  world.resize(390, 780);
  assert.ok(world.koi.x >= 0 && world.koi.x <= world.width, "鯉が画面内(横)");
  assert.ok(world.koi.y >= 0 && world.koi.y <= world.height, "鯉が画面内(縦)");

  for (let i = 0; i < 120; i++) world.step(FRAME);
  assertFinite(world, "リサイズ後");
});
