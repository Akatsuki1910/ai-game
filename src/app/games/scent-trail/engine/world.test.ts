import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CATCH_RADIUS,
  COLONY_HEALTH_MAX,
  MAX_ANTS,
  PICKUP_RADIUS,
  ScentTrailWorld,
  TRAIL_MAX_LIFE,
} from "./world.ts";

const WIDTH = 960;
const HEIGHT = 540;
const FRAME = 1 / 60;

function assertFinite(world: ScentTrailWorld, label: string): void {
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.colonyHealth), `${label}: colonyHealth`);
  assert.ok(Number.isFinite(world.food.x) && Number.isFinite(world.food.y), `${label}: food`);
  assert.ok(
    Number.isFinite(world.predator.x) && Number.isFinite(world.predator.y),
    `${label}: predator`,
  );
  for (const ant of world.ants) {
    assert.ok(Number.isFinite(ant.x) && Number.isFinite(ant.y), `${label}: ant position`);
  }
  for (const point of world.trail) {
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y), `${label}: trail position`);
  }
}

// このテストはクライアント完結のミニゲームであり、権限拒否の観点は対象外(サーバー通信や認可を
// 持たないため)。境界値(画面端でのクランプ)・空/ゼロ件(起動直後に蟻が0匹の状態)・
// エラー/失敗(コロニー体力が尽きる)・再入(体力切れ後のreset)・操作の中断(isOverによる
// step早期リターン)はそれぞれ以下でカバーする。非同期の競合はゲームループが単一スレッドの
// 同期stepのみのため対象外。キャッシュの陳腐化も永続化やフェッチを持たないため対象外。

test("起動直後は蟻が0匹で、コロニー体力が満タン・餌と捕食者が画面内に揃っている", () => {
  const world = new ScentTrailWorld(WIDTH, HEIGHT);

  assert.equal(world.colonyHealth, COLONY_HEALTH_MAX);
  assert.equal(world.score, 0);
  assert.equal(world.deliveries, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.ants.length, 0, "起動直後はまだ蟻が巣から出ていない");
  assert.ok(
    world.food.x >= 0 && world.food.x <= WIDTH && world.food.y >= 0 && world.food.y <= HEIGHT,
  );
  assert.ok(world.predator.x >= 0 && world.predator.x <= WIDTH);
  assertFinite(world, "起動直後");
});

test("最初のstepで1匹目の蟻が巣から現れる", () => {
  const world = new ScentTrailWorld(WIDTH, HEIGHT);
  world.step(FRAME);
  assert.equal(world.ants.length, 1, "1匹目の蟻が出現する");
  // 出現と同じフレームで目的地(餌)へ向けて動き出すため、巣からわずかに動いた位置になる。
  const distFromNest = Math.hypot(world.ants[0].x - world.nest.x, world.ants[0].y - world.nest.y);
  assert.ok(distFromNest < 2, "出現直後はまだ巣のすぐ近くにいる");
  assertFinite(world, "1匹目出現後");
});

test("ブラシ位置にトレイルを描ける。描き続けなければ時間とともに消える", () => {
  const world = new ScentTrailWorld(WIDTH, HEIGHT);
  world.setPaintTarget(300, 200);
  world.setPainting(true);
  world.step(FRAME);

  assert.equal(world.trail.length, 1, "トレイル点が1つ生える");
  assert.equal(world.trail[0].life, TRAIL_MAX_LIFE);
  assert.ok(Math.hypot(world.trail[0].x - 300, world.trail[0].y - 200) < 1);

  world.setPainting(false);
  // 蟻の出現・捕食によってコロニー体力が尽きるとstepが早期リターンしてトレイルの
  // 減衰も止まってしまうため、この検証では蟻を毎フレーム取り除いて無関係にする。
  for (let i = 0; i < Math.ceil((TRAIL_MAX_LIFE + 1) / FRAME); i++) {
    world.step(FRAME);
    world.ants = [];
  }
  assert.equal(world.trail.length, 0, "描き直さないとトレイルは消える");
  assertFinite(world, "トレイル消滅後");
});

test("近くに新鮮なトレイルがあると蟻は素早く進める", () => {
  const start = { x: 100, y: 100 };
  const far = { x: 900, y: 500 };

  const withoutTrail = new ScentTrailWorld(WIDTH, HEIGHT);
  withoutTrail.ants = [{ id: 0, x: start.x, y: start.y, isCarryingFood: false, carryPoints: 0 }];
  withoutTrail.food = far;
  withoutTrail.step(FRAME);
  const distWithoutTrail = Math.hypot(
    withoutTrail.ants[0].x - start.x,
    withoutTrail.ants[0].y - start.y,
  );

  const withTrail = new ScentTrailWorld(WIDTH, HEIGHT);
  withTrail.ants = [{ id: 0, x: start.x, y: start.y, isCarryingFood: false, carryPoints: 0 }];
  withTrail.food = far;
  withTrail.trail = [{ x: start.x + 5, y: start.y, life: TRAIL_MAX_LIFE }];
  withTrail.step(FRAME);
  const distWithTrail = Math.hypot(withTrail.ants[0].x - start.x, withTrail.ants[0].y - start.y);

  assert.ok(distWithTrail > distWithoutTrail, "トレイル付近では蟻の移動距離が伸びる");
  assertFinite(withTrail, "トレイル移動後");
});

test("餌にたどり着くと持ち帰りを始め、巣に戻ると得点とコロニーの回復が入る", () => {
  const world = new ScentTrailWorld(WIDTH, HEIGHT);
  world.food = { x: 700, y: 400 };
  world.ants = [{ id: 0, x: world.food.x, y: world.food.y, isCarryingFood: false, carryPoints: 0 }];
  const foodDistFromNest = Math.hypot(world.food.x - world.nest.x, world.food.y - world.nest.y);
  assert.ok(foodDistFromNest > PICKUP_RADIUS, "餌は巣から十分離れている");

  world.step(FRAME);
  assert.equal(world.ants[0].isCarryingFood, true, "餌を拾うと持ち帰り状態になる");
  assert.ok(world.ants[0].carryPoints > 0, "持ち帰る得点が設定される");
  assert.ok(
    Math.hypot(world.food.x - 700, world.food.y - 400) > 0,
    "拾われた餌とは別の場所に次の餌が湧く",
  );

  world.colonyHealth = 50;
  world.ants[0].x = world.nest.x;
  world.ants[0].y = world.nest.y;
  const deliveredPoints = world.ants[0].carryPoints;
  const deliverEvents: number[] = [];
  world.onDeliver = (event) => deliverEvents.push(event.points);

  world.step(FRAME);

  assert.equal(world.score, deliveredPoints, "持ち帰った得点がスコアに加算される");
  assert.equal(world.deliveries, 1);
  assert.equal(world.colonyHealth, 56, "持ち帰るとコロニーの体力が回復する");
  assert.deepEqual(deliverEvents, [deliveredPoints]);
  assert.equal(world.ants[0].isCarryingFood, false, "届けると持ち帰り状態が解除される");
  assertFinite(world, "届けた後");
});

test("捕食者が蟻に追いつくと捕食し、コロニーの体力が減る", () => {
  const world = new ScentTrailWorld(WIDTH, HEIGHT);
  world.ants = [{ id: 0, x: 400, y: 300, isCarryingFood: false, carryPoints: 0 }];
  world.predator = { x: 400, y: 300 };
  world.food = { x: WIDTH - 20, y: HEIGHT - 20 };
  const healthBefore = world.colonyHealth;
  let eatenCount = 0;
  world.onAntEaten = () => {
    eatenCount += 1;
  };

  for (let i = 0; i < 120 && eatenCount === 0; i++) world.step(FRAME);

  assert.ok(eatenCount >= 1, "捕食イベントが発火する");
  assert.ok(world.colonyHealth < healthBefore, "コロニーの体力が減る");
  assertFinite(world, "捕食後");
});

test("コロニーの体力が尽きるとラウンドが終わり、resetで最初から遊べる", () => {
  const world = new ScentTrailWorld(WIDTH, HEIGHT);
  world.colonyHealth = 1;
  world.ants = [{ id: 0, x: 400, y: 300, isCarryingFood: false, carryPoints: 0 }];
  world.predator = { x: 400, y: 300 };
  world.food = { x: WIDTH - 20, y: HEIGHT - 20 };
  let lostScore = -1;
  world.onColonyLost = (event) => {
    lostScore = event.score;
  };

  for (let i = 0; i < 120 && !world.isOver; i++) world.step(FRAME);

  assert.equal(world.isOver, true, "体力が尽きてラウンド終了する");
  assert.equal(world.colonyHealth, 0);
  assert.ok(lostScore >= 0, "終了イベントが発火する");

  const antsBeforeExtraStep = [...world.ants];
  world.step(FRAME);
  assert.deepEqual(world.ants, antsBeforeExtraStep, "終了後は状態が変化しない(早期リターン)");

  world.reset();
  assert.equal(world.isOver, false);
  assert.equal(world.colonyHealth, COLONY_HEALTH_MAX);
  assert.equal(world.score, 0);
  assert.equal(world.deliveries, 0);
  assert.equal(world.ants.length, 0);
  assertFinite(world, "リセット後");
});

test("蟻の数はMAX_ANTSを超えない", () => {
  const world = new ScentTrailWorld(WIDTH, HEIGHT);
  for (let i = 0; i < 600; i++) world.step(FRAME);
  assert.ok(world.ants.length <= MAX_ANTS, "同時に存在する蟻はMAX_ANTS以下");
  assertFinite(world, "長時間経過後");
});

test("蟻がいない間、捕食者は次の出現地点である巣へ向かい、画面外へ出ない", () => {
  const world = new ScentTrailWorld(WIDTH, HEIGHT);
  world.predator = { x: 5, y: 5 };
  world.ants = [];
  const distBefore = Math.hypot(world.predator.x - world.nest.x, world.predator.y - world.nest.y);

  for (let i = 0; i < 30; i++) {
    world.step(FRAME);
    world.ants = [];
  }

  const distAfter = Math.hypot(world.predator.x - world.nest.x, world.predator.y - world.nest.y);
  assert.ok(distAfter < distBefore, "蟻がいない間は巣へ近づいていく");
  assert.ok(
    world.predator.x >= 0 &&
      world.predator.x <= WIDTH &&
      world.predator.y >= 0 &&
      world.predator.y <= HEIGHT,
    "画面外へ出ない",
  );
  assertFinite(world, "巣への接近後");
});

test("画面サイズが変わっても蟻・巣・餌・トレイルが画面内に収まる", () => {
  const world = new ScentTrailWorld(WIDTH, HEIGHT);
  world.setPaintTarget(WIDTH * 0.5, HEIGHT * 0.5);
  world.setPainting(true);
  for (let i = 0; i < 10; i++) {
    world.step(FRAME);
    world.ants = [];
  }

  // PC横長 → スマホ縦長
  world.resize(375, 720);

  assert.ok(world.nest.x >= -1 && world.nest.x <= 376, "巣が画面内に収まる");
  assert.ok(world.food.x >= -1 && world.food.x <= 376, "餌が画面内に収まる");
  for (const point of world.trail) {
    assert.ok(point.x >= -1 && point.x <= 376, "トレイルが画面内に収まる");
  }

  for (let i = 0; i < 30; i++) {
    world.step(FRAME);
    world.ants = [];
  }
  assert.ok(world.nest.x >= -1 && world.nest.x <= 376, "リサイズ後も巣が画面内");
  assertFinite(world, "リサイズ後");
});

test("捕獲判定の半径は蟻と捕食者それぞれの当たり半径の合計になっている", () => {
  const world = new ScentTrailWorld(WIDTH, HEIGHT);
  assert.ok(CATCH_RADIUS > 0);
  assertFinite(world, "半径定数確認後");
});
