import assert from "node:assert/strict";
import { test } from "node:test";
import { PEG_COUNT, ROUND_SECONDS, RotorDropWorld } from "./world.ts";

const WIDTH = 480;
const HEIGHT = 720;
const FRAME = 1 / 60;

function assertFinite(world: RotorDropWorld, label: string): void {
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.rotationAngle), `${label}: rotationAngle`);
  for (const marble of world.marbles) {
    assert.ok(Number.isFinite(marble.x) && Number.isFinite(marble.y), `${label}: marble position`);
    assert.ok(
      Number.isFinite(marble.vx) && Number.isFinite(marble.vy),
      `${label}: marble velocity`,
    );
  }
}

test("起動直後は残り時間いっぱい・スコア0・マーブルなしで始まる", () => {
  const world = new RotorDropWorld(WIDTH, HEIGHT);

  assert.equal(world.timeRemaining, ROUND_SECONDS);
  assert.equal(world.score, 0);
  assert.equal(world.marbles.length, 0);
  assert.equal(world.marblesCollected, 0);
  assert.equal(world.marblesMissed, 0);
  assert.equal(world.totalSpawned, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.getPegPositions().length, PEG_COUNT);
  assertFinite(world, "起動直後");
});

test("時間経過とともにマーブルが自動的にスポーンされる", () => {
  const world = new RotorDropWorld(WIDTH, HEIGHT);

  for (let i = 0; i < 180 && world.totalSpawned === 0; i++) world.step(FRAME);

  assert.ok(world.totalSpawned > 0, "3秒以内に少なくとも1個はスポーンする");
  assert.ok(world.marbles.length > 0, "スポーンしたマーブルがワールドに存在する");
  assertFinite(world, "スポーン直後");
});

test("回転入力を与えるとリングの釘の絶対座標が変わる", () => {
  const world = new RotorDropWorld(WIDTH, HEIGHT);
  const before = world.getPegPositions();

  world.setRotationInput(1);
  for (let i = 0; i < 30; i++) world.step(FRAME);

  const after = world.getPegPositions();
  assert.notEqual(world.rotationAngle, 0, "回転角が進んでいる");
  assert.ok(
    before.some((peg, i) => Math.abs(peg.x - after[i].x) > 1 || Math.abs(peg.y - after[i].y) > 1),
    "釘の座標が回転前後で変化している",
  );
  assertFinite(world, "回転後");
});

test("釘に衝突したマーブルは弾かれ、素通りせず速度が変化する", () => {
  const world = new RotorDropWorld(WIDTH, HEIGHT);
  const peg = world.getPegPositions()[0];
  // 釘のすぐ上、まっすぐ落ちればぶつかる位置に自前でマーブルを配置する。
  world.marbles.push({ id: 999_001, x: peg.x, y: peg.y - 18, vx: 0, vy: 200, spawnedAt: 0 });

  world.step(FRAME);

  const marble = world.marbles.find((m) => m.id === 999_001);
  assert.ok(marble, "衝突後もマーブル自体は存在する(即ゴール/ハズレ扱いになる高さではない)");
  if (!marble) return;
  assert.notEqual(
    marble.vy,
    200 + 640 * FRAME,
    "釘との衝突で鉛直速度がそのままの自由落下から変化する",
  );
  const distFromPeg = Math.hypot(marble.x - peg.x, marble.y - peg.y);
  assert.ok(distFromPeg >= 8 + 13 - 0.01, "衝突後は釘とマーブルがめり込んでいない");
  assertFinite(world, "釘衝突後");
});

test("ゴール範囲でマーブルが下端に達すると回収され、スコアとコンボが増える", () => {
  const world = new RotorDropWorld(WIDTH, HEIGHT);
  const resolved: Array<{ isCollected: boolean; points: number }> = [];
  world.onMarbleResolved = (event) => resolved.push(event);

  world.marbles.push({
    id: 999_002,
    x: world.centerX,
    y: world.exitY + 9,
    vx: 0,
    vy: 10,
    spawnedAt: 0,
  });

  world.step(FRAME);

  assert.equal(world.marbles.length, 0, "解決されたマーブルはワールドから取り除かれる");
  assert.equal(world.marblesCollected, 1);
  assert.equal(world.marblesMissed, 0);
  assert.equal(world.combo, 1);
  assert.ok(world.score > 0, "得点が入る");
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].isCollected, true);
  assert.ok(resolved[0].points > 0);
});

test("ゴール範囲を外れたマーブルが下端に達するとハズレになり、コンボが途切れる", () => {
  const world = new RotorDropWorld(WIDTH, HEIGHT);
  world.marbles.push({
    id: 999_003,
    x: world.centerX,
    y: world.exitY + 9,
    vx: 0,
    vy: 10,
    spawnedAt: 0,
  });
  world.step(FRAME);
  assert.equal(world.combo, 1, "前提: 一度ゴールしてコンボを1にしておく");

  world.marbles.push({
    id: 999_004,
    x: world.width - 4,
    y: world.exitY + 9,
    vx: 0,
    vy: 10,
    spawnedAt: 0,
  });
  const scoreBeforeMiss = world.score;
  world.step(FRAME);

  assert.equal(world.marblesMissed, 1, "ゴール範囲外で下端に達したマーブルはハズレになる");
  assert.equal(world.combo, 0, "ハズレるとコンボが途切れる");
  assert.equal(world.score, scoreBeforeMiss, "ハズレでは加点されない");
});

test("釘の間で長時間解決されないマーブルは安全弁でハズレとして強制解決される", () => {
  const world = new RotorDropWorld(WIDTH, HEIGHT);
  // exitYよりずっと手前かつ、釘から十分離れた位置に置き、スポーンからの経過だけで
  // タイムアウトさせる(通常はここまで動かなければ自然には解決されない状況を模す)。
  world.marbles.push({
    id: 999_005,
    x: world.centerX,
    y: world.centerY,
    vx: 0,
    vy: 0,
    spawnedAt: -1000,
  });

  world.step(FRAME);

  assert.equal(world.marbles.length, 0, "タイムアウトしたマーブルは強制的に取り除かれる");
  assert.equal(world.marblesMissed, 1, "タイムアウトはハズレ扱いになる");
});

test("制限時間が尽きるとゲームが終了し、以後は状態が変化しない", () => {
  const world = new RotorDropWorld(WIDTH, HEIGHT);
  world.timeRemaining = FRAME / 2;

  world.step(FRAME);

  assert.equal(world.isOver, true);
  assertFinite(world, "終了直後");

  const frozenScore = world.score;
  const frozenRotation = world.rotationAngle;
  const frozenMarbleCount = world.marbles.length;

  world.setRotationInput(1);
  world.step(FRAME);

  assert.equal(world.score, frozenScore, "終了後はスコアが変化しない");
  assert.equal(world.rotationAngle, frozenRotation, "終了後は回転も止まる");
  assert.equal(world.marbles.length, frozenMarbleCount, "終了後はマーブル数も変化しない");
});

test("reset() でスコア・マーブル・残り時間などが初期状態に戻る", () => {
  const world = new RotorDropWorld(WIDTH, HEIGHT);
  world.setRotationInput(1);
  for (let i = 0; i < 300; i++) world.step(FRAME);
  assert.ok(world.totalSpawned > 0, "前提: プレイが進んでいる");

  world.reset();

  assert.equal(world.timeRemaining, ROUND_SECONDS);
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.marbles.length, 0);
  assert.equal(world.marblesCollected, 0);
  assert.equal(world.marblesMissed, 0);
  assert.equal(world.totalSpawned, 0);
  assert.equal(world.rotationAngle, 0);
  assert.equal(world.isOver, false);
});

test("画面サイズが変わってもマーブル位置は比例して追従し、不正なサイズは無視される", () => {
  const world = new RotorDropWorld(WIDTH, HEIGHT);
  world.marbles.push({ id: 999_006, x: WIDTH / 2, y: HEIGHT / 4, vx: 0, vy: 0, spawnedAt: 0 });

  world.resize(WIDTH * 2, HEIGHT * 2);

  const marble = world.marbles[0];
  assert.ok(Math.abs(marble.x - WIDTH) < 1e-6, "幅が2倍になった分だけx座標も比例して伸びる");
  assert.ok(Math.abs(marble.y - HEIGHT / 2) < 1e-6, "高さが2倍になった分だけy座標も比例して伸びる");

  world.resize(0, 0);
  world.resize(-10, -10);
  assert.ok(world.width > 0 && world.height > 0, "不正なリサイズ値は無視される");
});

test("ラウンドを最後まで走らせてもマーブル配列が際限なく増え続けない", () => {
  const world = new RotorDropWorld(WIDTH, HEIGHT);

  let maxMarbleCount = 0;
  for (let i = 0; i < Math.ceil(ROUND_SECONDS / FRAME) + 10 && !world.isOver; i++) {
    world.setRotationInput(i % 90 < 45 ? -1 : 1);
    world.step(FRAME);
    maxMarbleCount = Math.max(maxMarbleCount, world.marbles.length);
  }

  assert.equal(world.isOver, true, "制限時間いっぱいでラウンドが終了する");
  assert.ok(world.totalSpawned > 10, "ラウンド中に十分な数のマーブルがスポーンしている");
  assert.ok(maxMarbleCount < 30, "同時に存在するマーブル数が際限なく増え続けない");
  // 終了の瞬間だけ、まだ空中にあるマーブルは回収/ハズレのどちらにも確定していない。
  // それ以外はすべてどちらかに解決され、配列に溜まり続けたりしない。
  assert.equal(
    world.marblesCollected + world.marblesMissed + world.marbles.length,
    world.totalSpawned,
    "スポーンした分は、回収/ハズレ確定済みか終了時点でまだ空中のどちらかで数が合う",
  );
  assertFinite(world, "ラウンド終了時");
});
