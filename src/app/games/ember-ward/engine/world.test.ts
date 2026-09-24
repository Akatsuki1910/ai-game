import assert from "node:assert/strict";
import { test } from "node:test";
import { type Ember, EmberWardWorld, SHRINE_MAX_HP } from "./world.ts";

const WIDTH = 960;
const HEIGHT = 540;
const FRAME = 1 / 60;

function assertFinite(world: EmberWardWorld, label: string): void {
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.shrineHp), `${label}: shrineHp`);
  for (const ember of world.embers) {
    assert.ok(Number.isFinite(ember.x) && Number.isFinite(ember.y), `${label}: ember position`);
    assert.ok(Number.isFinite(ember.vx) && Number.isFinite(ember.vy), `${label}: ember velocity`);
  }
  for (const ward of world.wards) {
    assert.ok(
      [ward.x1, ward.y1, ward.x2, ward.y2].every(Number.isFinite),
      `${label}: ward position`,
    );
  }
}

/** 真下に落下するエンバーを直接1個差し込む(スポーンのランダム性を避けて狙った状況を作る)。 */
function pushFallingEmber(world: EmberWardWorld, x: number, y: number, vy = 120): Ember {
  const ember: Ember = { id: -1, x, y, vx: 0, vy, radius: 11, isWarded: false };
  world.embers.push(ember);
  return ember;
}

test("起動直後は社が満タンでエンバー・結界は存在しない", () => {
  const world = new EmberWardWorld(WIDTH, HEIGHT);

  assert.equal(world.shrineHp, SHRINE_MAX_HP);
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.embers.length, 0);
  assert.equal(world.wards.length, 0);
});

test("時間が経つとエンバーが自動的に湧く", () => {
  const world = new EmberWardWorld(WIDTH, HEIGHT);

  let spawned = false;
  for (let i = 0; i < 240 && !spawned; i++) {
    world.step(FRAME);
    if (world.embers.length > 0) spawned = true;
  }

  assert.ok(spawned, "4秒以内に少なくとも1個は湧く");
  assertFinite(world, "スポーン後");
});

test("短すぎるドラッグは結界にならず、十分な長さなら設置される", () => {
  const world = new EmberWardWorld(WIDTH, HEIGHT);

  assert.equal(world.addWard(100, 100, 105, 100), false, "短すぎる線は却下される");
  assert.equal(world.wards.length, 0);

  assert.equal(world.addWard(100, 100, 220, 100), true, "十分な長さの線は設置される");
  assert.equal(world.wards.length, 1);
});

test("結界は上限本数を超えると古いものから消える", () => {
  const world = new EmberWardWorld(WIDTH, HEIGHT);

  const ids: number[] = [];
  for (let i = 0; i < 6; i++) {
    world.addWard(50, 50 + i * 10, 200, 50 + i * 10);
    ids.push(world.wards[world.wards.length - 1].id);
  }

  assert.ok(world.wards.length <= 4, "同時に存在できる結界数には上限がある");
  assert.equal(
    world.wards[0].id,
    ids[ids.length - world.wards.length],
    "上限を超えたら最も古い結界から消える",
  );
});

test("結界は一定時間で自然に消える", () => {
  const world = new EmberWardWorld(WIDTH, HEIGHT);
  world.addWard(100, 100, 260, 100);
  assert.equal(world.wards.length, 1);

  for (let i = 0; i < 300; i++) world.step(FRAME);

  assert.equal(world.wards.length, 0, "TTLを超えたら消滅する");
});

test("落下するエンバーを結界で弾くと反射してスコア・コンボが増える", () => {
  const world = new EmberWardWorld(WIDTH, HEIGHT);
  world.addWard(WIDTH * 0.3, HEIGHT * 0.5, WIDTH * 0.7, HEIGHT * 0.5);
  const ember = pushFallingEmber(world, WIDTH * 0.5, HEIGHT * 0.5 - 5);

  const wardedEvents: number[] = [];
  world.onEmberWarded = (event) => wardedEvents.push(event.points);

  world.step(FRAME);

  assert.equal(wardedEvents.length, 1, "弾かれたイベントが1回発火する");
  assert.ok(ember.isWarded, "エンバーが弾かれた状態になる");
  assert.ok(ember.vy < 0, "下向きだった速度が上向きに反転する");
  assert.equal(world.combo, 1);
  assert.equal(world.score, wardedEvents[0]);
  assertFinite(world, "反射後");
});

test("連続で弾くほどコンボボーナスが増え、間隔が空くとコンボが切れる", () => {
  const world = new EmberWardWorld(WIDTH, HEIGHT);
  world.addWard(WIDTH * 0.3, HEIGHT * 0.5, WIDTH * 0.7, HEIGHT * 0.5);

  const points: number[] = [];
  world.onEmberWarded = (event) => points.push(event.points);

  pushFallingEmber(world, WIDTH * 0.4, HEIGHT * 0.5 - 5);
  world.step(FRAME);
  pushFallingEmber(world, WIDTH * 0.6, HEIGHT * 0.5 - 5);
  world.step(FRAME);

  assert.equal(points.length, 2);
  assert.ok(points[1] > points[0], "2連続目はコンボボーナスで得点が伸びる");
  assert.equal(world.combo, 2);

  // コンボ猶予時間を超えて何も弾かないと、コンボがリセットされる。
  for (let i = 0; i < 240; i++) world.step(FRAME);
  assert.equal(world.combo, 0, "一定時間弾けないとコンボが切れる");
});

test("結界がないままエンバーが社に届くとライフが減りコンボがリセットされる", () => {
  const world = new EmberWardWorld(WIDTH, HEIGHT);
  world.combo = 3;
  pushFallingEmber(world, WIDTH * 0.5, world.shrineLineY - 1);

  const hits: number[] = [];
  world.onShrineHit = (event) => hits.push(event.hpRemaining);

  world.step(FRAME);

  assert.equal(hits.length, 1);
  assert.equal(world.shrineHp, SHRINE_MAX_HP - 1);
  assert.equal(world.combo, 0, "被弾するとコンボが切れる");
  assert.equal(world.embers.length, 0, "社に届いたエンバーは消える");
});

test("社のライフが尽きるとゲームオーバーになり、以後は状態が固定される", () => {
  const world = new EmberWardWorld(WIDTH, HEIGHT);

  for (let i = 0; i < SHRINE_MAX_HP; i++) {
    pushFallingEmber(world, WIDTH * 0.5, world.shrineLineY - 1);
    world.step(FRAME);
  }

  assert.equal(world.shrineHp, 0);
  assert.equal(world.isOver, true);

  const scoreBefore = world.score;
  pushFallingEmber(world, WIDTH * 0.5, world.shrineLineY - 1);
  world.step(FRAME);
  assert.equal(world.score, scoreBefore, "ゲームオーバー後はstepしても進行しない");
  assertFinite(world, "ゲームオーバー後");
});

test("reset()で初期状態に戻る", () => {
  const world = new EmberWardWorld(WIDTH, HEIGHT);
  world.addWard(100, 100, 260, 100);
  for (let i = 0; i < SHRINE_MAX_HP; i++) {
    pushFallingEmber(world, WIDTH * 0.5, world.shrineLineY - 1);
    world.step(FRAME);
  }
  assert.equal(world.isOver, true);

  world.reset();

  assert.equal(world.isOver, false);
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.shrineHp, SHRINE_MAX_HP);
  assert.equal(world.embers.length, 0);
  assert.equal(world.wards.length, 0);
});

test("キーボードカーソルは画面内(社のラインより上)に収まる", () => {
  const world = new EmberWardWorld(WIDTH, HEIGHT);

  world.moveKeyboardCursor(-10, -10, 1);
  assert.ok(world.keyboardCursor.x >= 0 && world.keyboardCursor.x <= WIDTH);
  assert.ok(world.keyboardCursor.y >= 0 && world.keyboardCursor.y < world.shrineLineY);

  world.moveKeyboardCursor(10, 10, 1);
  assert.ok(world.keyboardCursor.x <= WIDTH);
  assert.ok(world.keyboardCursor.y < world.shrineLineY, "社のラインより下には置けない");
});

test("キーボードでカーソル位置に結界を設置できる", () => {
  const world = new EmberWardWorld(WIDTH, HEIGHT);
  world.keyboardCursor = { x: WIDTH / 2, y: HEIGHT / 2 };

  assert.equal(world.placeKeyboardWard(), true);
  assert.equal(world.wards.length, 1);
  assert.equal(world.wards[0].y1, HEIGHT / 2);
});

test("画面サイズが変わってもエンバー・結界・カーソルが比率を保って収まる", () => {
  const world = new EmberWardWorld(WIDTH, HEIGHT);
  world.addWard(WIDTH * 0.3, HEIGHT * 0.4, WIDTH * 0.6, HEIGHT * 0.4);
  pushFallingEmber(world, WIDTH * 0.5, HEIGHT * 0.5);

  world.resize(375, 720);

  assert.ok(world.embers[0].x >= 0 && world.embers[0].x <= 375);
  assert.ok(world.wards[0].x1 >= 0 && world.wards[0].x1 <= 375);
  assertFinite(world, "リサイズ後");

  for (let i = 0; i < 60; i++) world.step(FRAME);
  assertFinite(world, "リサイズ後に進行しても壊れない");
});
