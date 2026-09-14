import assert from "node:assert/strict";
import { test } from "node:test";
import { PowderRushWorld } from "./world.ts";

const WIDTH = 480;
const HEIGHT = 720;
const FRAME = 1 / 60;

function assertFinite(world: PowderRushWorld, label: string): void {
  assert.ok(Number.isFinite(world.ballX), `${label}: ballX`);
  assert.ok(Number.isFinite(world.ballRadius), `${label}: ballRadius`);
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.distanceTraveled), `${label}: distanceTraveled`);
  for (const patch of world.patches) {
    assert.ok(Number.isFinite(patch.x) && Number.isFinite(patch.z), `${label}: patch position`);
  }
  for (const obstacle of world.obstacles) {
    assert.ok(
      Number.isFinite(obstacle.x) && Number.isFinite(obstacle.z),
      `${label}: obstacle position`,
    );
  }
}

test("起動直後は初期半径・スコア0・アイテムなしで中央に始まる", () => {
  const world = new PowderRushWorld(WIDTH, HEIGHT);

  assert.equal(world.ballX, WIDTH / 2);
  assert.equal(world.ballRadius, 16);
  assert.equal(world.score, 0);
  assert.equal(world.distanceTraveled, 0);
  assert.equal(world.patches.length, 0);
  assert.equal(world.obstacles.length, 0);
  assert.equal(world.isOver, false);
  assertFinite(world, "起動直後");
});

test("無操作でも時間経過とともに距離とスコアが進む", () => {
  const world = new PowderRushWorld(WIDTH, HEIGHT);

  for (let i = 0; i < 60; i++) world.step(FRAME);

  assert.ok(world.distanceTraveled > 0, "距離が進む");
  assert.ok(world.score > 0, "距離に応じてスコアが入る");
  assertFinite(world, "1秒経過後");
});

test("時間経過とともに雪の塊(パッチ)または障害物が自動的にスポーンされる", () => {
  const world = new PowderRushWorld(WIDTH, HEIGHT);

  for (let i = 0; i < 300 && world.patches.length + world.obstacles.length === 0; i++) {
    world.step(FRAME);
  }

  assert.ok(world.patches.length + world.obstacles.length > 0, "5秒以内に何かスポーンする");
  assertFinite(world, "スポーン直後");
});

test("雪パッチを通過すると成長し、スコアとコンボが増える", () => {
  const world = new PowderRushWorld(WIDTH, HEIGHT);
  const events: Array<{ x: number; points: number; combo: number }> = [];
  world.onPatchCollected = (event) => events.push(event);
  world.patches.push({ id: 999_001, x: world.ballX, z: world.distanceTraveled, radius: 22 });

  world.step(FRAME);

  assert.equal(world.patches.length, 0, "解決されたパッチはワールドから取り除かれる");
  // 陽射しによる微量の自然減少(1フレーム分)を差し引いた分だけ増える。
  assert.ok(Math.abs(world.ballRadius - (16 + 3 - 0.6 * FRAME)) < 1e-6, "半径が成長分だけ増える");
  assert.equal(world.combo, 1);
  assert.equal(events.length, 1);
  assert.ok(events[0].points > 0);
  assertFinite(world, "パッチ通過後");
});

test("小さすぎる岩に衝突すると押しつぶせず、半径が減りコンボが途切れる", () => {
  const world = new PowderRushWorld(WIDTH, HEIGHT);
  const events: Array<{ outcome: string; kind: string }> = [];
  world.onObstacleResolved = (event) => events.push(event);
  world.obstacles.push({
    id: 999_002,
    x: world.ballX,
    z: world.distanceTraveled,
    radius: 20,
    kind: "rock",
  });

  world.step(FRAME);

  assert.equal(world.obstacles.length, 0, "解決された岩はワールドから取り除かれる");
  assert.ok(
    Math.abs(world.ballRadius - (16 - 8 - 0.6 * FRAME)) < 1e-6,
    "16 - ダメージ8 - 自然減少 まで縮む",
  );
  assert.equal(world.combo, 0);
  assert.equal(events.length, 1);
  assert.equal(events[0].outcome, "hit");
  assert.equal(world.isOver, false, "溶けきる半径にはまだ達していない");
  assertFinite(world, "小岩衝突後");
});

test("十分に大きく育っていれば岩を押しつぶせ、半径を保ったままスコアが増える", () => {
  const world = new PowderRushWorld(WIDTH, HEIGHT);
  world.ballRadius = 40;
  const events: Array<{ outcome: string; points?: number }> = [];
  world.onObstacleResolved = (event) => events.push(event);
  world.obstacles.push({
    id: 999_003,
    x: world.ballX,
    z: world.distanceTraveled,
    radius: 25,
    kind: "rock",
  });

  world.step(FRAME);

  assert.equal(world.obstacles.length, 0);
  assert.ok(
    Math.abs(world.ballRadius - (40 - 0.6 * FRAME)) < 1e-6,
    "押しつぶした岩そのものでは半径は変化しない(自然減少のみ)",
  );
  assert.equal(world.combo, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0].outcome, "crushed");
  assert.ok((events[0].points ?? 0) > 0);
  assertFinite(world, "岩を押しつぶした後");
});

test("木はどれだけ大きく育っていても押しつぶせず、必ずダメージになる", () => {
  const world = new PowderRushWorld(WIDTH, HEIGHT);
  world.ballRadius = 40;
  const events: Array<{ outcome: string; kind: string }> = [];
  world.onObstacleResolved = (event) => events.push(event);
  world.obstacles.push({
    id: 999_004,
    x: world.ballX,
    z: world.distanceTraveled,
    radius: 18,
    kind: "tree",
  });

  world.step(FRAME);

  assert.ok(
    Math.abs(world.ballRadius - (40 - 8 - 0.6 * FRAME)) < 1e-6,
    "木は必ずダメージ8を受ける(自然減少込み)",
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].outcome, "hit");
  assert.equal(events[0].kind, "tree");
});

test("半径が溶ける閾値まで縮むとゲームオーバーになり、以後は状態が変化しない", () => {
  const world = new PowderRushWorld(WIDTH, HEIGHT);
  world.ballRadius = 13; // 13 - 8 = 5 <= 溶ける閾値(6)
  let melted: { distance: number; score: number } | null = null;
  world.onMelted = (event) => {
    melted = event;
  };
  world.obstacles.push({
    id: 999_005,
    x: world.ballX,
    z: world.distanceTraveled,
    radius: 20,
    kind: "rock",
  });

  world.step(FRAME);

  assert.equal(world.isOver, true);
  assert.ok(world.ballRadius <= 6);
  assert.ok(melted !== null, "溶けたイベントが発火する");
  assertFinite(world, "溶けた直後");

  const frozenScore = world.score;
  const frozenDistance = world.distanceTraveled;
  const frozenBallX = world.ballX;

  world.setSteeringInput(1);
  world.step(FRAME);

  assert.equal(world.score, frozenScore, "終了後はスコアが変化しない");
  assert.equal(world.distanceTraveled, frozenDistance, "終了後は距離も進まない");
  assert.equal(world.ballX, frozenBallX, "終了後は操作しても位置が変わらない");
});

test("何も操作せず放置しても、陽射しによる自然減少だけでいずれ溶けてゲームオーバーになる", () => {
  const world = new PowderRushWorld(WIDTH, HEIGHT);
  let melted: { distance: number; score: number } | null = null;
  world.onMelted = (event) => {
    melted = event;
  };

  for (let i = 0; i < 1800 && !world.isOver; i++) world.step(FRAME);

  assert.equal(world.isOver, true, "無操作でも自然減少だけで30秒あれば必ず溶けきる");
  assert.ok(melted !== null, "溶けたイベントが発火する");
  assertFinite(world, "放置による溶解後");
});

test("reset() で半径・スコア・距離・アイテムが初期状態に戻る", () => {
  const world = new PowderRushWorld(WIDTH, HEIGHT);
  world.setSteeringInput(1);
  for (let i = 0; i < 300; i++) world.step(FRAME);
  assert.ok(world.distanceTraveled > 0, "前提: プレイが進んでいる");

  world.reset();

  assert.equal(world.ballX, WIDTH / 2);
  assert.equal(world.ballRadius, 16);
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.distanceTraveled, 0);
  assert.equal(world.patches.length, 0);
  assert.equal(world.obstacles.length, 0);
  assert.equal(world.isOver, false);
});

test("画面サイズが変わってもボールとアイテムの位置は比例して追従し、不正なサイズは無視される", () => {
  const world = new PowderRushWorld(WIDTH, HEIGHT);
  world.patches.push({ id: 999_006, x: WIDTH / 4, z: 100, radius: 22 });

  world.resize(WIDTH * 2, HEIGHT * 2);

  assert.ok(Math.abs(world.ballX - WIDTH) < 1e-6, "幅が2倍になった分だけballXも比例して伸びる");
  assert.ok(Math.abs(world.patches[0].x - WIDTH / 2) < 1e-6, "パッチのx座標も同じ比率で伸びる");

  world.resize(0, 0);
  world.resize(-10, -10);
  assert.ok(world.width > 0 && world.height > 0, "不正なリサイズ値は無視される");
});

test("キーボード操作でボールが左右に動き、範囲外にはみ出さない", () => {
  const world = new PowderRushWorld(WIDTH, HEIGHT);
  const startX = world.ballX;

  world.setSteeringInput(-1);
  for (let i = 0; i < 30; i++) world.step(FRAME);
  assert.ok(world.ballX < startX, "左入力で左に動く");

  world.setSteeringInput(1);
  for (let i = 0; i < 600; i++) world.step(FRAME);
  assert.ok(world.ballX <= world.width - world.ballRadius + 1e-6, "右端を超えて画面外に出ない");
  assertFinite(world, "左右操作後");
});

test("ポインタ操作は目標座標へ追従し、離すとキーボード入力に戻る", () => {
  const world = new PowderRushWorld(WIDTH, HEIGHT);

  world.setPointerTarget(50);
  for (let i = 0; i < 120; i++) world.step(FRAME);
  assert.ok(Math.abs(world.ballX - 50) < 1, "ポインタの目標座標に十分近づく");

  world.setPointerTarget(null);
  world.setSteeringInput(1);
  for (let i = 0; i < 30; i++) world.step(FRAME);
  assert.ok(world.ballX > 50, "ポインタを離すとキーボード入力が効く");
});

test("プレイを長く続けてもアイテム配列が際限なく増え続けない", () => {
  const world = new PowderRushWorld(WIDTH, HEIGHT);

  let maxItemCount = 0;
  for (let i = 0; i < 1800 && !world.isOver; i++) {
    world.setSteeringInput(i % 90 < 45 ? -1 : 1);
    world.step(FRAME);
    maxItemCount = Math.max(maxItemCount, world.patches.length + world.obstacles.length);
  }

  assert.ok(maxItemCount < 25, "同時に存在するアイテム数が際限なく増え続けない");
  assertFinite(world, "長時間プレイ後");
});
