import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clipConvexPolygon,
  computeIoU,
  convexHull,
  PITCH_LIMIT_RADIANS,
  type Point2D,
  polygonArea,
  UmbraTurnWorld,
  wrapAngle,
} from "./world.ts";

const FRAME = 1 / 60;

function squareAt(x: number, z: number, size: number): Point2D[] {
  return [
    { x, z },
    { x: x + size, z },
    { x: x + size, z: z + size },
    { x, z: z + size },
  ];
}

function assertFinite(world: UmbraTurnWorld, label: string): void {
  assert.ok(Number.isFinite(world.yaw), `${label}: yaw`);
  assert.ok(Number.isFinite(world.pitch), `${label}: pitch`);
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.timeRemaining), `${label}: timeRemaining`);
  assert.ok(Number.isFinite(world.holdProgress), `${label}: holdProgress`);
  assert.ok(Number.isFinite(world.matchQuality), `${label}: matchQuality`);
}

test("wrapAngle は -π〜π に正規化する", () => {
  assert.ok(Math.abs(wrapAngle(Math.PI * 3) - Math.PI) < 1e-9);
  assert.ok(Math.abs(wrapAngle(-Math.PI * 3) + Math.PI) < 1e-9);
  assert.ok(Math.abs(wrapAngle(0.5) - 0.5) < 1e-9);
});

test("convexHull: 内部の点は除外され、外周の点だけが反時計回りで残る", () => {
  const square = squareAt(0, 0, 2);
  const hull = convexHull([...square, { x: 1, z: 1 }]);

  assert.equal(hull.length, 4, "内部点は凸包に含まれない");
  assert.ok(Math.abs(polygonArea(hull) - 4) < 1e-9);
});

test("convexHull: 重複点・2点以下は例外を投げずそのまま返す", () => {
  assert.deepEqual(convexHull([]), []);
  assert.deepEqual(convexHull([{ x: 0, z: 0 }]), [{ x: 0, z: 0 }]);
  const deduped = convexHull([
    { x: 0, z: 0 },
    { x: 0, z: 0 },
    { x: 1, z: 1 },
  ]);
  assert.equal(deduped.length, 2, "重複点は除去される");
});

test("polygonArea: 3点未満は0、単位正方形は1", () => {
  assert.equal(polygonArea([]), 0);
  assert.equal(polygonArea([{ x: 0, z: 0 }]), 0);
  assert.ok(Math.abs(polygonArea(squareAt(0, 0, 1)) - 1) < 1e-9);
});

test("clipConvexPolygon: 完全に重なる正方形の交差領域は同じ面積になる", () => {
  const square = squareAt(0, 0, 2);
  const intersection = clipConvexPolygon(square, square);
  assert.ok(Math.abs(polygonArea(intersection) - 4) < 1e-9);
});

test("clipConvexPolygon: 重ならない正方形の交差領域は空になる", () => {
  const a = squareAt(0, 0, 1);
  const b = squareAt(10, 10, 1);
  assert.equal(clipConvexPolygon(a, b).length, 0);
});

test("computeIoU: 完全一致で1、無関係で0、半分重なりで1/3になる", () => {
  const square = squareAt(0, 0, 1);
  assert.ok(Math.abs(computeIoU(square, square) - 1) < 1e-9);

  const farAway = squareAt(100, 100, 1);
  assert.equal(computeIoU(square, farAway), 0);

  // 単位正方形をx方向に0.5だけずらすと、重なり0.5 / 和集合1.5 = 1/3 になる定番の検算値。
  const shifted = squareAt(0.5, 0, 1);
  assert.ok(Math.abs(computeIoU(square, shifted) - 1 / 3) < 1e-9);
});

test("computeIoU: 面積0の多角形は常に0を返す(ゼロ除算しない)", () => {
  const degenerate: Point2D[] = [{ x: 0, z: 0 }];
  const square = squareAt(0, 0, 1);
  assert.equal(computeIoU(degenerate, square), 0);
  assert.equal(computeIoU(square, degenerate), 0);
});

test("初期状態はラウンド1・ライフ3・スコア0で、目標の姿勢とは異なる姿勢から始まる", () => {
  const world = new UmbraTurnWorld(() => 0.5);

  assert.equal(world.round, 1);
  assert.equal(world.lives, 3);
  assert.equal(world.score, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.holdProgress, 0);
  assert.ok(world.timeRemaining > 0);
  assert.notEqual(world.yaw, world.targetYaw, "お題と同じ姿勢からは始まらない");
  assertFinite(world, "初期状態");
});

test("rotateBy: yawは±πに正規化され、pitchは可動範囲でクランプされる", () => {
  const world = new UmbraTurnWorld(() => 0.5);
  world.yaw = 0;
  world.pitch = 0;

  world.rotateBy(Math.PI * 2 + 0.2, 0);
  assert.ok(Math.abs(world.yaw - 0.2) < 1e-9, "yawは一周してもほぼ同じ角度になる");

  world.pitch = 0;
  world.rotateBy(0, PITCH_LIMIT_RADIANS * 10);
  assert.ok(Math.abs(world.pitch - PITCH_LIMIT_RADIANS) < 1e-9, "pitchは可動範囲でクランプされる");

  world.rotateBy(0, -PITCH_LIMIT_RADIANS * 10);
  assert.ok(Math.abs(world.pitch + PITCH_LIMIT_RADIANS) < 1e-9);
});

test("目標の姿勢に重ねて保持し続けるとラウンドがロックされ、スコアが増えて次のラウンドに進む", () => {
  const world = new UmbraTurnWorld(() => 0.5);
  const lockedEvents: Array<{ round: number; score: number }> = [];
  world.onRoundLocked = (event) => lockedEvents.push(event);

  world.yaw = world.targetYaw;
  world.pitch = world.targetPitch;

  let stepsNeeded = 0;
  for (; stepsNeeded < 600 && world.round === 1; stepsNeeded++) {
    world.step(FRAME);
    // 姿勢を保ったまま毎フレーム検証する(値を書き戻すのは、worldがclampした結果を次フレームの
    // 入力にも反映させるため)。
    world.yaw = world.targetYaw;
    world.pitch = world.targetPitch;
  }

  assert.equal(lockedEvents.length, 1, "一致を保持し続けるとロックイベントが1回発火する");
  assert.equal(world.round, 2, "ロックすると次のラウンドに進む");
  assert.ok(world.score > 0, "ロックでスコアが増える");
  assert.ok(stepsNeeded < 600, "既定の保持時間以内にロックされる");
  assertFinite(world, "ロック直後");
});

test("一致しないまま制限時間が尽きるとライフが減り、ライフが0になるとゲームオーバーになる", () => {
  const world = new UmbraTurnWorld(() => 0.5);
  const failedEvents: Array<{ round: number; livesRemaining: number }> = [];
  let gameOver: { round: number; score: number } | null = null;
  world.onRoundFailed = (event) => failedEvents.push(event);
  world.onGameOver = (event) => {
    gameOver = event;
  };

  // yaw/pitchは初期値(お題とは異なる姿勢)のまま一切操作しない。
  for (let i = 0; i < 60 * 60 && !world.isOver; i++) world.step(FRAME);

  assert.equal(world.isOver, true, "操作しなければ必ずタイムアウトでゲームオーバーになる");
  assert.equal(failedEvents.length, 3, "ライフ3を使い切るまで失敗イベントが発火する");
  assert.equal(world.lives, 0);
  assert.ok(gameOver !== null, "ゲームオーバーイベントが発火する");
  assertFinite(world, "ゲームオーバー直後");

  const frozenScore = world.score;
  const frozenYaw = world.yaw;
  world.rotateBy(1, 1);
  world.step(FRAME);
  assert.equal(world.score, frozenScore, "終了後はスコアが変化しない");
  assert.equal(world.yaw, frozenYaw, "終了後は操作しても姿勢が変化しない");
});

test("reset() でラウンド・ライフ・スコアが初期状態に戻る", () => {
  const world = new UmbraTurnWorld(() => 0.5);
  for (let i = 0; i < 60 * 60 && !world.isOver; i++) world.step(FRAME);
  assert.equal(world.isOver, true, "前提: ゲームオーバーになっている");

  world.reset();

  assert.equal(world.round, 1);
  assert.equal(world.lives, 3);
  assert.equal(world.score, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.holdProgress, 0);
});

test("ラウンドが進むほど制限時間は短く、一致判定の閾値は厳しくなる", () => {
  const world = new UmbraTurnWorld(() => 0.5);
  world.onRoundLocked = () => {};
  const firstRoundTime = world.timeRemaining;
  const firstRoundThreshold = world.matchThreshold;

  world.yaw = world.targetYaw;
  world.pitch = world.targetPitch;
  for (let i = 0; i < 600 && world.round === 1; i++) {
    world.step(FRAME);
    world.yaw = world.targetYaw;
    world.pitch = world.targetPitch;
  }
  assert.equal(world.round, 2, "前提: 2ラウンド目に進んでいる");

  assert.ok(
    world.timeRemaining <= firstRoundTime,
    "ラウンドが進むと制限時間が短くなる(か同じ下限)",
  );
  assert.ok(
    world.matchThreshold >= firstRoundThreshold,
    "ラウンドが進むと一致判定の閾値が厳しくなる(か同じ上限)",
  );
});

test("ランダムな回転操作を続けても値が発散しない", () => {
  const world = new UmbraTurnWorld(Math.random);
  for (let i = 0; i < 3000; i++) {
    world.rotateBy((Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3);
    world.step(FRAME);
    if (world.isOver) world.reset();
  }
  assertFinite(world, "長時間のランダム操作後");
});
