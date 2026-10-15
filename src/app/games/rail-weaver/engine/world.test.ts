import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_SPEED,
  MIN_SPAWN_INTERVAL,
  PLANK_STOCK_MAX,
  RailWeaverWorld,
  REACH_DISTANCE,
  SPAWN_DISTANCE_AHEAD,
} from "./world.ts";

const FRAME = 1 / 60;

/** predicateが真になるまで、実際のフレーム相当のdtで進める。真になれなければfalseを返す。 */
function stepUntil(
  world: RailWeaverWorld,
  predicate: (world: RailWeaverWorld) => boolean,
  maxSteps = 2000,
): boolean {
  for (let i = 0; i < maxSteps; i++) {
    if (predicate(world)) return true;
    world.step(FRAME);
  }
  return predicate(world);
}

test("初期状態はギャップ無し・スコア0・板は満タン", () => {
  const world = new RailWeaverWorld();

  assert.equal(world.gaps.length, 0);
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.plankStock, PLANK_STOCK_MAX);
  assert.equal(world.distance, 0);
  assert.equal(world.isOver, false);
});

test("時間経過でギャップが前方(SPAWN_DISTANCE_AHEAD)に現れる", () => {
  const world = new RailWeaverWorld();
  const appeared = stepUntil(world, (w) => w.gaps.length > 0, 200);

  assert.ok(appeared, "一定時間内にギャップが現れる");
  assert.equal(world.gaps.length, 1);
  assert.equal(world.gaps[0].distanceAhead, SPAWN_DISTANCE_AHEAD);
  assert.equal(world.gaps[0].isFilled, false);
});

test("前進するほどギャップがカートに近づく", () => {
  const world = new RailWeaverWorld();
  stepUntil(world, (w) => w.gaps.length > 0, 200);
  const before = world.gaps[0].distanceAhead;

  world.step(FRAME);

  assert.ok(world.gaps[0].distanceAhead < before, "距離が縮む");
});

test("補修圏内に入る前はnextLayableGapがnullを返し、layPlankは何もしない", () => {
  const world = new RailWeaverWorld();
  stepUntil(world, (w) => w.gaps.length > 0, 200);

  assert.equal(world.nextLayableGap(), null, "まだ遠いので対象外");
  const result = world.layPlank();

  assert.equal(result, "no-target");
  assert.equal(world.score, 0);
  assert.equal(world.plankStock, PLANK_STOCK_MAX, "対象が無い操作では板を消費しない");
});

test("補修圏内に入ると板を渡せて加点・コンボが伸び、板を1本消費する", () => {
  const world = new RailWeaverWorld();
  const inReach = stepUntil(world, (w) => w.nextLayableGap() !== null, 400);
  assert.ok(inReach, "一定時間内に補修圏内に入る");
  const target = world.nextLayableGap();
  const targetId = target?.id;

  const result = world.layPlank();

  assert.equal(result, "filled");
  assert.equal(world.score, 100);
  assert.equal(world.combo, 1);
  assert.equal(world.plankStock, PLANK_STOCK_MAX - 1);
  assert.equal(world.gaps.find((gap) => gap.id === targetId)?.isFilled, true);
});

test("連続で補修するとコンボボーナスが積み重なる", () => {
  const world = new RailWeaverWorld();
  let fills = 0;

  for (let i = 0; i < 2000 && fills < 2; i++) {
    if (world.nextLayableGap()) {
      world.layPlank();
      fills++;
      continue;
    }
    world.step(FRAME);
  }

  assert.equal(fills, 2, "2本補修できた");
  assert.equal(world.score, 100 + (100 + 10), "2本目はコンボ1本分のボーナスが乗る");
});

test("板の在庫が0のときはlayPlankが補修せず、在庫も減らない", () => {
  const world = new RailWeaverWorld();
  const inReach = stepUntil(world, (w) => w.nextLayableGap() !== null, 400);
  assert.ok(inReach);
  world.plankStock = 0;
  const target = world.nextLayableGap();
  const targetId = target?.id;
  assert.ok(target, "補修圏内にギャップがある");

  const result = world.layPlank();

  assert.equal(result, "no-stock");
  assert.equal(world.plankStock, 0, "在庫が無い状態からは減らない(マイナスにならない)");
  assert.equal(world.gaps.find((gap) => gap.id === targetId)?.isFilled, false);
});

test("時間が経てば板の在庫は上限まで回復する", () => {
  const world = new RailWeaverWorld();
  world.plankStock = 0;

  // 2秒進める: 補修放置によるクラッシュ(約4秒超かかる)よりは十分に短い。
  for (let i = 0; i < 120; i++) world.step(FRAME);

  assert.ok(world.plankStock >= 1, "一定時間経てば少なくとも1本回復する");
  assert.equal(world.isOver, false, "この程度の時間では落ちない");
});

test("未補修のギャップがカートに到達するとゲームオーバーになり、以降は状態が変化しない", () => {
  const world = new RailWeaverWorld();
  let crashed = false;
  world.onCrash = () => {
    crashed = true;
  };

  const over = stepUntil(world, (w) => w.isOver, 900);

  assert.ok(over, "何もしなければいずれゲームオーバーになる");
  assert.ok(crashed, "onCrashが発火する");

  const scoreBefore = world.score;
  const stockBefore = world.plankStock;
  world.step(1);
  assert.equal(world.score, scoreBefore, "ゲームオーバー後はstepしても状態が変わらない");
  assert.equal(world.plankStock, stockBefore);
  assert.equal(world.layPlank(), "no-target", "ゲームオーバー後の操作は常に無効");
});

test("reset()で最初の状態に戻る", () => {
  const world = new RailWeaverWorld();
  stepUntil(world, (w) => w.nextLayableGap() !== null, 400);
  world.layPlank();

  world.reset();

  assert.equal(world.gaps.length, 0);
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.plankStock, PLANK_STOCK_MAX);
  assert.equal(world.distance, 0);
  assert.equal(world.isOver, false);
});

test("前進した距離に応じて速度が上がり、出現間隔が短くなる", () => {
  const world = new RailWeaverWorld();
  const initialSpeed = world.speed;
  const initialSpawnInterval = world.spawnInterval;

  // ウォームアップ中(まだギャップが出現しない)だけ進めれば、クラッシュの心配なく距離を積める。
  for (let i = 0; i < 60; i++) world.step(FRAME);

  assert.equal(world.gaps.length, 0, "この程度の時間ではまだギャップは出現しない");
  assert.ok(world.distance > 0, "距離が進んでいる");
  assert.ok(world.speed > initialSpeed, "速度が上がる");
  assert.ok(world.spawnInterval < initialSpawnInterval, "出現間隔が短くなる");
});

test("速度には上限、出現間隔には下限がある", () => {
  const world = new RailWeaverWorld();
  world.distance = 1_000_000;

  assert.equal(world.speed, MAX_SPEED);
  assert.equal(world.spawnInterval, MIN_SPAWN_INTERVAL);
});

test("カートを通過した補修済みギャップは、いつまでも残らずに取り除かれる", () => {
  const world = new RailWeaverWorld();
  stepUntil(world, (w) => w.nextLayableGap() !== null, 400);
  const target = world.nextLayableGap();
  const filledId = target?.id;
  assert.ok(target, "補修圏内にギャップがある");
  world.layPlank();

  for (let i = 0; i < 300 && !world.isOver; i++) world.step(FRAME);

  assert.equal(
    world.gaps.some((gap) => gap.id === filledId),
    false,
    "通過した補修済みギャップは配列から取り除かれる",
  );
});

test("補修圏内の距離(REACH_DISTANCE)より遠いギャップは対象にならない", () => {
  const world = new RailWeaverWorld();
  stepUntil(world, (w) => w.gaps.length > 0, 200);
  const gap = world.gaps[0];
  assert.ok(gap.distanceAhead > REACH_DISTANCE, "出現直後は補修圏外");
  assert.equal(world.nextLayableGap(), null);
});
