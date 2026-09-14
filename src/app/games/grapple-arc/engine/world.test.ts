import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GRAB_RADIUS,
  GROUND_Y,
  GrappleArcWorld,
  MAX_ROPE_LENGTH,
  MIN_ROPE_LENGTH,
} from "./world.ts";

const WIDTH = 960;
const HEIGHT = 540;
const FRAME = 1 / 60;

function assertFinite(world: GrappleArcWorld, label: string): void {
  assert.ok(Number.isFinite(world.playerX), `${label}: playerX`);
  assert.ok(Number.isFinite(world.playerY), `${label}: playerY`);
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.furthestX), `${label}: furthestX`);
}

test("起動直後は最初のアンカーに掴まった状態で始まる", () => {
  const world = new GrappleArcWorld(WIDTH, HEIGHT);

  assert.equal(world.isOver, false);
  assert.equal(world.isAttached, true);
  assert.ok(world.attachedAnchorId !== null);
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.ok(world.anchors.length > 0, "先のアンカーがあらかじめ用意されている");
  assertFinite(world, "起動直後");
});

test("無操作でも振り子として揺れ続ける（一点で静止しない）", () => {
  const world = new GrappleArcWorld(WIDTH, HEIGHT);
  const before = { x: world.playerX, y: world.playerY };

  for (let i = 0; i < 30; i++) world.step(FRAME);

  const moved = Math.hypot(world.playerX - before.x, world.playerY - before.y) > 0.5;
  assert.ok(moved, "重力で振り子が動き出している");
  assert.equal(world.isAttached, true, "何もしなければ最初のアンカーに掴まったまま");
  assertFinite(world, "無操作で揺れた後");
});

test("放すと自由落下になり、何もつかまなければ谷底に落ちてゲームオーバーになる", () => {
  const world = new GrappleArcWorld(WIDTH, HEIGHT);
  world.release();
  assert.equal(world.isAttached, false);

  let steps = 0;
  while (!world.isOver && steps < 1000) {
    world.step(FRAME);
    assertFinite(world, "落下中");
    steps++;
  }

  assert.equal(world.isOver, true, "有限のステップ数で転落する");
  assert.ok(world.playerY - GROUND_Y >= -1, "谷底より下に落ちている");

  const frozenX = world.playerX;
  const frozenY = world.playerY;
  world.step(FRAME);
  assert.equal(world.playerX, frozenX, "ゲームオーバー後は位置が変化しない");
  assert.equal(world.playerY, frozenY);

  world.attemptGrab();
  world.release();
  assert.equal(world.isAttached, false, "ゲームオーバー後はつかむ/放す操作が効かない");
});

test("射程内の次のアンカーをつかむと、得点とコンボが増えてイベントが飛ぶ", () => {
  const world = new GrappleArcWorld(WIDTH, HEIGHT);
  const nextAnchor = { id: 999_001, x: world.playerX + 40, y: world.playerY };
  world.anchors.push(nextAnchor);

  const grabbed: Array<{ points: number; combo: number }> = [];
  world.onAnchorGrabbed = (event) => grabbed.push({ points: event.points, combo: event.combo });

  world.release();
  world.attemptGrab();

  assert.equal(world.isAttached, true, "射程内のアンカーをつかめる");
  assert.equal(world.attachedAnchorId, nextAnchor.id);
  assert.equal(world.combo, 1);
  assert.equal(world.anchorsGrabbed, 1);
  assert.ok(world.score > 0, "得点が入っている");
  assert.equal(grabbed.length, 1);
  assert.equal(grabbed[0].combo, 1);
  assert.ok(world.ropeLength >= MIN_ROPE_LENGTH && world.ropeLength <= MAX_ROPE_LENGTH);
});

test("射程外でつかもうとすると空振りしてコンボが途切れる", () => {
  const world = new GrappleArcWorld(WIDTH, HEIGHT);
  const nextAnchor = { id: 999_002, x: world.playerX + 40, y: world.playerY };
  world.anchors.push(nextAnchor);
  world.release();
  world.attemptGrab();
  assert.equal(world.combo, 1, "前提: 一度つかんでコンボを積んでおく");

  world.release();
  // 自動生成されたアンカーが偶然射程内に入る余地をなくし、確実に「射程外」の状況を作る
  world.anchors = [];
  world.teleportTo(world.playerX + GRAB_RADIUS * 10, world.playerY);

  world.attemptGrab();

  assert.equal(world.isAttached, false, "射程外なのでつかめない");
  assert.equal(world.combo, 0, "空振りでコンボが0に戻る");
  assert.equal(world.anchorsGrabbed, 1, "つかんだ回数自体は減らない");
});

test("reset() で得点・位置・アンカーが初期状態に戻る", () => {
  const world = new GrappleArcWorld(WIDTH, HEIGHT);
  world.release();
  for (let i = 0; i < 200 && !world.isOver; i++) world.step(FRAME);
  assert.equal(world.isOver, true, "前提: 一度ゲームオーバーにしておく");

  world.reset();

  assert.equal(world.isOver, false);
  assert.equal(world.isAttached, true);
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.anchorsGrabbed, 0);
  assert.equal(world.furthestX, 0);
  assertFinite(world, "リセット後");
});

test("画面サイズが変わっても、表示範囲の先までアンカーが用意される", () => {
  const world = new GrappleArcWorld(320, 480);
  const narrowFurthestAnchorX = Math.max(...world.anchors.map((a) => a.x));

  world.resize(1600, 800);
  const wideFurthestAnchorX = Math.max(...world.anchors.map((a) => a.x));

  assert.ok(
    wideFurthestAnchorX > narrowFurthestAnchorX,
    "画面が広がった分だけ先のアンカーまで補充される",
  );
  assert.ok(
    wideFurthestAnchorX >= world.cameraX + world.logicalViewWidth,
    "表示範囲より手前でアンカーが尽きない",
  );

  // 不正なサイズを渡しても壊れない
  world.resize(0, 0);
  world.resize(-10, -10);
  assert.ok(world.width > 0 && world.height > 0, "不正なリサイズ値は無視される");
});

test("前に進み続けるとアンカー配列が際限なく伸びず、掃除される", () => {
  const world = new GrappleArcWorld(WIDTH, HEIGHT);
  world.release();

  for (let i = 0; i < 60; i++) {
    world.teleportTo(world.playerX + 300, 300);
    world.step(FRAME);
  }

  assert.ok(world.anchors.length < 60, "手前のアンカーが掃除され、配列が伸び続けない");
  assertFinite(world, "長距離移動後");
});
