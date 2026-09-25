import assert from "node:assert/strict";
import { test } from "node:test";
import { ThermalGliderWorld } from "./world.ts";

const WIDTH = 480;
const HEIGHT = 720;
const FRAME = 1 / 60;

function assertFinite(world: ThermalGliderWorld, label: string): void {
  assert.ok(Number.isFinite(world.gliderX), `${label}: gliderX`);
  assert.ok(Number.isFinite(world.altitude), `${label}: altitude`);
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.distanceTraveled), `${label}: distanceTraveled`);
  for (const thermal of world.thermals) {
    assert.ok(
      Number.isFinite(thermal.x) && Number.isFinite(thermal.z),
      `${label}: thermal position`,
    );
  }
  for (const bird of world.birds) {
    assert.ok(
      Number.isFinite(bird.x) && Number.isFinite(bird.z) && Number.isFinite(bird.altitude),
      `${label}: bird position`,
    );
  }
}

test("起動直後は初期高度70・スコア0・アイテムなしで中央に始まる", () => {
  const world = new ThermalGliderWorld(WIDTH, HEIGHT);

  assert.equal(world.gliderX, WIDTH / 2);
  assert.equal(world.altitude, 70);
  assert.equal(world.score, 0);
  assert.equal(world.streak, 0);
  assert.equal(world.distanceTraveled, 0);
  assert.equal(world.thermals.length, 0);
  assert.equal(world.birds.length, 0);
  assert.equal(world.isOver, false);
  assertFinite(world, "起動直後");
});

test("無操作でも時間経過とともに距離とスコアが進み、高度は沈降で下がる", () => {
  const world = new ThermalGliderWorld(WIDTH, HEIGHT);

  for (let i = 0; i < 60; i++) world.step(FRAME);

  assert.ok(world.distanceTraveled > 0, "距離が進む");
  assert.ok(world.score > 0, "距離に応じてスコアが入る");
  assert.ok(world.altitude < 70, "沈降で高度が下がる");
  assertFinite(world, "1秒経過後");
});

test("時間経過とともにサーマルまたは鳥が自動的にスポーンされる", () => {
  const world = new ThermalGliderWorld(WIDTH, HEIGHT);

  for (let i = 0; i < 300 && world.thermals.length + world.birds.length === 0; i++) {
    world.step(FRAME);
  }

  assert.ok(world.thermals.length + world.birds.length > 0, "5秒以内に何かスポーンする");
  assertFinite(world, "スポーン直後");
});

test("サーマルに入ると捕捉イベントが1回だけ発火しスコア/ストリーク/高度が増える", () => {
  const world = new ThermalGliderWorld(WIDTH, HEIGHT);
  const events: Array<{ x: number; points: number; streak: number }> = [];
  world.onThermalCaught = (event) => events.push(event);
  world.thermals.push({ id: 999_001, x: world.gliderX, z: world.distanceTraveled });

  world.step(FRAME);

  assert.equal(world.thermals.length, 1, "サーマルは通過し終えるまで消えずに残る");
  assert.equal(world.streak, 1);
  assert.equal(events.length, 1, "初めて入った瞬間だけ捕捉イベントが発火する");
  assert.ok(events[0].points > 0);
  // 高度ボーナス(+6)は1回だけ加算され、その後は通常の沈降(自然減少)だけが効く。
  assert.ok(Math.abs(world.altitude - (70 + 6 - 3 * FRAME)) < 1e-6, "高度ボーナス分だけ増える");
  assertFinite(world, "サーマル進入直後");

  world.step(FRAME);
  assert.equal(events.length, 1, "同じサーマルに乗り続けても再発火せず、高度ボーナスも増えない");
});

test("サーマルの奥行きを通り過ぎるとワールドから取り除かれる", () => {
  const world = new ThermalGliderWorld(WIDTH, HEIGHT);
  world.thermals.push({ id: 999_002, x: world.gliderX, z: world.distanceTraveled });

  for (let i = 0; i < 600 && world.thermals.length > 0; i++) world.step(FRAME);

  assert.equal(world.thermals.length, 0, "通過し終えたサーマルは消える");
  assertFinite(world, "サーマル通過後");
});

test("同じ高度・位置の鳥に当たると高度が減りストリークが途切れる", () => {
  const world = new ThermalGliderWorld(WIDTH, HEIGHT);
  world.streak = 3;
  const events: Array<{ x: number; altitude: number }> = [];
  world.onBirdHit = (event) => events.push(event);
  world.birds.push({
    id: 999_003,
    x: world.gliderX,
    z: world.distanceTraveled,
    altitude: world.altitude,
  });

  world.step(FRAME);

  assert.equal(world.birds.length, 0, "解決された鳥はワールドから取り除かれる");
  assert.ok(
    Math.abs(world.altitude - (70 - 18 - 3 * FRAME)) < 1e-6,
    "70 - ダメージ18 - 自然沈降 まで下がる",
  );
  assert.equal(world.streak, 0);
  assert.equal(events.length, 1);
  assert.equal(world.isOver, false, "墜落する高度にはまだ達していない");
  assertFinite(world, "鳥衝突後");
});

test("高度が離れている鳥はすれ違っても衝突しない", () => {
  const world = new ThermalGliderWorld(WIDTH, HEIGHT);
  const events: Array<{ x: number; altitude: number }> = [];
  world.onBirdHit = (event) => events.push(event);
  world.birds.push({
    id: 999_004,
    x: world.gliderX,
    z: world.distanceTraveled,
    altitude: 5,
  });

  for (let i = 0; i < 600 && world.birds.length > 0; i++) world.step(FRAME);

  assert.equal(events.length, 0, "高度が合わなければ衝突判定は発火しない");
});

test("高度が0以下になると墜落してゲームオーバーになり、以後は状態が変化しない", () => {
  const world = new ThermalGliderWorld(WIDTH, HEIGHT);
  world.altitude = 15; // 15 - 18 = -3 <= 墜落閾値(0)
  let crashed: { distance: number; score: number } | null = null;
  world.onCrashed = (event) => {
    crashed = event;
  };
  world.birds.push({
    id: 999_005,
    x: world.gliderX,
    z: world.distanceTraveled,
    altitude: world.altitude,
  });

  world.step(FRAME);

  assert.equal(world.isOver, true);
  assert.equal(world.altitude, 0);
  assert.ok(crashed !== null, "墜落イベントが発火する");
  assertFinite(world, "墜落直後");

  const frozenScore = world.score;
  const frozenDistance = world.distanceTraveled;
  const frozenGliderX = world.gliderX;

  world.setSteeringInput(1);
  world.setClimbInput(1);
  world.step(FRAME);

  assert.equal(world.score, frozenScore, "終了後はスコアが変化しない");
  assert.equal(world.distanceTraveled, frozenDistance, "終了後は距離も進まない");
  assert.equal(world.gliderX, frozenGliderX, "終了後は操作しても位置が変わらない");
});

test("何も操作せず放置しても、沈降だけでいずれ墜落してゲームオーバーになる", () => {
  const world = new ThermalGliderWorld(WIDTH, HEIGHT);
  let crashed: { distance: number; score: number } | null = null;
  world.onCrashed = (event) => {
    crashed = event;
  };

  // 沈降(3/秒)は平均的なサーマル捕捉による上昇ボーナスより大きいため長期的には必ず墜落するが、
  // 静止したグライダーが偶然サーマルを連続で拾う運が続くと理論上の平均墜落時間(約35〜40秒)を
  // 大きく超えることがあるため、乱数のブレを十分吸収できるだけの時間(100秒)まで許容する。
  for (let i = 0; i < 6000 && !world.isOver; i++) world.step(FRAME);

  assert.equal(world.isOver, true, "無操作でも沈降だけでいずれ必ず墜落する");
  assert.ok(crashed !== null, "墜落イベントが発火する");
  assertFinite(world, "放置による墜落後");
});

test("上昇入力を入れ続けると、無操作より高度の減りが緩やかになる", () => {
  const passive = new ThermalGliderWorld(WIDTH, HEIGHT);
  const climbing = new ThermalGliderWorld(WIDTH, HEIGHT);
  climbing.setClimbInput(1);

  for (let i = 0; i < 60; i++) {
    passive.step(FRAME);
    climbing.step(FRAME);
  }

  assert.ok(climbing.altitude > passive.altitude, "上昇入力で沈降が相殺され高度がより高く保たれる");
});

test("reset() で高度・スコア・距離・アイテムが初期状態に戻る", () => {
  const world = new ThermalGliderWorld(WIDTH, HEIGHT);
  world.setSteeringInput(1);
  for (let i = 0; i < 300; i++) world.step(FRAME);
  assert.ok(world.distanceTraveled > 0, "前提: プレイが進んでいる");

  world.reset();

  assert.equal(world.gliderX, WIDTH / 2);
  assert.equal(world.altitude, 70);
  assert.equal(world.score, 0);
  assert.equal(world.streak, 0);
  assert.equal(world.distanceTraveled, 0);
  assert.equal(world.thermals.length, 0);
  assert.equal(world.birds.length, 0);
  assert.equal(world.isOver, false);
});

test("画面サイズが変わってもグライダーとアイテムのx座標は比例して追従し、高度は影響されない。不正なサイズは無視される", () => {
  const world = new ThermalGliderWorld(WIDTH, HEIGHT);
  world.thermals.push({ id: 999_006, x: WIDTH / 4, z: 100 });
  world.altitude = 42;

  world.resize(WIDTH * 2, HEIGHT * 2);

  assert.ok(Math.abs(world.gliderX - WIDTH) < 1e-6, "幅が2倍になった分だけgliderXも比例して伸びる");
  assert.ok(Math.abs(world.thermals[0].x - WIDTH / 2) < 1e-6, "サーマルのx座標も同じ比率で伸びる");
  assert.equal(world.altitude, 42, "高度はリサイズの影響を受けない");

  world.resize(0, 0);
  world.resize(-10, -10);
  assert.ok(world.width > 0 && world.height > 0, "不正なリサイズ値は無視される");
});

test("キーボード操作でグライダーが左右に動き、範囲外にはみ出さない", () => {
  const world = new ThermalGliderWorld(WIDTH, HEIGHT);
  const startX = world.gliderX;

  world.setSteeringInput(-1);
  for (let i = 0; i < 30; i++) world.step(FRAME);
  assert.ok(world.gliderX < startX, "左入力で左に動く");

  world.setSteeringInput(1);
  for (let i = 0; i < 600; i++) world.step(FRAME);
  assert.ok(world.gliderX <= world.width + 1e-6, "右端を超えて画面外に出ない");
  assertFinite(world, "左右操作後");
});

test("ポインタ操作は目標座標へ追従し、離すとキーボード入力に戻る", () => {
  const world = new ThermalGliderWorld(WIDTH, HEIGHT);

  world.setPointerTarget(50);
  for (let i = 0; i < 120; i++) world.step(FRAME);
  assert.ok(Math.abs(world.gliderX - 50) < 1, "ポインタの目標座標に十分近づく");

  world.setPointerTarget(null);
  world.setSteeringInput(1);
  for (let i = 0; i < 30; i++) world.step(FRAME);
  assert.ok(world.gliderX > 50, "ポインタを離すとキーボード入力が効く");
});

test("プレイを長く続けてもアイテム配列が際限なく増え続けない", () => {
  const world = new ThermalGliderWorld(WIDTH, HEIGHT);
  world.setClimbInput(0.5);

  let maxItemCount = 0;
  for (let i = 0; i < 1800 && !world.isOver; i++) {
    world.setSteeringInput(i % 90 < 45 ? -1 : 1);
    world.step(FRAME);
    maxItemCount = Math.max(maxItemCount, world.thermals.length + world.birds.length);
  }

  assert.ok(maxItemCount < 25, "同時に存在するアイテム数が際限なく増え続けない");
  assertFinite(world, "長時間プレイ後");
});
