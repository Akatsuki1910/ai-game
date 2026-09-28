import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AugerDropWorld,
  CURIOUS_RADIUS,
  EDGE_MARGIN,
  FISH_COUNT,
  POINTS,
  REEL_PROGRESS_MAX,
  TENSION_MAX,
  WARMTH_MAX,
} from "./world.ts";

const WIDTH = 960;
const HEIGHT = 540;
const FRAME = 1 / 60;

function assertFinite(world: AugerDropWorld, label: string): void {
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.warmth), `${label}: warmth`);
  assert.ok(Number.isFinite(world.tension), `${label}: tension`);
  assert.ok(Number.isFinite(world.reelProgress), `${label}: reelProgress`);
  assert.ok(
    Number.isFinite(world.lure.x) && Number.isFinite(world.lure.y),
    `${label}: lure position`,
  );
  for (const f of world.fish) {
    assert.ok(Number.isFinite(f.x) && Number.isFinite(f.y), `${label}: fish position`);
    assert.ok(Number.isFinite(f.interest), `${label}: fish interest`);
  }
}

/** 掛かっていない状態の魚1匹を、ルアーのすぐそばに興味満タンで置いて即座に食いつかせる。 */
function forceHook(world: AugerDropWorld, kind: "small" | "big" = "small"): void {
  world.fish[0] = {
    x: world.lure.x,
    y: world.lure.y,
    vx: 0,
    vy: 0,
    wanderAngle: 0,
    kind,
    interest: 100,
  };
  world.step(FRAME);
  assert.equal(world.hookedIndex, 0, "食いつきが成立している前提");
}

// このテストはクライアント完結のミニゲームであり、権限拒否・非同期の競合の観点は対象外
// (サーバー通信や認可、並行処理を持たないため)。境界値(画面端・湖の水面より上に出ない)・
// 空/ゼロ件(開始直後の未捕獲状態)・エラー/失敗(テンション超過による糸切れ)・
// 再入(ゲームオーバー後のreset)・操作の中断(isOverによるstep早期リターン)は
// それぞれ以下でカバーする。キャッシュの陳腐化は該当する非同期データ取得がないため対象外。

test("開始直後は穴の下にルアーがあり、暖かさが満タンで規定数の魚が水中にいる", () => {
  const world = new AugerDropWorld(WIDTH, HEIGHT);

  assert.equal(world.warmth, WARMTH_MAX);
  assert.equal(world.score, 0);
  assert.equal(world.catches, 0);
  assert.equal(world.hookedIndex, null);
  assert.equal(world.isOver, false);
  assert.equal(world.fish.length, FISH_COUNT);
  assert.ok(world.lure.y > world.hole.y, "ルアーは穴より下(水中)から始まる");
  for (const f of world.fish) {
    assert.ok(f.y > world.hole.y, "魚は氷の下(水中)にいる");
    assert.ok(f.x >= 0 && f.x <= WIDTH, "魚が画面内にいる");
  }
  assertFinite(world, "起動直後");
});

test("ルアーを素早く動かし続けると(ジグ)、近くの魚の興味はただ近くにいるだけより速く上がる", () => {
  const jiggingWorld = new AugerDropWorld(WIDTH, HEIGHT);
  jiggingWorld.fish[0] = {
    x: jiggingWorld.lure.x + 50,
    y: jiggingWorld.lure.y,
    vx: 0,
    vy: 0,
    wanderAngle: 0,
    kind: "small",
    interest: 0,
  };
  for (let i = 0; i < 20; i++) {
    jiggingWorld.lure.vx = 200; // JIG判定の速さしきい値を明確に超える値を毎フレーム与え続ける
    jiggingWorld.lure.vy = 0;
    jiggingWorld.step(FRAME);
  }

  const idleWorld = new AugerDropWorld(WIDTH, HEIGHT);
  idleWorld.fish[0] = {
    x: idleWorld.lure.x + 50,
    y: idleWorld.lure.y,
    vx: 0,
    vy: 0,
    wanderAngle: 0,
    kind: "small",
    interest: 0,
  };
  for (let i = 0; i < 20; i++) {
    idleWorld.step(FRAME);
  }

  assert.ok(
    jiggingWorld.fish[0].interest > idleWorld.fish[0].interest,
    "ジグの方が興味の上昇が速い",
  );
  assert.ok(idleWorld.fish[0].interest > 0, "近くにいるだけでも興味はわずかに上がる");
  assertFinite(jiggingWorld, "ジグ中");
  assertFinite(idleWorld, "待機中");
});

test("しきい値を超える速さで誘い続けると興味が満ちて食いつき、onBiteが発火する", () => {
  const world = new AugerDropWorld(WIDTH, HEIGHT);
  world.fish[0] = {
    x: world.lure.x + 50,
    y: world.lure.y,
    vx: 0,
    vy: 0,
    wanderAngle: 0,
    kind: "small",
    interest: 0,
  };
  let biteCount = 0;
  world.onBite = () => {
    biteCount += 1;
  };

  for (let i = 0; i < 180 && world.hookedIndex === null; i++) {
    // 毎フレーム魚のすぐそばへポインタを引き戻しつつ(=ドラッグ操作の近似)、
    // 速さだけをしきい値超えに保つ。位置を固定しないと1フレームごとの
    // 速度による移動が積み重なり、しきい値との速さ判定より先にCURIOUS_RADIUSの
    // 外まで漂ってしまう。
    world.lure.x = world.fish[0].x - 50;
    world.lure.y = world.fish[0].y;
    world.lure.vx = 200;
    world.lure.vy = 0;
    world.step(FRAME);
  }

  assert.equal(biteCount, 1, "食いつきイベントが1回発火する");
  assert.equal(world.hookedIndex, 0);
  assertFinite(world, "食いつき後");
});

test("興味は遠く離れると時間とともに減衰する", () => {
  const world = new AugerDropWorld(WIDTH, HEIGHT);
  world.fish[0] = {
    x: world.lure.x + CURIOUS_RADIUS * 3,
    y: world.lure.y,
    vx: 0,
    vy: 0,
    wanderAngle: 0,
    kind: "small",
    interest: 60,
  };

  for (let i = 0; i < 30; i++) world.step(FRAME);

  assert.ok(world.fish[0].interest < 60, "遠くにいると興味が下がる");
  assertFinite(world, "減衰後");
});

test("食いついた魚を長押しでリールし続けると釣り上げに成功し、スコアと釣果、暖かさが増える", () => {
  const world = new AugerDropWorld(WIDTH, HEIGHT);
  forceHook(world, "small");
  const warmthAfterBite = world.warmth;
  let caught: { kind: string; points: number } | null = null;
  world.onCatch = (event) => {
    caught = event;
  };
  world.setHolding(true);

  for (let i = 0; i < 300 && world.hookedIndex !== null; i++) world.step(FRAME);

  assert.notEqual(caught, null, "釣り上げイベントが発火する");
  assert.equal(world.hookedIndex, null, "釣り上げ後はフックが外れる");
  assert.equal(world.catches, 1);
  assert.equal(world.score, POINTS.small);
  assert.ok(world.warmth > warmthAfterBite, "釣り上げると暖かさが回復する");
  assert.equal(world.tension, 0);
  assert.equal(world.reelProgress, 0);
  assertFinite(world, "釣り上げ後");
});

test("大物を長押しし続けるとテンションが上限に達して糸が切れ、魚を逃して暖かさも減る", () => {
  const world = new AugerDropWorld(WIDTH, HEIGHT);
  forceHook(world, "big");
  const warmthAfterBite = world.warmth;
  let lostCount = 0;
  let caughtCount = 0;
  world.onLost = () => {
    lostCount += 1;
  };
  world.onCatch = () => {
    caughtCount += 1;
  };
  world.setHolding(true);

  for (let i = 0; i < 300 && world.hookedIndex !== null; i++) world.step(FRAME);

  assert.equal(lostCount, 1, "糸切れイベントが発火する");
  assert.equal(caughtCount, 0, "釣り上げには成功していない");
  assert.equal(world.hookedIndex, null);
  assert.ok(world.warmth < warmthAfterBite, "糸切れで暖かさが減る");
  assert.equal(world.tension, 0);
  assertFinite(world, "糸切れ後");
});

test("テンションが上限に近づいたら手を緩めることを繰り返せば、大物でも粘って釣り上げられる", () => {
  const world = new AugerDropWorld(WIDTH, HEIGHT);
  forceHook(world, "big");
  let lostCount = 0;
  let caughtCount = 0;
  world.onLost = () => {
    lostCount += 1;
  };
  world.onCatch = () => {
    caughtCount += 1;
  };

  const TENSION_CEILING = 70;
  for (let i = 0; i < 900 && world.hookedIndex !== null; i++) {
    world.setHolding(world.tension < TENSION_CEILING);
    world.step(FRAME);
  }

  assert.equal(world.hookedIndex, null, "制限時間内にフックが解決している");
  assert.equal(lostCount, 0, "テンションを抑え続ければ糸は切れない");
  assert.equal(caughtCount, 1, "粘れば大物も釣り上げられる");
  assert.equal(world.score, POINTS.big);
  assertFinite(world, "粘って釣り上げた後");
});

test("暖かさが尽きるとゲームが終わり(onFrozen)、reset で最初からやり直せる", () => {
  const world = new AugerDropWorld(WIDTH, HEIGHT);
  world.warmth = 0.01;
  let frozenScore = -1;
  world.onFrozen = ({ score }) => {
    frozenScore = score;
  };

  world.step(FRAME);

  assert.equal(world.isOver, true, "暖かさが尽きて終了する");
  assert.equal(world.warmth, 0);
  assert.equal(frozenScore, world.score);

  // 終了後にstepしても状態が変化しない(早期リターン)
  const lureBeforeExtraStep = { ...world.lure };
  world.step(FRAME);
  assert.deepEqual(world.lure, lureBeforeExtraStep, "終了後は状態が変化しない");

  world.reset();
  assert.equal(world.isOver, false);
  assert.equal(world.warmth, WARMTH_MAX);
  assert.equal(world.score, 0);
  assert.equal(world.catches, 0);
  assert.equal(world.hookedIndex, null);
  assertFinite(world, "リセット後");
});

test("画面端でルアーが水域の外にはみ出さない", () => {
  const world = new AugerDropWorld(WIDTH, HEIGHT);
  world.lure = { x: WIDTH - 3, y: HEIGHT / 2, vx: 500, vy: 0 };
  world.setHolding(false);

  world.step(FRAME);

  assert.equal(world.lure.x, WIDTH - EDGE_MARGIN, "右端のマージンでクランプされる");
  assertFinite(world, "端での挙動後");
});

test("氷の穴より上(水面より上)へはルアーも魚も出られない", () => {
  const world = new AugerDropWorld(WIDTH, HEIGHT);
  world.setAimTarget(world.hole.x, -1000);
  world.setHolding(true);

  for (let i = 0; i < 60; i++) world.step(FRAME);

  assert.ok(world.lure.y >= world.hole.y, "ルアーは氷の下から出ない");
  assertFinite(world, "水面付近での挙動後");
});

test("画面サイズが変わってもルアー・穴・魚が画面内に収まる", () => {
  const world = new AugerDropWorld(WIDTH, HEIGHT);
  world.setAimTarget(WIDTH * 0.9, HEIGHT * 0.9);
  world.setHolding(true);
  for (let i = 0; i < 10; i++) world.step(FRAME);

  // PC横長 → スマホ縦長
  world.resize(375, 720);

  assert.ok(world.lure.x >= -1 && world.lure.x <= 376, "ルアーが画面内に収まる");
  assert.ok(world.hole.x >= -1 && world.hole.x <= 376, "穴が画面内に収まる");
  for (const f of world.fish) {
    assert.ok(f.x >= -1 && f.x <= 376, "魚が画面内に収まる");
  }

  for (let i = 0; i < 30; i++) world.step(FRAME);
  assertFinite(world, "リサイズ後");
});

test("テンション・釣果の上限定数が想定どおりの範囲になっている", () => {
  assert.equal(TENSION_MAX, 100);
  assert.equal(REEL_PROGRESS_MAX, 100);
  assert.ok(POINTS.big > POINTS.small, "大物の方が得点が高い");
});
