import assert from "node:assert/strict";
import { test } from "node:test";
import { DandelionGaleWorld, MAX_RAINDROPS, SEED_RADIUS, STARTING_LIVES } from "./world.ts";

const WIDTH = 960;
const HEIGHT = 540;
const FRAME = 1 / 60;
const FAN_OFFSET = 40;

function assertFinite(world: DandelionGaleWorld, label: string): void {
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.seed.x) && Number.isFinite(world.seed.y), `${label}: seed`);
  assert.ok(
    Number.isFinite(world.seed.vx) && Number.isFinite(world.seed.vy),
    `${label}: seed velocity`,
  );
  assert.ok(Number.isFinite(world.target.x) && Number.isFinite(world.target.y), `${label}: target`);
  for (const raindrop of world.raindrops) {
    assert.ok(Number.isFinite(raindrop.x) && Number.isFinite(raindrop.y), `${label}: raindrop`);
  }
}

/** 毎フレーム狙点を読み直し、種の反対側にファンを置いて狙点へ吹き寄せ続ける。 */
function steerSeedToward(
  world: DandelionGaleWorld,
  getAimPoint: () => { x: number; y: number },
  seconds: number,
): void {
  for (let elapsed = 0; elapsed < seconds && !world.isOver; elapsed += FRAME) {
    const aim = getAimPoint();
    const dx = aim.x - world.seed.x;
    const dy = aim.y - world.seed.y;
    const dist = Math.hypot(dx, dy) || 1;
    world.setFanPosition(
      world.seed.x - (dx / dist) * FAN_OFFSET,
      world.seed.y - (dy / dist) * FAN_OFFSET,
    );
    world.setFanActive(true);
    world.step(FRAME);
  }
}

// このテストはクライアント完結のミニゲームであり、権限拒否・キャッシュの陳腐化の観点は対象外
// （サーバー通信や認可を持たないため）。境界値(画面端でのバウンド)・空/ゼロ件(ラウンド開始直後の
// 未達成状態)・エラー/失敗(雨粒衝突)・再入(ゲームオーバー後のreset)・操作の中断(一時停止相当は
// isOverによるstep早期リターンで代替検証)は以下でカバーする。非同期の競合はゲームループが単一
// スレッドの同期stepのみのため対象外。

test("起動直後に種・花畑・雨粒が画面内に揃っている", () => {
  const world = new DandelionGaleWorld(WIDTH, HEIGHT);

  assert.ok(world.seed.x >= 0 && world.seed.x <= WIDTH, "種が画面内");
  assert.ok(world.seed.y >= 0 && world.seed.y <= HEIGHT, "種が画面内");
  assert.ok(world.target.radius > 0, "花畑が存在する");
  assert.ok(world.target.x >= 0 && world.target.x <= WIDTH, "花畑が画面内");
  assert.equal(world.raindrops.length, MAX_RAINDROPS, "雨粒の枠は最大数ぶん確保されている");
  assert.ok(
    world.raindrops.filter((r) => r.isActive).length >= 1,
    "少なくとも1つは雨粒が降り始めている",
  );
  assert.equal(world.lives, STARTING_LIVES);
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.fan.isActive, false);
  assertFinite(world, "起動直後");
});

test("何も操作しなくても重力とアンビエント風で種の位置が変化する", () => {
  const world = new DandelionGaleWorld(WIDTH, HEIGHT);
  const before = { x: world.seed.x, y: world.seed.y };

  for (let i = 0; i < 30; i++) world.step(FRAME);

  const moved = Math.hypot(world.seed.x - before.x, world.seed.y - before.y) > 0.01;
  assert.ok(moved, "無操作でも重力で種が動く");
  assertFinite(world, "無操作後");
});

test("ファンを有効にすると種はファンから遠ざかる方向へ押される", () => {
  const world = new DandelionGaleWorld(WIDTH, HEIGHT);
  world.seed = { x: WIDTH / 2, y: HEIGHT / 2, vx: 0, vy: 0 };
  world.setFanPosition(WIDTH / 2 - 30, HEIGHT / 2);
  world.setFanActive(true);

  const distBefore = Math.hypot(world.seed.x - world.fan.x, world.seed.y - world.fan.y);
  for (let i = 0; i < 10; i++) world.step(FRAME);
  const distAfter = Math.hypot(world.seed.x - world.fan.x, world.seed.y - world.fan.y);

  assert.ok(distAfter > distBefore, "ファンの位置から遠ざかっている");
  assertFinite(world, "送風後");
});

test("花畑へ種を届け続けると得点が入りコンボが進み、次の花畑が現れる", () => {
  const world = new DandelionGaleWorld(WIDTH, HEIGHT);
  const planted: number[] = [];
  world.onSeedPlanted = ({ points }) => planted.push(points);
  const firstTarget = { ...world.target };

  steerSeedToward(world, () => world.target, 8);

  assert.ok(planted.length >= 1, "少なくとも1回は花畑に届く");
  assert.ok(planted[0] > 0, "得点が入っている");
  assert.ok(
    world.target.x !== firstTarget.x || world.target.y !== firstTarget.y,
    "届けると次の花畑へ切り替わる",
  );
  assertFinite(world, "花畑到達後");
});

test("雨粒に当たるとライフが減りコンボがリセットされ、種は出発点へ戻る", () => {
  const world = new DandelionGaleWorld(WIDTH, HEIGHT);
  world.combo = 3;
  const popped: number[] = [];
  world.onSeedPopped = ({ livesRemaining }) => popped.push(livesRemaining);

  steerSeedToward(world, () => world.raindrops[0], 8);

  assert.ok(popped.length >= 1, "雨粒に当たってポップする");
  assert.equal(world.lives, STARTING_LIVES - popped.length);
  assert.equal(world.combo, 0, "コンボがリセットされる");
  assertFinite(world, "雨粒衝突後");
});

test(`ライフが${STARTING_LIVES}回尽きるとラウンドが終わり、resetで最初から遊べる`, () => {
  const world = new DandelionGaleWorld(WIDTH, HEIGHT);

  for (let attempt = 0; attempt < STARTING_LIVES && !world.isOver; attempt++) {
    steerSeedToward(world, () => world.raindrops[0], 8);
  }

  assert.equal(world.isOver, true, "ライフが尽きてラウンド終了する");
  assert.equal(world.lives, 0);

  // 終了後にstepしても壊れない(早期リターン)
  const seedBeforeExtraStep = { ...world.seed };
  world.step(FRAME);
  assert.deepEqual(world.seed, seedBeforeExtraStep, "終了後は状態が変化しない");

  world.reset();
  assert.equal(world.isOver, false);
  assert.equal(world.lives, STARTING_LIVES);
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assertFinite(world, "リセット後");
});

test("画面端で種がバウンスし、外にはみ出さない", () => {
  const world = new DandelionGaleWorld(WIDTH, HEIGHT);
  world.seed = { x: SEED_RADIUS - 5, y: HEIGHT / 2, vx: -50, vy: 0 };

  world.step(FRAME);

  assert.ok(world.seed.x >= 0, "左端を突き抜けない");
  assert.ok(world.seed.vx >= 0, "反射して右向きの速度になる");
  assertFinite(world, "バウンド後");
});

test("画面サイズが変わっても種・花畑・雨粒が画面内に収まる", () => {
  const world = new DandelionGaleWorld(WIDTH, HEIGHT);
  world.setFanPosition(WIDTH * 0.9, HEIGHT * 0.9);

  // PC横長 → スマホ縦長
  world.resize(375, 720);

  assert.ok(world.seed.x >= -1 && world.seed.x <= 376, "種が画面内に収まる");
  assert.ok(world.seed.y >= -1 && world.seed.y <= 721, "種が画面内に収まる");
  assert.ok(world.target.x >= -1 && world.target.x <= 376, "花畑が画面内に収まる");

  for (let i = 0; i < 60; i++) world.step(FRAME);
  assert.ok(world.seed.x >= -1 && world.seed.x <= 376, "リサイズ後も種が画面内");
  assert.ok(world.seed.y >= -1 && world.seed.y <= 721, "リサイズ後も種が画面内");
  assertFinite(world, "リサイズ後");
});
