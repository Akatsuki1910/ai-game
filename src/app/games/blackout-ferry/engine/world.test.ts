import assert from "node:assert/strict";
import { test } from "node:test";
import { BlackoutFerryWorld, type Tower } from "./world.ts";

const WIDTH = 800;
const HEIGHT = 540;
const FRAME = 1 / 60;

/** 指定タワー以外を無効化(射程0)し、干渉なしに1本のサーチライトだけを検証できるようにする。 */
function isolateTower(world: BlackoutFerryWorld, keepIndex: number): void {
  world.towers.forEach((tower, index) => {
    if (index !== keepIndex) tower.range = 0;
  });
}

/** 指定タワーの首振りを止め、現在の舟の位置へ常に真っ直ぐ照準を合わせ続ける。 */
function aimTowerAtBoat(world: BlackoutFerryWorld, index: number): void {
  const tower = world.towers[index];
  const angle = Math.atan2(world.boat.y - tower.y, world.boat.x - tower.x);
  tower.baseAngle = angle;
  tower.sweepAmplitude = 0;
  tower.phase = 0;
  tower.halfAperture = 0.3;
  tower.range = Math.max(world.width, world.height);
}

function assertFinite(world: BlackoutFerryWorld, label: string): void {
  assert.ok(Number.isFinite(world.boat.x) && Number.isFinite(world.boat.y), `${label}: boat`);
  assert.ok(Number.isFinite(world.suspicion), `${label}: suspicion`);
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  for (const tower of world.towers) {
    assert.ok(Number.isFinite(tower.currentAngle), `${label}: tower angle`);
  }
}

/** 出航直後の猶予(GRACE_SECONDS)を、全タワー無効化した状態で消化する。 */
function exhaustGrace(world: BlackoutFerryWorld): void {
  for (const tower of world.towers) tower.range = 0;
  for (let i = 0; i < 120; i++) world.step(FRAME);
}

test("起動直後は舟が上端中央にいて、タワーが配置されている", () => {
  const world = new BlackoutFerryWorld(WIDTH, HEIGHT);

  assert.equal(world.boat.x, WIDTH / 2);
  assert.equal(world.boat.y, 0);
  assert.ok(world.towers.length > 0, "タワーが配置されている");
  assert.equal(world.score, 0);
  assert.equal(world.crossings, 0);
  assert.ok(world.lives > 0);
  assert.equal(world.isOver, false);

  const sides = new Set(world.towers.map((t: Tower) => t.side));
  assert.ok(sides.has("left") || sides.has("right"), "岸のどちらかにタワーがある");
});

test("何もしなくても舟は自動的に対岸へ向けて前進する", () => {
  const world = new BlackoutFerryWorld(WIDTH, HEIGHT);
  exhaustGrace(world);
  const before = world.boat.y;

  for (let i = 0; i < 30; i++) world.step(FRAME);

  assert.ok(world.boat.y > before, "y座標が進んでいる");
});

test("操舵目標を設定すると舟がその方向へ寄っていく", () => {
  const world = new BlackoutFerryWorld(WIDTH, HEIGHT);
  world.setSteerTarget(WIDTH * 0.85);

  for (let i = 0; i < 90; i++) world.step(FRAME);

  assert.ok(world.boat.x > WIDTH / 2, "指定した方向へ寄っている");
  assert.ok(world.boat.x <= WIDTH - world.boat.radius, "画面外にははみ出さない");
});

test("操舵目標をクリアすると中央へ緩やかに戻る", () => {
  const world = new BlackoutFerryWorld(WIDTH, HEIGHT);
  world.setSteerTarget(WIDTH * 0.9);
  for (let i = 0; i < 30; i++) world.step(FRAME);
  const offCenter = world.boat.x;

  world.clearSteerTarget();
  for (let i = 0; i < 120; i++) world.step(FRAME);

  assert.ok(
    Math.abs(world.boat.x - WIDTH / 2) < Math.abs(offCenter - WIDTH / 2),
    "中央に近づいている",
  );
});

test("キー操作(相対移動)でも操舵目標を動かせる", () => {
  const world = new BlackoutFerryWorld(WIDTH, HEIGHT);
  for (let i = 0; i < 60; i++) {
    world.nudgeSteerTarget(6);
    world.step(FRAME);
  }

  assert.ok(world.boat.x > WIDTH / 2, "キー操作で右へ寄る");
});

test("サーチライトに照らされ続けると疑心度が上がる", () => {
  const world = new BlackoutFerryWorld(WIDTH, HEIGHT);
  exhaustGrace(world);
  const before = world.suspicion;

  for (let i = 0; i < 40; i++) {
    aimTowerAtBoat(world, 0);
    isolateTower(world, 0);
    world.step(FRAME);
  }

  assert.ok(world.suspicion > before, "疑心度が増えている");
  assert.ok(world.illumination > 0, "照射強度が記録されている");
});

test("光から外れると疑心度が下がる", () => {
  const world = new BlackoutFerryWorld(WIDTH, HEIGHT);
  exhaustGrace(world);
  for (let i = 0; i < 40; i++) {
    aimTowerAtBoat(world, 0);
    isolateTower(world, 0);
    world.step(FRAME);
  }
  const charged = world.suspicion;
  assert.ok(charged > 0, "前提: 疑心度が溜まっている");

  for (const tower of world.towers) tower.range = 0;
  for (let i = 0; i < 40; i++) world.step(FRAME);

  assert.ok(world.suspicion < charged, "疑心度が減っている");
});

test("疑心度が上限に達すると見つかってライフが減り、出航地点に戻される", () => {
  const world = new BlackoutFerryWorld(WIDTH, HEIGHT);
  exhaustGrace(world);
  const livesBefore = world.lives;
  let caughtCount = 0;
  world.onCaught = () => {
    caughtCount += 1;
  };

  let caught = false;
  for (let i = 0; i < 600 && !caught; i++) {
    aimTowerAtBoat(world, 0);
    isolateTower(world, 0);
    const before = world.lives;
    world.step(FRAME);
    if (world.lives < before) caught = true;
    assertFinite(world, "追跡中");
  }

  assert.ok(caught, "見つかってライフが減った");
  assert.equal(caughtCount, 1, "捕捉イベントが1回発火した");
  assert.equal(world.lives, livesBefore - 1);
  assert.equal(world.boat.y, 0, "出航地点(上端)へ戻される");
  assert.equal(world.suspicion, 0, "疑心度がリセットされる");
});

test("ライフを使い切るとゲームオーバーになる", () => {
  const world = new BlackoutFerryWorld(WIDTH, HEIGHT);

  for (let round = 0; round < world.lives + 1 && !world.isOver; round++) {
    exhaustGrace(world);
    for (let i = 0; i < 600 && !world.isOver; i++) {
      aimTowerAtBoat(world, 0);
      isolateTower(world, 0);
      world.step(FRAME);
    }
  }

  assert.equal(world.isOver, true, "ライフを使い切って終了する");
  assertFinite(world, "ゲームオーバー後");

  world.step(FRAME);
  assertFinite(world, "終了後にstepしても壊れない");

  world.reset();
  assert.equal(world.isOver, false);
  assert.equal(world.score, 0);
  assert.equal(world.crossings, 0);
  assert.ok(world.lives > 0);
});

test("対岸まで渡り切ると得点が入り、次の渡航はタワーが増える", () => {
  const world = new BlackoutFerryWorld(WIDTH, HEIGHT);
  for (const tower of world.towers) tower.range = 0;
  const towerCountBefore = world.towers.length;
  world.setBoosting(true);

  const completed: number[] = [];
  world.onCrossingCompleted = ({ points }) => completed.push(points);

  for (let i = 0; i < 600 && completed.length === 0; i++) {
    for (const tower of world.towers) tower.range = 0;
    world.step(FRAME);
  }

  assert.equal(completed.length, 1, "1回渡り切った");
  assert.ok(completed[0] > 0, "得点が入っている");
  assert.equal(world.score, completed[0]);
  assert.equal(world.crossings, 1);
  assert.equal(world.boat.y, 0, "次の渡航は上端から");
  assert.ok(world.towers.length >= towerCountBefore, "タワーが増える(または上限で維持)");
});

test("画面サイズが変わっても舟とタワーが画面内に収まる", () => {
  const world = new BlackoutFerryWorld(WIDTH, HEIGHT);

  world.resize(390, 780);

  assert.ok(world.boat.x >= 0 && world.boat.x <= 390, "舟が画面内");
  for (const tower of world.towers) {
    assert.ok(tower.x === 0 || tower.x === 390, "タワーは岸(左右端)に固定される");
    assert.ok(tower.y >= -60 && tower.y <= 840, "タワーが概ね画面内の高さにいる");
  }

  for (let i = 0; i < 60; i++) world.step(FRAME);
  assertFinite(world, "リサイズ後");
});

test("長時間・多様な操作を経ても値がNaN/Infinityにならない", () => {
  const world = new BlackoutFerryWorld(WIDTH, HEIGHT);

  for (let i = 0; i < 2000 && !world.isOver; i++) {
    if (i % 7 === 0) world.setSteerTarget(Math.random() * WIDTH);
    if (i % 11 === 0) world.clearSteerTarget();
    if (i % 5 === 0) world.nudgeSteerTarget((Math.random() - 0.5) * 20);
    world.setBoosting(i % 3 === 0);
    world.step(FRAME);
    assertFinite(world, `フレーム${i}`);
  }
});
