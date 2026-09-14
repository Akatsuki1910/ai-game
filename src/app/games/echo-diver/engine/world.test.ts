import assert from "node:assert/strict";
import { test } from "node:test";
import { EchoDiverWorld, MAX_CHARGES, PING_LIFETIME } from "./world.ts";

const WIDTH = 800;
const HEIGHT = 600;
const FRAME = 1 / 60;

function assertFinite(world: EchoDiverWorld, label: string): void {
  assert.ok(Number.isFinite(world.sub.x) && Number.isFinite(world.sub.y), `${label}: sub position`);
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  for (const rock of world.rocks) {
    assert.ok(Number.isFinite(rock.x) && Number.isFinite(rock.y), `${label}: rock position`);
  }
  for (const pearl of world.pearls) {
    assert.ok(Number.isFinite(pearl.x) && Number.isFinite(pearl.y), `${label}: pearl position`);
  }
  assert.ok(
    Number.isFinite(world.leviathan.x) && Number.isFinite(world.leviathan.y),
    `${label}: leviathan position`,
  );
}

test("起動直後に潜水艇・岩・真珠・レビヤタンが揃っている", () => {
  const world = new EchoDiverWorld(WIDTH, HEIGHT);

  assert.ok(world.rocks.length > 0, "岩が配置されている");
  assert.equal(world.pearls.length, 5, "真珠が5個配置されている");
  assert.equal(world.score, 0);
  assert.equal(world.pearlsCollected, 0);
  assert.equal(world.charges, MAX_CHARGES);
  assert.equal(world.isOver, false);
  assert.equal(world.sub.x, world.arenaSize / 2, "潜水艇は中央から始まる");
});

test("推進すると潜水艇が動き、ドラッグ(ポインタ)操作でも同様に動く", () => {
  const world = new EchoDiverWorld(WIDTH, HEIGHT);
  const start = { x: world.sub.x, y: world.sub.y };

  world.setThrust(1, 0);
  for (let i = 0; i < 30; i++) world.step(FRAME);
  assert.ok(world.sub.x > start.x, "キー入力相当の推進で右へ動く");

  world.setThrust(0, 0);
  world.reset();
  world.setThrustTowardStagePoint(world.offsetX + world.arenaSize, world.offsetY + world.sub.y);
  for (let i = 0; i < 30; i++) world.step(FRAME);
  assert.ok(world.sub.x > world.arenaSize / 2, "ポインタ方向への推進でも同様に動く");

  assertFinite(world, "移動後");
});

test("ソナーは充電がないと発信できず、時間経過で回復する", () => {
  const world = new EchoDiverWorld(WIDTH, HEIGHT);

  for (let i = 0; i < MAX_CHARGES; i++) {
    assert.equal(world.triggerPing(), true, `${i + 1}回目のソナーは発信できる`);
  }
  assert.equal(world.charges, 0, "充電を使い切った");
  assert.equal(world.triggerPing(), false, "充電切れでは発信できない");
  assert.equal(world.pings.length, MAX_CHARGES, "発信した数だけ音波が残っている");

  for (let i = 0; i < Math.ceil(PING_LIFETIME / FRAME) + 5; i++) world.step(FRAME);
  assert.equal(world.pings.length, 0, "余韻は寿命が来ると消える");

  for (let i = 0; i < 600; i++) world.step(FRAME);
  assert.ok(world.charges > 0, "時間経過で充電が回復する");
});

test("ソナーで照らした範囲は見え、照らしていない場所は見えない", () => {
  const world = new EchoDiverWorld(WIDTH, HEIGHT);
  const farX = world.arenaSize - 4;
  const farY = world.arenaSize - 4;

  assert.equal(world.visibilityAt(farX, farY), 0, "初期状態では遠くは見えない");

  world.triggerPing();
  for (let i = 0; i < 5; i++) world.step(FRAME);
  assert.ok(world.visibilityAt(world.sub.x, world.sub.y) > 0, "発信直後は自分の周囲が見える");
});

test("真珠を取ると得点が入り、別の場所に湧き直す", () => {
  const world = new EchoDiverWorld(WIDTH, HEIGHT);
  const pickedUp: number[] = [];
  world.onPearlCollected = ({ points }) => pickedUp.push(points);

  const pearl = world.pearls[0];
  const before = { x: pearl.x, y: pearl.y };
  world.sub.x = pearl.x;
  world.sub.y = pearl.y;

  world.step(FRAME);

  assert.equal(pickedUp.length, 1, "真珠を1つ取った");
  assert.ok(pickedUp[0] > 0, "得点が入っている");
  assert.equal(world.pearlsCollected, 1);
  assert.equal(world.pearls.length, 5, "真珠の総数は変わらない");
  assert.ok(
    Math.hypot(pearl.x - before.x, pearl.y - before.y) > 0.001,
    "取った真珠は別の場所に湧き直す",
  );
  assertFinite(world, "取得後");
});

test("レビヤタンに捕まるとラウンドが終わり、リセットで最初からやり直せる", () => {
  const world = new EchoDiverWorld(WIDTH, HEIGHT);

  world.leviathan.x = world.sub.x;
  world.leviathan.y = world.sub.y;
  world.step(FRAME);

  assert.equal(world.isOver, true, "接触するとラウンドが終わる");

  // 終了後に進めても壊れない
  const scoreAtOver = world.score;
  world.step(FRAME);
  assert.equal(world.score, scoreAtOver, "終了後はスコアが進まない");
  assertFinite(world, "終了後");

  world.reset();
  assert.equal(world.isOver, false);
  assert.equal(world.score, 0);
  assert.equal(world.charges, MAX_CHARGES);
});

test("画面サイズが変わっても盤面が画面内に収まる", () => {
  const world = new EchoDiverWorld(WIDTH, HEIGHT);

  world.resize(390, 780);
  assert.ok(world.sub.x >= 0 && world.sub.x <= world.arenaSize, "潜水艇が盤面内");
  for (const rock of world.rocks) {
    assert.ok(rock.x >= 0 && rock.x <= world.arenaSize, "岩が盤面内");
  }

  for (let i = 0; i < 120; i++) world.step(FRAME);
  assertFinite(world, "リサイズ後");
});
