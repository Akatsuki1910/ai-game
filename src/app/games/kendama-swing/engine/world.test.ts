import assert from "node:assert/strict";
import { test } from "node:test";
import { KENDAMA_START_LIVES, KendamaWorld } from "./world.ts";

const WIDTH = 480;
const HEIGHT = 800;
const FRAME = 1 / 60;
const TINY_FRAME = 1 / 240;

function assertFinite(world: KendamaWorld, label: string): void {
  assert.ok(Number.isFinite(world.cup.x) && Number.isFinite(world.cup.y), `${label}: cup`);
  assert.ok(Number.isFinite(world.ball.x) && Number.isFinite(world.ball.y), `${label}: ball`);
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.combo), `${label}: combo`);
}

/** 玉をカップの受け口ぎりぎりに、下向きの速度で置く（キャッチが成立する状況を作る）。 */
function placeBallAtMouth(world: KendamaWorld, insetFromCatchRadius = 5): void {
  const mouthX = world.cup.x;
  const mouthY = world.cup.y - 32;
  world.ball.x = mouthX;
  world.ball.y = mouthY + Math.max(0, world.catchRadius - insetFromCatchRadius);
  world.ball.vx = 0;
  world.ball.vy = 50;
}

/** 玉を受け口から大きく外れた位置の床際に置く（キャッチできず床に触れる状況を作る）。 */
function placeBallNearFloor(world: KendamaWorld): void {
  const maxCupY = world.height - 18 - 20 - 4;
  world.setCupPosition(world.cup.x, maxCupY);
  world.ball.x = world.cup.x + 4;
  world.ball.y = world.height - 18 + 1;
  world.ball.vx = 0;
  world.ball.vy = 50;
}

test("起動直後にカップと玉が画面内に配置され、玉が宙へ打ち上げられている", () => {
  const world = new KendamaWorld(WIDTH, HEIGHT);

  assert.ok(world.cup.x >= 0 && world.cup.x <= WIDTH, "カップが画面内");
  assert.ok(world.cup.y >= 0 && world.cup.y <= HEIGHT, "カップが画面内");
  assert.ok(world.ball.vy < 0, "開始時は玉が上へ打ち上げられている");
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.lives, KENDAMA_START_LIVES);
  assert.equal(world.isOver, false);
  assertFinite(world, "起動直後");
});

test("カップの位置はポインタ操作・キーボード操作のどちらでも画面内に収まる", () => {
  const world = new KendamaWorld(WIDTH, HEIGHT);

  world.setCupPosition(-9999, -9999);
  assert.ok(world.cup.x >= 0 && world.cup.x <= WIDTH, "左上へのはみ出しを防ぐ");
  assert.ok(world.cup.y >= 0 && world.cup.y <= HEIGHT, "左上へのはみ出しを防ぐ");

  world.setCupPosition(9999, 9999);
  assert.ok(world.cup.x >= 0 && world.cup.x <= WIDTH, "右下へのはみ出しを防ぐ");
  assert.ok(world.cup.y >= 0 && world.cup.y <= HEIGHT, "右下へのはみ出しを防ぐ");

  world.setCupPosition(world.width / 2, world.height / 2);
  const before = { x: world.cup.x, y: world.cup.y };
  world.moveCupBy(10, -10);
  assert.notEqual(world.cup.x, before.x, "キーボード操作でカップが動く");
});

test("玉は紐の長さを超えてカップから離れない", () => {
  const world = new KendamaWorld(WIDTH, HEIGHT);

  for (let i = 0; i < 300; i++) {
    // ランダムに振り回してもテストが再現困難にならないよう、決定的な往復運動にする
    const dx = Math.sin(i * 0.37) * 30;
    const dy = Math.cos(i * 0.21) * 20;
    world.moveCupBy(dx, dy);
    world.step(FRAME);
    // ゲームオーバーで玉が固定された後にカップだけ動かしても紐の制約は無関係になるため、
    // その場合は仕切り直して検証を続ける（ライフが尽きること自体は別テストの責務）。
    if (world.isOver) {
      world.reset();
      continue;
    }
    const distance = Math.hypot(world.ball.x - world.cup.x, world.ball.y - world.cup.y);
    assert.ok(
      distance <= world.ropeLength + 1,
      `${i}フレーム目: 玉とカップの距離(${distance.toFixed(2)})が紐の長さ(${world.ropeLength})以内`,
    );
    assertFinite(world, `${i}フレーム目`);
  }
});

test("受け口に飛び込むとキャッチが成立し、コンボと得点が増え、少し経つと再び打ち上げられる", () => {
  const world = new KendamaWorld(WIDTH, HEIGHT);
  const caught: number[] = [];
  world.onCatch = ({ points }) => caught.push(points);

  placeBallAtMouth(world);
  const catchRadiusBefore = world.catchRadius;
  world.step(TINY_FRAME);

  assert.equal(caught.length, 1, "キャッチイベントが1回発火する");
  assert.equal(world.combo, 1, "コンボが増える");
  assert.equal(world.score, caught[0], "得点が加算される");
  assert.equal(world.isHeld, true, "玉がカップに収まる");
  assert.ok(world.catchRadius <= catchRadiusBefore, "難易度上昇で受け口の判定が同じか狭くなる");

  // 保持時間が過ぎるまで進めると再び打ち上げられる
  let relaunched = false;
  for (let i = 0; i < 60 && !relaunched; i++) {
    world.step(FRAME);
    if (!world.isHeld) relaunched = true;
  }
  assert.equal(relaunched, true, "保持時間が過ぎたら玉が離れる");
  assert.ok(world.ball.vy < 0, "再び上向きに打ち上げられる");
  assertFinite(world, "再打ち上げ後");
});

test("受け損なって床に触れるとライフが減りコンボが途切れる", () => {
  const world = new KendamaWorld(WIDTH, HEIGHT);
  placeBallAtMouth(world);
  world.step(TINY_FRAME);
  assert.equal(world.combo, 1, "前提: 一度キャッチしてコンボを積む");
  for (let i = 0; i < 60 && world.isHeld; i++) world.step(FRAME);
  assert.equal(world.isHeld, false, "前提: 玉が再度宙にある");

  const missed: number[] = [];
  world.onMiss = ({ livesRemaining }) => missed.push(livesRemaining);
  const livesBefore = world.lives;

  placeBallNearFloor(world);
  world.step(FRAME);

  assert.equal(missed.length, 1, "ミスイベントが発火する");
  assert.equal(world.lives, livesBefore - 1, "ライフが1減る");
  assert.equal(world.combo, 0, "コンボが途切れる");
  assertFinite(world, "ミス後");
});

test("ライフが尽きるとゲームオーバーになり、リセットで最初から遊べる", () => {
  const world = new KendamaWorld(WIDTH, HEIGHT);

  for (let i = 0; i < KENDAMA_START_LIVES; i++) {
    placeBallNearFloor(world);
    world.step(FRAME);
  }

  assert.equal(world.isOver, true, "ライフが尽きたらゲームオーバー");
  assert.equal(world.lives, 0);

  // ゲームオーバー後に進めても壊れない
  const ballBefore = { ...world.ball };
  world.step(FRAME);
  assert.deepEqual(world.ball, ballBefore, "ゲームオーバー後は玉の状態が変化しない");
  assertFinite(world, "ゲームオーバー後");

  world.reset();
  assert.equal(world.isOver, false);
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.lives, KENDAMA_START_LIVES);
});

test("画面サイズが変わってもカップと玉が画面内に収まり続ける", () => {
  const world = new KendamaWorld(WIDTH, HEIGHT);

  // PC横長相当 → スマホ縦長相当
  world.resize(844, 390);
  assert.ok(world.cup.x >= 0 && world.cup.x <= 844, "カップが画面内(横長)");
  world.resize(375, 812);
  assert.ok(world.cup.x >= 0 && world.cup.x <= 375, "カップが画面内(縦長)");
  assert.ok(world.cup.y >= 0 && world.cup.y <= 812, "カップが画面内(縦長)");

  for (let i = 0; i < 120; i++) world.step(FRAME);
  assertFinite(world, "リサイズ後に遊び続けた後");
});
