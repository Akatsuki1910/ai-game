import assert from "node:assert/strict";
import { test } from "node:test";
import { pathLength } from "./path.ts";
import { GlyphFlashWorld } from "./world.ts";

const WIDTH = 960;
const HEIGHT = 540;
const FRAME = 1 / 60;

function runUntilPhase(
  world: GlyphFlashWorld,
  phase: GlyphFlashWorld["phase"],
  maxFrames = 600,
): void {
  for (let i = 0; i < maxFrames && world.phase !== phase && !world.isOver; i++) {
    world.step(FRAME);
  }
}

function assertFinite(world: GlyphFlashWorld, label: string): void {
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.lives), `${label}: lives`);
  for (const p of world.targetPath) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `${label}: targetPath`);
  }
  for (const p of world.drawnPath) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `${label}: drawnPath`);
  }
}

test("起動直後はお題(preview)から始まり、お題・残機・ラウンドが揃っている", () => {
  const world = new GlyphFlashWorld(WIDTH, HEIGHT);

  assert.equal(world.phase, "preview");
  assert.equal(world.round, 1);
  assert.equal(world.score, 0);
  assert.equal(world.lives, 3);
  assert.equal(world.isOver, false);
  assert.ok(world.targetPath.length >= 2, "お題の軌跡が生成されている");
});

test("お題を見せる時間が過ぎると、何もしなくても trace フェーズへ進む", () => {
  const world = new GlyphFlashWorld(WIDTH, HEIGHT);
  runUntilPhase(world, "trace");
  assert.equal(world.phase, "trace");
});

test("trace フェーズでなぞり切ると採点され、ぴったり同じ形なら合格してラウンドが進む", () => {
  const world = new GlyphFlashWorld(WIDTH, HEIGHT);
  runUntilPhase(world, "trace");

  // お題とまったく同じ軌跡をなぞる = 必ず合格するはず
  const [first, ...rest] = world.targetPath;
  world.beginStroke(first.x, first.y);
  for (const p of rest) world.extendStroke(p.x, p.y);
  world.endStroke();

  assert.equal(world.phase, "result");
  assert.ok(world.lastResult !== null);
  assert.equal(world.lastResult?.passed, true, "完全に一致する軌跡は合格する");
  assert.equal(world.round, 2, "合格するとラウンドが進む");
  assert.ok(world.score > 0, "合格すると得点が入る");
  assert.equal(world.lives, 3, "合格すれば残機は減らない");
  assertFinite(world, "合格後");
});

test("trace フェーズで的外れになぞると不合格になり、残機が減る", () => {
  const world = new GlyphFlashWorld(WIDTH, HEIGHT);
  runUntilPhase(world, "trace");

  const roundBefore = world.round;
  world.beginStroke(1, 1);
  world.extendStroke(2, 1);
  world.endStroke();

  assert.equal(world.phase, "result");
  assert.equal(world.lastResult?.passed, false, "的外れな線は不合格になる");
  assert.equal(world.round, roundBefore, "不合格ならラウンドは進まない");
  assert.equal(world.lives, 2, "不合格だと残機が減る");
  assertFinite(world, "不合格後");
});

test("result フェーズが終わると次のラウンドの preview へ自動的に戻る", () => {
  const world = new GlyphFlashWorld(WIDTH, HEIGHT);
  runUntilPhase(world, "trace");
  world.beginStroke(1, 1);
  world.extendStroke(2, 1);
  world.endStroke();
  assert.equal(world.phase, "result");

  runUntilPhase(world, "preview");
  assert.equal(world.phase, "preview", "次のラウンドの記憶フェーズに戻る");
  assert.ok(world.targetPath.length >= 2, "次のお題が生成されている");
});

test("残機が0になるとゲームオーバーになり、以降 step しても壊れない", () => {
  const world = new GlyphFlashWorld(WIDTH, HEIGHT);

  for (let i = 0; i < 3 && !world.isOver; i++) {
    runUntilPhase(world, "trace");
    world.beginStroke(1, 1);
    world.extendStroke(2, 1);
    world.endStroke();
    // 次のラウンドへ戻るか、ゲームオーバーで止まるまで進める
    for (let f = 0; f < 200 && world.phase === "result" && !world.isOver; f++) {
      world.step(FRAME);
    }
  }

  assert.equal(world.isOver, true, "3回不合格を繰り返すとゲームオーバーになる");
  assert.equal(world.lives, 0);

  world.step(FRAME);
  assertFinite(world, "ゲームオーバー後");
  assert.equal(world.isOver, true, "ゲームオーバー後は進行しない");
});

test("reset でゲームオーバーからも最初の状態に戻れる", () => {
  const world = new GlyphFlashWorld(WIDTH, HEIGHT);
  for (let i = 0; i < 3 && !world.isOver; i++) {
    runUntilPhase(world, "trace");
    world.beginStroke(1, 1);
    world.extendStroke(2, 1);
    world.endStroke();
    for (let f = 0; f < 200 && world.phase === "result" && !world.isOver; f++) {
      world.step(FRAME);
    }
  }
  assert.equal(world.isOver, true);

  world.reset();
  assert.equal(world.isOver, false);
  assert.equal(world.round, 1);
  assert.equal(world.score, 0);
  assert.equal(world.lives, 3);
  assert.equal(world.phase, "preview");
});

test("trace 以外のフェーズでの描画操作は無視される", () => {
  const world = new GlyphFlashWorld(WIDTH, HEIGHT);
  assert.equal(world.phase, "preview");

  world.beginStroke(10, 10);
  assert.equal(world.isStrokeActive, false, "preview 中は描き始められない");
  world.extendStroke(20, 20);
  assert.equal(world.drawnPath.length, 0);
});

test("インクが尽きると、それ以上は線が伸びない", () => {
  const world = new GlyphFlashWorld(WIDTH, HEIGHT);
  runUntilPhase(world, "trace");

  world.beginStroke(0, 0);
  const budget = world.inkBudget;
  // インク予算を大きく超える距離を一度に伸ばそうとする
  world.extendStroke(budget * 10, 0);
  assert.equal(world.drawnPath.length, 1, "予算を超える一手は追加されない");
  assert.equal(world.inkRemaining, budget);
});

test("極小サイズで初期化してから実寸へリサイズしても、お題をなぞりきれるだけのインク予算が保たれる", () => {
  // コンポーネント側は Pixi の初期化が終わるまで world を 1x1 で作り、
  // ResizeObserver が実寸を報告してから resize() する。
  // 予算が座標と一緒に拡大されないと、実寸に伸びた軌跡に対して予算が絶対的に小さすぎて
  // 一歩も線が伸ばせなくなる(なぞっても毎回弾かれる)不具合が過去に起きた。
  const world = new GlyphFlashWorld(1, 1);
  world.resize(WIDTH, HEIGHT);
  runUntilPhase(world, "trace");

  const targetLength = pathLength(world.targetPath);
  assert.ok(
    world.inkBudget >= targetLength,
    `リサイズ後もお題の長さぶんの予算がある: budget=${world.inkBudget}, targetLength=${targetLength}`,
  );

  const [first, ...rest] = world.targetPath;
  world.beginStroke(first.x, first.y);
  for (const p of rest) world.extendStroke(p.x, p.y);
  assert.equal(
    world.drawnPath.length,
    world.targetPath.length,
    "予算不足で線が途中で弾かれず、お題をなぞりきれる",
  );
});

test("画面サイズが変わっても座標が有限のまま保たれる", () => {
  const world = new GlyphFlashWorld(WIDTH, HEIGHT);
  world.resize(375, 720);
  assertFinite(world, "リサイズ後");
  assert.equal(world.width, 375);
  assert.equal(world.height, 720);
});
