import assert from "node:assert/strict";
import { test } from "node:test";
import { CloseHauledWorld } from "./world.ts";

const WIDTH = 960;
const HEIGHT = 540;
const FRAME = 1 / 60;

function assertFinite(world: CloseHauledWorld, label: string): void {
  assert.ok(
    Number.isFinite(world.boatX) && Number.isFinite(world.boatY),
    `${label}: boat position`,
  );
  assert.ok(Number.isFinite(world.boatHeading), `${label}: heading`);
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.timeRemaining), `${label}: timeRemaining`);
  assert.ok(
    Number.isFinite(world.activeBuoy.x) && Number.isFinite(world.activeBuoy.y),
    `${label}: buoy position`,
  );
}

test("起動直後に船とブイが画面内に配置されている", () => {
  const world = new CloseHauledWorld(WIDTH, HEIGHT);

  assert.ok(world.boatX >= 0 && world.boatX <= WIDTH);
  assert.ok(world.boatY >= 0 && world.boatY <= HEIGHT);
  assert.ok(world.activeBuoy.x >= 0 && world.activeBuoy.x <= WIDTH);
  assert.ok(world.activeBuoy.y >= 0 && world.activeBuoy.y <= HEIGHT);
  assert.equal(world.score, 0);
  assert.equal(world.buoysCollected, 0);
  assert.equal(world.isOver, false);
  assert.ok(world.timeRemaining > 0);
});

test("初期針路はノーゴーゾーンの外なので、何も操作しなくても進み始める", () => {
  const world = new CloseHauledWorld(WIDTH, HEIGHT);
  const before = { x: world.boatX, y: world.boatY };

  for (let i = 0; i < 30; i++) world.step(FRAME);

  assert.ok(world.speedFraction > 0, "無操作でも推進効率が0より大きい");
  const moved = Math.hypot(world.boatX - before.x, world.boatY - before.y);
  assert.ok(moved > 0.5, "船が実際に動いている");
});

test("ノーゴーゾーンへ向けると失速する", () => {
  const world = new CloseHauledWorld(WIDTH, HEIGHT);
  // 風上そのものへ針路を向け続ける
  world.targetHeading = world.windFromAngle;
  world.boatHeading = world.windFromAngle;

  for (let i = 0; i < 30; i++) {
    world.targetHeading = world.windFromAngle;
    world.step(FRAME);
  }

  assert.equal(world.speedFraction, 0, "ノーゴーゾーンでは推進効率が0");
  assert.equal(world.speed, 0);
});

test("ポインタで指した方角へ舵を切ると針路がその方向へ収束する", () => {
  const world = new CloseHauledWorld(WIDTH, HEIGHT);
  world.setTargetHeadingTowards(world.boatX + 100, world.boatY);
  assert.ok(Math.abs(world.targetHeading - 0) < 1e-9, "真右を指したら目標角は0ラジアン");

  for (let i = 0; i < 120; i++) world.step(FRAME);

  assert.ok(Math.abs(world.boatHeading - world.targetHeading) < 1e-6, "針路が目標角に収束する");
});

test("キーボード入力で目標針路が連続的に変化する", () => {
  const world = new CloseHauledWorld(WIDTH, HEIGHT);
  const before = world.targetHeading;

  world.steerByKey(1, FRAME);
  assert.notEqual(world.targetHeading, before, "右旋回で目標角が変わる");

  const afterRight = world.targetHeading;
  world.steerByKey(-1, FRAME);
  world.steerByKey(-1, FRAME);
  assert.ok(world.targetHeading < afterRight, "左旋回で目標角が戻る方向に変わる");
});

test("ブイに到達すると加点してリスポーンし、3個ごとにレグが進む", () => {
  const world = new CloseHauledWorld(WIDTH, HEIGHT);
  const captured: number[] = [];
  world.onBuoyCaptured = ({ points }) => captured.push(points);

  const initialLeg = world.leg;
  for (let i = 0; i < 4; i++) {
    const buoyId = world.activeBuoy.id;
    // 強制的にブイの真横まで船を寄せて捕獲させる（風向きに依存せず決定的にテストする）
    world.boatX = world.activeBuoy.x;
    world.boatY = world.activeBuoy.y;
    world.step(FRAME);
    assert.notEqual(world.activeBuoy.id, buoyId, "捕獲後は新しいブイが出る");
  }

  assert.equal(captured.length, 4, "4回捕獲イベントが発火した");
  assert.equal(world.buoysCollected, 4);
  assert.equal(
    world.score,
    captured.reduce((sum, p) => sum + p, 0),
  );
  assert.ok(world.leg >= initialLeg + 1, "3個捕獲した時点でレグが進んでいる");
  assertFinite(world, "連続捕獲後");
});

test("75秒経過するとラウンドが終了し、リセットでやり直せる", () => {
  const world = new CloseHauledWorld(WIDTH, HEIGHT);

  for (let i = 0; i < 2000 && !world.isOver; i++) {
    world.step(0.1);
    assertFinite(world, "ラウンド中");
  }

  assert.equal(world.isOver, true);
  assert.equal(world.timeRemaining, 0);

  // 終了後に進めても壊れない
  const scoreAtEnd = world.score;
  world.step(FRAME);
  assert.equal(world.score, scoreAtEnd, "終了後はスコアが変化しない");
  assertFinite(world, "ラウンド終了後");

  world.reset();
  assert.equal(world.isOver, false);
  assert.equal(world.score, 0);
  assert.equal(world.buoysCollected, 0);
  assert.equal(world.leg, 1);
  assert.ok(world.timeRemaining > 0);
});

test("画面サイズが変わっても船・ブイ・航跡が画面内に留まる", () => {
  const world = new CloseHauledWorld(WIDTH, HEIGHT);
  for (let i = 0; i < 60; i++) world.step(FRAME);
  assert.ok(world.wake.length > 0, "航跡が生成されている");

  // PC横長 → スマホ縦長
  world.resize(375, 720);

  assert.ok(world.boatX >= -1 && world.boatX <= 376);
  assert.ok(world.boatY >= -1 && world.boatY <= 721);
  assert.ok(world.activeBuoy.x >= -1 && world.activeBuoy.x <= 376);
  assert.ok(world.activeBuoy.y >= -1 && world.activeBuoy.y <= 721);
  for (const point of world.wake) {
    assert.ok(point.x >= -1 && point.x <= 376, "航跡が画面内に収まる");
    assert.ok(point.y >= -1 && point.y <= 721, "航跡が画面内に収まる");
  }

  for (let i = 0; i < 60; i++) world.step(FRAME);
  assertFinite(world, "リサイズ後");
});

test("航跡は一定時間で消える", () => {
  const world = new CloseHauledWorld(WIDTH, HEIGHT);
  for (let i = 0; i < 60; i++) world.step(FRAME);
  assert.ok(world.wake.length > 0, "航跡が積まれている");

  for (let i = 0; i < 600; i++) world.step(FRAME);
  assert.ok(
    world.wake.every((point) => point.age < 3),
    "航跡は寿命を超えたら破棄される",
  );
});
