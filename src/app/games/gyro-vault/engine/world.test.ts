import assert from "node:assert/strict";
import { test } from "node:test";
import { GyroVaultWorld, ROUND_SECONDS } from "./world.ts";

const WIDTH = 960;
const HEIGHT = 540;
const FRAME = 1 / 60;
const NO_TILT = { x: 0, y: 0 } as const;

function assertFinite(world: GyroVaultWorld, label: string): void {
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.timeRemaining), `${label}: timeRemaining`);
  assert.ok(Number.isFinite(world.ball.x) && Number.isFinite(world.ball.y), `${label}: ball位置`);
  assert.ok(Number.isFinite(world.ball.vx) && Number.isFinite(world.ball.vy), `${label}: ball速度`);
}

test("起動直後にボール・壁・穴・ゴールが盤面内に揃っている", () => {
  const world = new GyroVaultWorld(WIDTH, HEIGHT);

  assert.equal(world.score, 0);
  assert.equal(world.timeRemaining, ROUND_SECONDS);
  assert.equal(world.isOver, false);
  assert.equal(world.goalCount, 0);
  assert.equal(world.fallCount, 0);
  assert.ok(world.walls.length > 0, "壁が配置されている");
  assert.ok(world.holes.length > 0, "穴が配置されている");
  assert.ok(world.ball.x >= 0 && world.ball.x <= WIDTH, "ボールが盤面内");
  assert.ok(world.ball.y >= 0 && world.ball.y <= HEIGHT, "ボールが盤面内");
  assert.ok(world.goal.x > world.ball.x, "ゴールはスタートより奥にある");
});

test("傾けるとボールが加速し、離すと摩擦で減速する", () => {
  const world = new GyroVaultWorld(WIDTH, HEIGHT);
  const startX = world.ball.x;

  for (let i = 0; i < 30; i++) world.step(FRAME, { x: 1, y: 0 });
  assert.ok(world.ball.vx > 0, "右に傾け続けると右向きの速度がつく");
  assert.ok(world.ball.x > startX, "ボールが右へ進む");

  const speedAtRelease = world.ball.vx;
  for (let i = 0; i < 30; i++) world.step(FRAME, NO_TILT);
  assert.ok(world.ball.vx < speedAtRelease, "手を離すと摩擦で減速する");
});

test("傾き入力は最大1に正規化される（斜め入力で加速しすぎない）", () => {
  const straight = new GyroVaultWorld(WIDTH, HEIGHT);
  const diagonal = new GyroVaultWorld(WIDTH, HEIGHT);

  for (let i = 0; i < 10; i++) {
    straight.step(FRAME, { x: 1, y: 0 });
    diagonal.step(FRAME, { x: 5, y: 5 });
  }

  const straightSpeed = Math.hypot(straight.ball.vx, straight.ball.vy);
  const diagonalSpeed = Math.hypot(diagonal.ball.vx, diagonal.ball.vy);
  assert.ok(
    diagonalSpeed <= straightSpeed + 1e-6,
    "巨大な斜め入力でも最大速度は正規化された1方向入力を超えない",
  );
});

test("壁にめり込むと押し戻され、速度が反転する", () => {
  const world = new GyroVaultWorld(WIDTH, HEIGHT);
  const wall = world.walls[0];

  world.ball.x = wall.x - 5; // 壁に5px重なる位置に強制的に置く
  world.ball.y = wall.y + wall.height / 2;
  world.ball.vx = 40;
  world.ball.vy = 0;

  world.step(FRAME, NO_TILT);

  assert.ok(world.ball.x <= wall.x - world.ball.radius + 0.01, "壁の外側まで押し戻される");
  assert.ok(world.ball.vx <= 0, "壁にぶつかった向きの速度が反転する");
  assertFinite(world, "壁衝突後");
});

test("タブ復帰直後のような大きなdeltaSecondsでも、高速なボールが薄い壁をすり抜けない", () => {
  const world = new GyroVaultWorld(WIDTH, HEIGHT);
  const wall = world.walls[0];

  // 壁の少し手前に、1フレームで壁の厚みを飛び越えられるほどの高速を与えて置く
  world.ball.x = wall.x - world.ball.radius - 2;
  world.ball.y = wall.y + wall.height / 2;
  world.ball.vx = (wall.width + world.ball.radius * 2 + 20) / 0.1; // 0.1秒で壁+余白ぶん進む速度
  world.ball.vy = 0;

  // GameLoopのmaxDeltaSeconds既定値(0.1秒)ぶんをまとめて1回で渡す
  world.step(0.1, NO_TILT);

  assert.ok(
    world.ball.x <= wall.x - world.ball.radius + 0.01,
    "大きなdeltaSecondsでも壁の手前で止まる（すり抜けない）",
  );
  assertFinite(world, "高速衝突後");
});

test("穴に落ちると直前の安全地点へ戻され、時間ペナルティを受ける", () => {
  const world = new GyroVaultWorld(WIDTH, HEIGHT);
  const spawnX = world.ball.x;
  const spawnY = world.ball.y;
  const hole = world.holes[0];
  const timeBeforeFall = world.timeRemaining;

  const fallEvents: number[] = [];
  world.onFall = (event) => fallEvents.push(event.penaltySeconds);

  world.ball.x = hole.x;
  world.ball.y = hole.y;
  world.ball.vx = 0;
  world.ball.vy = 0;

  world.step(FRAME, NO_TILT);

  assert.equal(world.fallCount, 1, "落下回数が増える");
  assert.equal(fallEvents.length, 1, "落下イベントが1回発火する");
  assert.equal(world.ball.x, spawnX, "スタート地点へ戻る");
  assert.equal(world.ball.y, spawnY, "スタート地点へ戻る");
  assert.ok(world.timeRemaining < timeBeforeFall - 1, "時間ペナルティを受ける");
  assertFinite(world, "落下後");
});

test("チェックポイントを踏むと、その後の落下復帰地点が更新される", () => {
  const world = new GyroVaultWorld(WIDTH, HEIGHT);
  const checkpoint = world.checkpoint;
  const hole = world.holes[0];

  // チェックポイントの真上へボールを運んで踏ませる
  world.ball.x = checkpoint.x;
  world.ball.y = checkpoint.y;
  world.ball.vx = 0;
  world.ball.vy = 0;
  world.step(FRAME, NO_TILT);

  // その後、穴に落ちる
  world.ball.x = hole.x;
  world.ball.y = hole.y;
  world.ball.vx = 0;
  world.ball.vy = 0;
  world.step(FRAME, NO_TILT);

  assert.equal(world.ball.x, checkpoint.x, "チェックポイントへ復帰する");
  assert.equal(world.ball.y, checkpoint.y, "チェックポイントへ復帰する");
});

test("ゴールへ到達すると得点・時間ボーナスが入り、次の盤面へ進む", () => {
  const world = new GyroVaultWorld(WIDTH, HEIGHT);
  const goal = world.goal;
  const layoutBefore = world.layoutIndex;
  const timeBefore = world.timeRemaining;

  const completed: number[] = [];
  world.onGoalReached = (event) => completed.push(event.points);

  world.ball.x = goal.x;
  world.ball.y = goal.y;
  world.ball.vx = 0;
  world.ball.vy = 0;
  world.step(FRAME, NO_TILT);

  assert.equal(world.goalCount, 1, "クリア数が増える");
  assert.equal(completed.length, 1, "ゴールイベントが1回発火する");
  assert.equal(world.score, completed[0], "得点が加算される");
  assert.ok(world.timeRemaining > timeBefore - FRAME, "時間ボーナスで残り時間が増える");
  assert.notEqual(world.layoutIndex, layoutBefore, "次の盤面レイアウトへ進む");
  assert.ok(world.difficulty > 1, "難易度が上がる");
  assertFinite(world, "ゴール後");
});

test("制限時間が尽きるとラウンドが終わり、リセットで最初から遊べる", () => {
  const world = new GyroVaultWorld(WIDTH, HEIGHT);

  for (let i = 0; i < 1000 && !world.isOver; i++) {
    world.step(0.1, { x: 0.3, y: 0.1 });
    assertFinite(world, "ラウンド中");
  }

  assert.equal(world.isOver, true, "ラウンドが終了する");
  assert.equal(world.timeRemaining, 0);

  // 終了後に進めても壊れない
  world.step(FRAME, { x: 1, y: 1 });
  assertFinite(world, "ラウンド終了後");

  world.reset();
  assert.equal(world.isOver, false);
  assert.equal(world.score, 0);
  assert.equal(world.timeRemaining, ROUND_SECONDS);
  assert.equal(world.layoutIndex, 0);
  assert.equal(world.goalCount, 0);
  assert.equal(world.fallCount, 0);
});

test("画面サイズが変わっても盤面要素が画面内に収まる", () => {
  const world = new GyroVaultWorld(WIDTH, HEIGHT);

  // PC横長 → スマホ縦長
  world.resize(390, 780);

  assert.ok(world.ball.x >= -1 && world.ball.x <= 391, "ボールが画面内");
  assert.ok(world.ball.y >= -1 && world.ball.y <= 781, "ボールが画面内");
  assert.ok(world.goal.x >= 0 && world.goal.x <= 390, "ゴールが画面内");
  assert.ok(world.checkpoint.x >= 0 && world.checkpoint.x <= 390, "チェックポイントが画面内");
  for (const wall of world.walls) {
    assert.ok(wall.x >= -1 && wall.x + wall.width <= 391, "壁が画面内");
  }
  for (const hole of world.holes) {
    assert.ok(hole.x >= 0 && hole.x <= 390, "穴が画面内");
  }

  for (let i = 0; i < 60; i++) world.step(FRAME, { x: 0.5, y: 0.2 });
  assertFinite(world, "リサイズ後");
});
