import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AIM_MAX_ANGLE,
  AIM_MIN_ANGLE,
  cubicBezierPoint,
  HomingArcWorld,
  MAX_LIVES,
} from "./world.ts";

const WIDTH = 960;
const HEIGHT = 540;
const FRAME = 1 / 60;
const MAX_STEPS = 6000; // 100秒ぶん。窓を通り過ぎたら異常とみなして打ち切る安全弁。

function assertFinite(world: HomingArcWorld, label: string): void {
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.lives), `${label}: lives`);
  assert.ok(Number.isFinite(world.aimAngle), `${label}: aimAngle`);
  const position = world.currentBoomerangPosition;
  if (position) {
    assert.ok(Number.isFinite(position.x) && Number.isFinite(position.y), `${label}: position`);
  }
  for (const obstacle of world.obstacles) {
    assert.ok(Number.isFinite(obstacle.x) && Number.isFinite(obstacle.y), `${label}: obstacle`);
  }
}

/** キャッチウィンドウに入るまで進めてキャッチする。窓に入らないまま打ち切ったら失敗させる。 */
function throwAndCatch(world: HomingArcWorld): void {
  world.obstacles = [];
  world.releaseThrow();
  assert.equal(world.phase, "flying", "投げると飛行状態になる");

  for (let i = 0; i < MAX_STEPS && !world.isInCatchWindow; i++) {
    world.step(FRAME);
  }
  assert.ok(world.isInCatchWindow, "キャッチウィンドウに到達できる");
  world.attemptCatch();
}

/** キャッチせずウィンドウを通過させてミス扱いにする。 */
function throwAndMiss(world: HomingArcWorld): void {
  world.obstacles = [];
  world.releaseThrow();
  const activeThrow = world.activeThrow;
  assert.ok(activeThrow, "投げると activeThrow が入る");
  const windowEnd = activeThrow?.windowEndSeconds ?? 0;

  for (let i = 0; i < MAX_STEPS && world.phase === "flying"; i++) {
    world.step(FRAME);
    if ((world.activeThrow?.elapsed ?? windowEnd + 1) > windowEnd + 1) break;
  }
}

test("起動直後は狙い状態・満タンのライフ・障害物が配置されている", () => {
  const world = new HomingArcWorld(WIDTH, HEIGHT);

  assert.equal(world.phase, "aiming");
  assert.equal(world.lives, MAX_LIVES);
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.isOver, false);
  assert.ok(world.obstacles.length >= 1, "障害物が配置されている");
  assert.ok(world.aimAngle >= AIM_MIN_ANGLE && world.aimAngle <= AIM_MAX_ANGLE);
  assertFinite(world, "起動直後");
});

test("狙いの角度とパワーは範囲内にクランプされる", () => {
  const world = new HomingArcWorld(WIDTH, HEIGHT);

  world.rotateAim(-Math.PI * 10);
  assert.equal(world.aimAngle, AIM_MIN_ANGLE, "下限でクランプされる");
  world.rotateAim(Math.PI * 20);
  assert.equal(world.aimAngle, AIM_MAX_ANGLE, "上限でクランプされる");

  world.adjustPower(-10);
  assert.ok(world.aimPower > 0, "パワーが0以下にならない");
  world.adjustPower(10);
  assert.equal(world.aimPower, 1, "パワーは1でクランプされる");
});

test("ドラッグ量から逆方向に狙いが決まる", () => {
  const world = new HomingArcWorld(WIDTH, HEIGHT);

  // 右下へ引っ張ると、逆の左上方向へ投げる角度になるはず（クランプ範囲内で）
  world.setAimFromDrag(100, 80);
  const dir = { x: Math.cos(world.aimAngle), y: Math.sin(world.aimAngle) };
  assert.ok(dir.x < 0, "引っ張った逆(左)方向に投げる角度になる");

  const before = world.aimPower;
  world.setAimFromDrag(1, 1);
  assert.notEqual(world.aimPower, before, "極端に小さいドラッグでもパワーが更新される");
});

test("投げると立方ベジェの始点・終点がアンカーに一致する", () => {
  const world = new HomingArcWorld(WIDTH, HEIGHT);
  world.releaseThrow();
  const activeThrow = world.activeThrow;
  assert.ok(activeThrow, "activeThrow が存在する");
  if (!activeThrow) return;

  const anchor = world.anchor;
  assert.equal(activeThrow.p0.x, anchor.x);
  assert.equal(activeThrow.p0.y, anchor.y);
  assert.equal(activeThrow.p3.x, anchor.x);
  assert.equal(activeThrow.p3.y, anchor.y);

  const startPos = cubicBezierPoint(
    activeThrow.p0,
    activeThrow.p1,
    activeThrow.p2,
    activeThrow.p3,
    0,
  );
  const endPos = cubicBezierPoint(
    activeThrow.p0,
    activeThrow.p1,
    activeThrow.p2,
    activeThrow.p3,
    1,
  );
  assert.equal(startPos.x, anchor.x);
  assert.equal(endPos.x, anchor.x);
});

test("キャッチウィンドウでキャッチすると得点しコンボが伸びる", () => {
  const world = new HomingArcWorld(WIDTH, HEIGHT);
  const resolved: string[] = [];
  world.onThrowResolved = (event) => resolved.push(event.outcome);

  throwAndCatch(world);

  assert.equal(world.phase, "aiming", "キャッチすると狙い状態に戻る");
  assert.equal(world.combo, 1);
  assert.ok(world.score > 0, "得点が入る");
  assert.equal(world.lives, MAX_LIVES, "キャッチすればライフは減らない");
  assert.deepEqual(resolved, ["caught"]);

  throwAndCatch(world);
  assert.equal(world.combo, 2, "連続でキャッチするとコンボが伸びる");
  assert.ok(world.score > 0);
});

test("ウィンドウに入る前にキャッチを試みても無視される（連打耐性）", () => {
  const world = new HomingArcWorld(WIDTH, HEIGHT);
  world.obstacles = [];
  world.releaseThrow();

  for (let i = 0; i < 30; i++) world.attemptCatch();
  assert.equal(world.phase, "flying", "早すぎるキャッチは無視されて飛行が続く");
  assert.equal(world.lives, MAX_LIVES);
  assert.equal(world.score, 0);
});

test("キャッチし損ねるとライフが減りコンボが切れる", () => {
  const world = new HomingArcWorld(WIDTH, HEIGHT);
  const resolved: string[] = [];
  world.onThrowResolved = (event) => resolved.push(event.outcome);

  throwAndCatch(world);
  assert.equal(world.combo, 1);

  throwAndMiss(world);

  assert.equal(world.phase, "aiming");
  assert.equal(world.combo, 0, "ミスするとコンボが切れる");
  assert.equal(world.lives, MAX_LIVES - 1, "ミスするとライフが減る");
  assert.deepEqual(resolved, ["caught", "missed"]);
  assertFinite(world, "ミス後");
});

test("障害物に当たると即座にミス扱いになる", () => {
  const world = new HomingArcWorld(WIDTH, HEIGHT);
  world.obstacles = [];
  world.releaseThrow();
  const activeThrow = world.activeThrow;
  assert.ok(activeThrow, "activeThrow が存在する");
  if (!activeThrow) return;

  // 飛行経路の中間(t=0.5)に障害物を置く
  const midpoint = cubicBezierPoint(
    activeThrow.p0,
    activeThrow.p1,
    activeThrow.p2,
    activeThrow.p3,
    0.5,
  );
  world.obstacles = [{ id: 999, x: midpoint.x, y: midpoint.y, radius: 30 }];

  const resolved: string[] = [];
  world.onThrowResolved = (event) => resolved.push(event.outcome);

  const halfwaySeconds = activeThrow.duration * 0.5;
  for (let elapsed = 0; elapsed < halfwaySeconds + FRAME * 4; elapsed += FRAME) {
    world.step(FRAME);
    if (world.phase === "aiming") break;
  }

  assert.deepEqual(resolved, ["obstacle"]);
  assert.equal(world.lives, MAX_LIVES - 1, "障害物に当たるとライフが減る");
  assert.equal(world.combo, 0);
});

test("ライフが尽きるとゲームオーバーになり、以後の操作は無視される", () => {
  const world = new HomingArcWorld(WIDTH, HEIGHT);

  for (let i = 0; i < MAX_LIVES; i++) throwAndMiss(world);

  assert.equal(world.isOver, true);
  assert.equal(world.lives, 0);

  const scoreAtGameOver = world.score;
  world.releaseThrow();
  assert.equal(world.phase, "aiming", "ゲームオーバー後は投げられない");
  world.attemptCatch();
  world.step(FRAME);
  assert.equal(world.score, scoreAtGameOver, "ゲームオーバー後は状態が変わらない");
});

test("リスタートで最初の状態に戻る", () => {
  const world = new HomingArcWorld(WIDTH, HEIGHT);
  throwAndCatch(world);
  throwAndMiss(world);

  world.reset();

  assert.equal(world.phase, "aiming");
  assert.equal(world.lives, MAX_LIVES);
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.isOver, false);
});

test("画面サイズが変わっても座標が画面内相当に収まり続ける", () => {
  const world = new HomingArcWorld(WIDTH, HEIGHT);
  world.obstacles = [];
  world.releaseThrow();

  // PC横長 → スマホ縦長
  world.resize(390, 780);

  const activeThrow = world.activeThrow;
  assert.ok(activeThrow, "リサイズ後も activeThrow が残っている");
  if (activeThrow) {
    assert.ok(Number.isFinite(activeThrow.p1.x) && Number.isFinite(activeThrow.p1.y));
  }

  for (let i = 0; i < 60; i++) world.step(FRAME);
  assertFinite(world, "リサイズ後");
});

test("コンボが伸びるほど障害物が増える(上限あり)", () => {
  const world = new HomingArcWorld(WIDTH, HEIGHT);

  const counts: number[] = [world.obstacles.length];
  for (let i = 0; i < 10; i++) {
    throwAndCatch(world);
    counts.push(world.obstacles.length);
  }

  assert.ok(counts[counts.length - 1] > counts[0], "コンボが伸びると障害物が増える");
  for (const count of counts) {
    assert.ok(count >= 1 && count <= 5, "障害物数は1〜5の範囲に収まる");
  }
});
