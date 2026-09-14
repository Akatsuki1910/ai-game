import assert from "node:assert/strict";
import { test } from "node:test";
import { PrismDriftWorld } from "./world.ts";

const WIDTH = 960;
const HEIGHT = 540;
const FRAME = 1 / 60;

/** 全プリズムを上端に寄せて、エミッタからの光が一直線に伸びる状態を作る。 */
function clearBeamPath(world: PrismDriftWorld): void {
  for (const prism of world.prisms) {
    world.setPrismPosition(prism.id, prism.x, 0);
  }
}

/** 的をビーム上の狙った位置に静止させる。 */
function parkTargetOnBeam(world: PrismDriftWorld, index: number, x: number): void {
  const target = world.targets[index];
  target.x = x;
  target.y = HEIGHT / 2;
  target.vx = 0;
  target.vy = 0;
}

function assertFinite(world: PrismDriftWorld, label: string): void {
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.timeRemaining), `${label}: timeRemaining`);
  for (const target of world.targets) {
    assert.ok(Number.isFinite(target.x) && Number.isFinite(target.y), `${label}: target position`);
    assert.ok(Number.isFinite(target.charge), `${label}: target charge`);
  }
  for (const prism of world.prisms) {
    assert.ok(Number.isFinite(prism.x) && Number.isFinite(prism.y), `${label}: prism position`);
  }
}

test("起動直後にプリズム・的・ビームが揃っている", () => {
  const world = new PrismDriftWorld(WIDTH, HEIGHT);

  assert.ok(world.prisms.length > 0, "プリズムが配置されている");
  assert.ok(world.targets.length > 0, "的が配置されている");
  assert.equal(world.score, 0);
  assert.ok(world.timeRemaining > 0);
  assert.equal(world.isOver, false);

  const segments = world.computeBeamSegments();
  assert.ok(segments.length > 0, "ビームが少なくとも1本引かれている");
  assert.equal(segments[0].x1, 0, "ビームは左端のエミッタから出る");
});

test("プリズムを掴んで動かせる / タップで種類が切り替わる", () => {
  const world = new PrismDriftWorld(WIDTH, HEIGHT);
  const prism = world.prisms[0];

  // 指を置いた位置からプリズムを掴めること（タッチ/クリックの当たり判定）
  assert.equal(world.findPrismAt(prism.x, prism.y)?.id, prism.id);
  assert.equal(world.findPrismAt(prism.x + 500, prism.y + 500), undefined);

  world.setPrismPosition(prism.id, 400, 300);
  assert.equal(prism.x, 400);
  assert.equal(prism.y, 300);

  // 画面外にはみ出さない
  world.setPrismPosition(prism.id, -9999, 9999);
  assert.ok(prism.x >= 0 && prism.x <= WIDTH);
  assert.ok(prism.y >= 0 && prism.y <= HEIGHT);

  const before = prism.type;
  world.cyclePrismType(prism.id);
  assert.notEqual(prism.type, before, "タップで種類が変わる");
});

test("ビームを当て続けるとチャージが溜まり、得点して的が湧き直す", () => {
  const world = new PrismDriftWorld(WIDTH, HEIGHT);
  clearBeamPath(world);
  parkTargetOnBeam(world, 0, WIDTH * 0.5);

  const completed: number[] = [];
  world.onTargetCompleted = ({ points }) => completed.push(points);

  const target = world.targets[0];

  // 1フレーム進めた時点で「当たっている」と判定される
  world.step(FRAME);
  assert.equal(target.isIlluminated, true, "ビーム上の的が点灯する");
  assert.ok(target.charge > 0, "チャージが増え始める");

  // 当て続ければ必ず得点に到達する（チャージ55%/秒なので2秒で満タン）
  for (let i = 0; i < 180 && completed.length === 0; i++) {
    parkTargetOnBeam(world, 0, WIDTH * 0.5);
    world.step(FRAME);
  }

  assert.equal(completed.length, 1, "的を1つ撃ち切った");
  assert.ok(completed[0] > 0, "得点が入っている");
  assert.equal(world.score, completed[0]);
  assert.equal(target.charge, 0, "撃ち切った的はチャージが戻る");
  assertFinite(world, "得点後");
});

test("ビームから外れるとチャージが抜ける", () => {
  const world = new PrismDriftWorld(WIDTH, HEIGHT);
  clearBeamPath(world);
  parkTargetOnBeam(world, 0, WIDTH * 0.5);

  const target = world.targets[0];
  for (let i = 0; i < 30; i++) {
    parkTargetOnBeam(world, 0, WIDTH * 0.5);
    world.step(FRAME);
  }
  const charged = target.charge;
  assert.ok(charged > 0);

  // 的をビームの外へ退避させる
  target.y = HEIGHT * 0.1;
  target.vx = 0;
  target.vy = 0;
  for (let i = 0; i < 30; i++) {
    target.y = HEIGHT * 0.1;
    world.step(FRAME);
  }

  assert.equal(target.isIlluminated, false, "外れたら消灯する");
  assert.ok(target.charge < charged, "チャージが減っている");
});

test("的は時間とともに漂う", () => {
  const world = new PrismDriftWorld(WIDTH, HEIGHT);
  const before = world.targets.map((t) => ({ x: t.x, y: t.y }));

  for (let i = 0; i < 60; i++) world.step(FRAME);

  const moved = world.targets.some(
    (t, i) => Math.hypot(t.x - before[i].x, t.y - before[i].y) > 0.5,
  );
  assert.ok(moved, "1秒で少なくとも1つは動いている");
});

test("90秒遊ぶとラウンドが終わり、リスタートで最初から遊べる", () => {
  const world = new PrismDriftWorld(WIDTH, HEIGHT);
  clearBeamPath(world);

  // 実時間90秒ぶんを通しで回す
  for (let i = 0; i < 1000 && !world.isOver; i++) {
    world.step(0.1);
    assertFinite(world, "ラウンド中");
  }

  assert.equal(world.isOver, true, "ラウンドが終了する");
  assert.equal(world.timeRemaining, 0);

  // 終了後に進めても壊れない
  world.step(FRAME);
  assertFinite(world, "ラウンド終了後");

  world.reset();
  assert.equal(world.isOver, false);
  assert.equal(world.score, 0);
  assert.ok(world.timeRemaining > 0);
  assert.ok(world.targets.every((t) => t.charge === 0));
});

test("画面サイズが変わっても盤面が画面内に収まる", () => {
  const world = new PrismDriftWorld(WIDTH, HEIGHT);

  // PC横長 → スマホ縦長
  world.resize(375, 720);
  for (const prism of world.prisms) {
    assert.ok(prism.x >= -1 && prism.x <= 376, "プリズムが画面内");
    assert.ok(prism.y >= -1 && prism.y <= 721, "プリズムが画面内");
  }

  for (let i = 0; i < 60; i++) world.step(FRAME);
  for (const target of world.targets) {
    assert.ok(target.x >= 0 && target.x <= 375, "的が画面内に留まる");
    assert.ok(target.y >= 0 && target.y <= 720, "的が画面内に留まる");
  }
  assertFinite(world, "リサイズ後");
});
