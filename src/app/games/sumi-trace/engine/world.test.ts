import assert from "node:assert/strict";
import { test } from "node:test";
import { OFF_PATH_FAIL_SECONDS, SumiTraceWorld } from "./world.ts";

const WIDTH = 800;
const HEIGHT = 500;
const FRAME = 1 / 60;

/** ガイドの折れ線に沿って筆を進める（成功させるための操作列）。 */
function traceStrokeToCompletion(world: SumiTraceWorld): void {
  const [start, ...rest] = world.stroke.points;
  world.startPointer(start.x, start.y);
  assert.equal(world.isDrawing, true, "開始点を掴めている");
  for (const point of rest) {
    world.movePointer(point.x, point.y);
    world.step(FRAME);
  }
  // 浮動小数の誤差でわずかに届かない場合に備えて終点付近をもう一度なぞる。
  const last = world.stroke.points[world.stroke.points.length - 1];
  for (let i = 0; i < 5 && world.progressRatio < 1; i++) {
    world.movePointer(last.x, last.y);
    world.step(FRAME);
  }
}

function assertFinite(world: SumiTraceWorld, label: string): void {
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.progressLength), `${label}: progressLength`);
  for (const point of world.stroke.points) {
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y), `${label}: stroke point`);
  }
}

test("起動直後はガイドが1本あり、残機3・スコア0で始まる", () => {
  const world = new SumiTraceWorld(WIDTH, HEIGHT);

  assert.equal(world.lives, 3);
  assert.equal(world.score, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.isDrawing, false);
  assert.ok(world.stroke.points.length >= 2, "ガイドは2点以上の折れ線");
  assert.ok(world.stroke.toleranceRadius > 0);
});

test("ガイドの開始点から離れた場所では筆を掴めない", () => {
  const world = new SumiTraceWorld(WIDTH, HEIGHT);
  const start = world.stroke.points[0];

  world.startPointer(start.x + 500, start.y + 500);
  assert.equal(world.isDrawing, false, "遠い場所では描き始められない");

  world.startPointer(start.x, start.y);
  assert.equal(world.isDrawing, true, "開始点なら描き始められる");
});

test("ガイドをなぞり切ると1画完成し、得点してコンボが増える", () => {
  const world = new SumiTraceWorld(WIDTH, HEIGHT);
  const events: Array<{ points: number; combo: number; isClean: boolean }> = [];
  world.onStrokeCompleted = (event) => events.push(event);

  traceStrokeToCompletion(world);

  assert.equal(events.length, 1, "1画完成した");
  assert.ok(events[0].points > 0, "得点が入っている");
  assert.equal(events[0].combo, 1, "最初のきれいな1画でコンボが1になる");
  assert.ok(events[0].isClean, "ガイドに沿っていたのでクリーン判定");
  assert.equal(world.score, events[0].points);
  assert.equal(world.progressLength, 0, "次の画の進行は0から始まる");
  assert.equal(world.isDrawing, false, "完成後は筆が上がる");
  assertFinite(world, "1画完成後");
});

test("ガイドから大きく外れたまま粘ると、ミスになり残機が減る", () => {
  const world = new SumiTraceWorld(WIDTH, HEIGHT);
  const start = world.stroke.points[0];
  let failed = 0;
  world.onStrokeFailed = () => failed++;

  world.startPointer(start.x, start.y);
  world.movePointer(start.x + 10000, start.y + 10000);
  assert.equal(world.isPointerOffPath, true, "大きく外れた位置はガイド外判定");

  for (let i = 0; i < Math.ceil(OFF_PATH_FAIL_SECONDS / FRAME) + 2; i++) {
    world.step(FRAME);
  }

  assert.equal(failed, 1, "ガイド外に粘ったら1回ミスになる");
  assert.equal(world.lives, 2, "残機が1減る");
  assert.equal(world.combo, 0, "ミスでコンボが切れる");
  assertFinite(world, "ミス後");
});

test("残機がなくなるとゲームオーバーになり、reset でやり直せる", () => {
  const world = new SumiTraceWorld(WIDTH, HEIGHT);

  for (let lives = 3; lives > 0; lives--) {
    const start = world.stroke.points[0];
    world.startPointer(start.x, start.y);
    world.movePointer(start.x + 10000, start.y + 10000);
    for (
      let i = 0;
      i < Math.ceil(OFF_PATH_FAIL_SECONDS / FRAME) + 2 && world.lives === lives;
      i++
    ) {
      world.step(FRAME);
    }
  }

  assert.equal(world.isOver, true, "3回ミスするとゲームオーバー");
  assert.equal(world.lives, 0);
  assert.equal(world.isDrawing, false);

  // ゲームオーバー後に進めても壊れない
  world.step(FRAME);
  assertFinite(world, "ゲームオーバー後");

  world.reset();
  assert.equal(world.isOver, false);
  assert.equal(world.lives, 3);
  assert.equal(world.score, 0);
});

test("時間切れでもミスになる", () => {
  const world = new SumiTraceWorld(WIDTH, HEIGHT);
  const start = world.stroke.points[0];
  let failed = 0;
  world.onStrokeFailed = () => failed++;

  world.startPointer(start.x, start.y);
  const limit = world.stroke.timeLimitSeconds;
  for (let i = 0; i < Math.ceil(limit / FRAME) + 2 && world.lives === 3; i++) {
    world.step(FRAME);
  }

  assert.equal(failed, 1, "描き終える前に時間切れでミスになる");
  assert.equal(world.lives, 2);
});

test("筆を上げて放置すると進行が乾いて戻る", () => {
  const world = new SumiTraceWorld(WIDTH, HEIGHT);
  const [start, mid] = world.stroke.points;

  world.startPointer(start.x, start.y);
  world.movePointer(mid.x, mid.y);
  world.step(FRAME);
  const progressed = world.progressLength;
  assert.ok(progressed > 0, "途中まで進んでいる");

  world.endPointer();
  for (let i = 0; i < 30; i++) world.step(FRAME);

  assert.ok(world.progressLength < progressed, "筆を上げている間に進行が乾いて減る");
  assertFinite(world, "乾き後");
});

test("なぞった分だけ tracedPoints が伸びる", () => {
  const world = new SumiTraceWorld(WIDTH, HEIGHT);
  const [start, mid] = world.stroke.points;

  for (const point of world.tracedPoints) {
    assert.equal(point.x, start.x, "開始直後は開始点から動いていない(x)");
    assert.equal(point.y, start.y, "開始直後は開始点から動いていない(y)");
  }

  world.startPointer(start.x, start.y);
  world.movePointer(mid.x, mid.y);
  world.step(FRAME);

  const traced = world.tracedPoints;
  assert.equal(traced[0].x, start.x);
  assert.equal(traced[0].y, start.y);
  assert.ok(traced.length >= 2, "進んだ分だけ点が増える");
  const last = traced[traced.length - 1];
  assert.ok(Number.isFinite(last.x) && Number.isFinite(last.y));
  assert.ok(
    Math.hypot(last.x - world.frontierPoint.x, last.y - world.frontierPoint.y) < 1e-6,
    "tracedPoints の末尾は frontierPoint と一致する",
  );
});

test("画面サイズが変わっても進行の割合とガイドが画面内に収まる", () => {
  const world = new SumiTraceWorld(WIDTH, HEIGHT);
  const [start, mid] = world.stroke.points;
  world.startPointer(start.x, start.y);
  world.movePointer(mid.x, mid.y);
  world.step(FRAME);
  const ratioBefore = world.progressRatio;
  assert.ok(ratioBefore > 0, "リサイズ前に進行している");

  // PC横長 → スマホ縦長
  world.resize(390, 780);

  assert.ok(
    Math.abs(world.progressRatio - ratioBefore) < 0.05,
    "進行の割合はリサイズ後も概ね保たれる",
  );
  for (const point of world.stroke.points) {
    assert.ok(point.x >= -1 && point.x <= 391, "ガイドが画面内に収まる(x)");
    assert.ok(point.y >= -1 && point.y <= 781, "ガイドが画面内に収まる(y)");
  }
  assertFinite(world, "リサイズ後");
});
