import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ALERT_RADIUS,
  CATCH_RADIUS,
  FALCON_RADIUS,
  PREY_COUNT,
  PREY_RADIUS,
  STAMINA_MAX,
  TalonDiveWorld,
} from "./world.ts";

const WIDTH = 960;
const HEIGHT = 540;
const FRAME = 1 / 60;

function assertFinite(world: TalonDiveWorld, label: string): void {
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.stamina), `${label}: stamina`);
  assert.ok(
    Number.isFinite(world.falcon.x) && Number.isFinite(world.falcon.y),
    `${label}: falcon position`,
  );
  assert.ok(
    Number.isFinite(world.falcon.vx) && Number.isFinite(world.falcon.vy),
    `${label}: falcon velocity`,
  );
  assert.ok(
    Number.isFinite(world.rival.x) && Number.isFinite(world.rival.y),
    `${label}: rival position`,
  );
  for (const p of world.prey) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `${label}: prey position`);
  }
}

/** 毎フレーム狙点を読み直し、対象へ向けて隼を操舵し続ける。 */
function steerFalconToward(
  world: TalonDiveWorld,
  getAimPoint: () => { x: number; y: number },
  seconds: number,
): void {
  for (let elapsed = 0; elapsed < seconds && !world.isOver; elapsed += FRAME) {
    const aim = getAimPoint();
    world.setSteerTarget(aim.x, aim.y);
    world.setSteering(true);
    world.step(FRAME);
  }
}

// このテストはクライアント完結のミニゲームであり、権限拒否・キャッシュの陳腐化の観点は対象外
// （サーバー通信や認可を持たないため）。境界値(画面端での停止/バウンド)・空/ゼロ件(ラウンド開始
// 直後の未捕獲状態)・エラー/失敗(スタミナ切れ)・再入(ゲームオーバー後のreset)・操作の中断
// (isOverによるstep早期リターン)はそれぞれ以下でカバーする。非同期の競合はゲームループが単一
// スレッドの同期stepのみのため対象外。

test("起動直後は巣の上に隼がいて、スタミナが満タン・獲物とライバルが画面内に揃っている", () => {
  const world = new TalonDiveWorld(WIDTH, HEIGHT);

  assert.equal(world.stamina, STAMINA_MAX);
  assert.equal(world.score, 0);
  assert.equal(world.streak, 0);
  assert.equal(world.isOver, false);
  const distToPerch = Math.hypot(world.falcon.x - world.perch.x, world.falcon.y - world.perch.y);
  assert.ok(distToPerch < world.perch.radius, "隼は巣の中から始まる");
  assert.equal(world.prey.length, PREY_COUNT);
  for (const p of world.prey) {
    assert.ok(p.x >= 0 && p.x <= WIDTH && p.y >= 0 && p.y <= HEIGHT, "獲物が画面内にいる");
  }
  assert.ok(world.rival.x >= 0 && world.rival.x <= WIDTH, "ライバルが画面内にいる");
  assertFinite(world, "起動直後");
});

test("操舵をやめると滑空の速度は時間とともに減衰する", () => {
  const world = new TalonDiveWorld(WIDTH, HEIGHT);
  world.setSteerTarget(world.width * 0.1, world.height * 0.1);
  world.setSteering(true);
  for (let i = 0; i < 30; i++) world.step(FRAME);
  const speedWhileSteering = Math.hypot(world.falcon.vx, world.falcon.vy);
  assert.ok(speedWhileSteering > 0, "操舵中は速度が乗る");

  world.setSteering(false);
  for (let i = 0; i < 60; i++) world.step(FRAME);
  const speedAfterCoasting = Math.hypot(world.falcon.vx, world.falcon.vy);
  assert.ok(speedAfterCoasting < speedWhileSteering, "操舵をやめると減速する");
  assertFinite(world, "滑空減衰後");
});

test("獲物へ向けて操舵し続けると捕獲でき、得点とストリークが伸びる", () => {
  const world = new TalonDiveWorld(WIDTH, HEIGHT);
  const caught: number[] = [];
  const streaksAtCatch: number[] = [];
  world.onCatch = ({ points, streak }) => {
    caught.push(points);
    streaksAtCatch.push(streak);
  };

  // 道中で隼が別の獲物にすれ違い、その瞬間ライバルの方が近くて横取りされることがあり得る
  // (ストリークが0に戻る)。最終状態の streak は「直前の1回が捕獲か横取りか」に左右されて
  // 不安定なため、捕獲のたびに記録される streaksAtCatch(常に1以上)で判定する。
  steerFalconToward(world, () => world.prey[0], 20);

  assert.ok(caught.length >= 1, "少なくとも1回は捕獲する");
  assert.ok(caught[0] > 0, "得点が入っている");
  assert.ok(world.score > 0);
  assert.ok(
    streaksAtCatch.every((streak) => streak >= 1),
    "捕獲のたびにストリークは1以上へ進む",
  );
  assertFinite(world, "捕獲後");
});

test("巣の外にいる獲物はアラート範囲に入ると隼から離れる方向へ逃げる", () => {
  const world = new TalonDiveWorld(WIDTH, HEIGHT);
  world.falcon = { x: WIDTH / 2, y: HEIGHT / 2, vx: 0, vy: 0 };
  world.prey[0] = {
    x: WIDTH / 2 + ALERT_RADIUS * 0.4,
    y: HEIGHT / 2,
    vx: 0,
    vy: 0,
    wanderAngle: 0,
  };

  world.step(FRAME);

  assert.ok(world.prey[0].vx > 0, "隼から遠ざかる向きに速度が付く(右へ逃げる)");
  assertFinite(world, "逃走開始後");
});

test("ライバルが先に獲物へ到達すると横取りされ、ストリークがリセットされる", () => {
  const world = new TalonDiveWorld(WIDTH, HEIGHT);
  world.streak = 5;
  world.falcon = { x: 10, y: 10, vx: 0, vy: 0 };
  const stolenTarget = world.prey[0];
  world.rival = { x: stolenTarget.x, y: stolenTarget.y, vx: 0, vy: 0 };
  let stolenCount = 0;
  world.onStolen = () => {
    stolenCount += 1;
  };

  world.step(FRAME);

  assert.equal(stolenCount, 1, "横取りイベントが発火する");
  assert.equal(world.streak, 0, "ストリークがリセットされる");
  assertFinite(world, "横取り後");
});

test("巣の外に留まり続けるとスタミナが尽きてラウンドが終わり、resetで最初から遊べる", () => {
  const world = new TalonDiveWorld(WIDTH, HEIGHT);

  steerFalconToward(world, () => ({ x: world.width * 0.05, y: world.height * 0.05 }), 30);

  assert.equal(world.isOver, true, "スタミナが尽きてラウンド終了する");
  assert.equal(world.stamina, 0);

  // 終了後にstepしても壊れない(早期リターン)
  const falconBeforeExtraStep = { ...world.falcon };
  world.step(FRAME);
  assert.deepEqual(world.falcon, falconBeforeExtraStep, "終了後は状態が変化しない");

  world.reset();
  assert.equal(world.isOver, false);
  assert.equal(world.stamina, STAMINA_MAX);
  assert.equal(world.score, 0);
  assert.equal(world.streak, 0);
  assertFinite(world, "リセット後");
});

test("巣の中に留まるとスタミナが回復する", () => {
  const world = new TalonDiveWorld(WIDTH, HEIGHT);
  world.stamina = 20;
  world.falcon = { x: world.perch.x, y: world.perch.y, vx: 0, vy: 0 };
  world.setSteering(false);

  for (let i = 0; i < 60; i++) world.step(FRAME);

  assert.ok(world.stamina > 20, "巣の中にいるとスタミナが回復する");
  assertFinite(world, "巣での回復後");
});

test("画面端で隼が外にはみ出さず、そこで止まる", () => {
  const world = new TalonDiveWorld(WIDTH, HEIGHT);
  world.falcon = { x: FALCON_RADIUS - 5, y: HEIGHT / 2, vx: -200, vy: 0 };
  world.setSteering(false);

  world.step(FRAME);

  assert.ok(world.falcon.x >= 0, "左端を突き抜けない");
  assert.equal(world.falcon.x, FALCON_RADIUS, "端で止まる");
  assert.ok(world.falcon.vx >= 0, "外向きの速度が打ち消される");
  assertFinite(world, "端での停止後");
});

test("画面サイズが変わっても隼・巣・獲物・ライバルが画面内に収まる", () => {
  const world = new TalonDiveWorld(WIDTH, HEIGHT);
  world.setSteerTarget(WIDTH * 0.9, HEIGHT * 0.9);
  world.setSteering(true);
  for (let i = 0; i < 10; i++) world.step(FRAME);

  // PC横長 → スマホ縦長
  world.resize(375, 720);

  assert.ok(world.falcon.x >= -1 && world.falcon.x <= 376, "隼が画面内に収まる");
  assert.ok(world.falcon.y >= -1 && world.falcon.y <= 721, "隼が画面内に収まる");
  assert.ok(world.perch.x >= -1 && world.perch.x <= 376, "巣が画面内に収まる");

  for (let i = 0; i < 30; i++) world.step(FRAME);
  assert.ok(world.falcon.x >= -1 && world.falcon.x <= 376, "リサイズ後も隼が画面内");
  assertFinite(world, "リサイズ後");
});

test("捕獲判定の半径は隼と獲物それぞれの当たり半径の合計になっている", () => {
  assert.equal(CATCH_RADIUS, FALCON_RADIUS + PREY_RADIUS);
});
