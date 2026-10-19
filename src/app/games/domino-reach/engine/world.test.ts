import assert from "node:assert/strict";
import { test } from "node:test";
import { DOMINO_REACH } from "./chain.ts";
import { inventoryFor } from "./track.ts";
import { DominoReachWorld, MIN_SPACING, START_LIVES } from "./world.ts";

const FRAME = 1 / 60;

function assertFinite(world: DominoReachWorld, label: string): void {
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.timeRemaining), `${label}: timeRemaining`);
  assert.ok(Number.isFinite(world.simElapsed), `${label}: simElapsed`);
  for (const domino of world.placed) {
    assert.ok(Number.isFinite(domino.x), `${label}: domino.x`);
  }
}

/** 標準ドミノを隙間なく並べて、ステージ1(ピット無し)をゴールまで橋渡しする。 */
function bridgeTutorialStage(world: DominoReachWorld): void {
  const step = DOMINO_REACH.standard - 4;
  for (let x = 20; x < world.track.length; x += step) {
    world.place(x, "standard");
  }
}

function runSimulationToCompletion(world: DominoReachWorld): void {
  const guardFrames = 2000;
  for (let i = 0; i < guardFrames && world.phase === "simulating"; i++) {
    world.step(FRAME);
  }
  assert.notEqual(world.phase, "simulating", "シミュレーションが時間内に完了していない");
}

test("起動直後はステージ1・ライフ満タン・ピット無しのチュートリアル配置フェーズ", () => {
  const world = new DominoReachWorld();

  assert.equal(world.stage, 1);
  assert.equal(world.lives, START_LIVES);
  assert.equal(world.score, 0);
  assert.equal(world.phase, "build");
  assert.deepEqual(world.track.pits, []);
  assert.deepEqual(world.inventory, inventoryFor(world.track));
  assertFinite(world, "起動直後");
});

test("置けるのは範囲内・ピット外・既存ドミノと十分離れた座標だけ", () => {
  const world = new DominoReachWorld();

  assert.equal(world.place(-10, "standard"), false, "負の座標は置けない");
  assert.equal(world.place(world.track.length + 1, "standard"), false, "コース外は置けない");

  assert.equal(world.place(50, "standard"), true);
  assert.equal(world.inventory.standard, inventoryFor(world.track).standard - 1);

  assert.equal(world.place(50 + MIN_SPACING - 1, "standard"), false, "近すぎる位置には置けない");
  assert.equal(world.place(50 + MIN_SPACING + 1, "standard"), true, "十分離れていれば置ける");
});

test("在庫が尽きたドミノは置けない", () => {
  const world = new DominoReachWorld();
  world.inventory = { ...world.inventory, booster: 1 };

  assert.equal(world.place(50, "booster"), true);
  assert.equal(world.place(200, "booster"), false, "在庫が0のときは置けない");
});

test("既存ドミノの近くをタップすると回収され、在庫が戻る", () => {
  const world = new DominoReachWorld();
  const before = world.inventory.standard;
  world.place(100, "standard");
  assert.equal(world.inventory.standard, before - 1);

  assert.equal(world.removeNearest(500), false, "遠く離れた場所では何も回収しない");
  assert.equal(world.removeNearest(105), true, "近くをタップすると回収できる");
  assert.equal(world.inventory.standard, before);
  assert.equal(world.placed.length, 0);
});

test("arm()での武装中はhandleTapが設置、未武装時は回収として働く", () => {
  const world = new DominoReachWorld();

  world.arm("standard");
  world.handleTap(50);
  assert.equal(world.placed.length, 1, "武装中のタップは設置");

  world.arm("standard"); // 同じ種類を選ぶと解除
  assert.equal(world.armedType, null);
  world.handleTap(55);
  assert.equal(world.placed.length, 0, "未武装のタップは近くのドミノを回収");
});

test("clearPlacements は配置を全て在庫へ戻す", () => {
  const world = new DominoReachWorld();
  world.place(50, "standard");
  world.place(150, "standard");
  const freshInventory = inventoryFor(world.track);

  world.clearPlacements();

  assert.equal(world.placed.length, 0);
  assert.deepEqual(world.inventory, freshInventory);
});

test("ドミノを1枚も置かずにシミュレーションを始めることはできない", () => {
  const world = new DominoReachWorld();
  world.startSimulation();
  assert.equal(world.phase, "build");
});

test("配置フェーズのタイマーが尽きると自動的にシミュレーションへ移行する", () => {
  const world = new DominoReachWorld();
  world.place(50, "standard");

  while (world.phase === "build" && world.timeRemaining > 0) {
    world.step(1);
  }
  assert.equal(world.phase, "simulating");
  assertFinite(world, "タイマー切れ後");
});

test("チュートリアルステージを橋渡しできればゴールして次のステージへ進める", () => {
  const world = new DominoReachWorld();
  bridgeTutorialStage(world);
  world.startSimulation();
  assert.equal(world.phase, "simulating");

  runSimulationToCompletion(world);
  assert.equal(world.phase, "success");
  assert.equal(world.score, 100 * world.stage);

  const stageBefore = world.stage;
  world.continueToNextStage();
  assert.equal(world.stage, stageBefore + 1);
  assert.equal(world.phase, "build");
  assert.equal(world.lives, START_LIVES, "成功してもライフは減らない");
});

test("ドミノ1枚だけではゴールに届かず失敗し、ライフが減って再挑戦できる", () => {
  const world = new DominoReachWorld();
  world.place(20, "standard"); // 射程(108)はゴール(600)に遠く届かない
  world.startSimulation();

  runSimulationToCompletion(world);
  assert.equal(world.phase, "failed");
  assert.equal(world.lives, START_LIVES - 1);
  assert.equal(world.simResult?.reachedGoal, false);

  const stageBefore = world.stage;
  world.retryStage();
  assert.equal(world.phase, "build");
  assert.equal(world.stage, stageBefore, "リトライではステージ番号は変わらない");
  assert.equal(world.placed.length, 0, "リトライで配置はリセットされる");
});

test("失敗を繰り返してライフが尽きるとゲームオーバーになり、resetで最初からやり直せる", () => {
  const world = new DominoReachWorld();

  for (let attempt = 0; attempt < START_LIVES; attempt++) {
    world.place(20, "standard");
    world.startSimulation();
    runSimulationToCompletion(world);
    if (world.phase === "failed") world.retryStage();
  }

  assert.equal(world.phase, "gameover");
  assert.equal(world.lives, 0);

  world.reset();
  assert.equal(world.phase, "build");
  assert.equal(world.stage, 1);
  assert.equal(world.lives, START_LIVES);
  assert.equal(world.score, 0);
});

test("toppleProgressはbuild中は常に0で、simulating中は時間とともに0→1へ補間される", () => {
  const world = new DominoReachWorld();
  world.place(20, "standard");
  const [placedDomino] = world.placed;

  assert.equal(world.toppleProgress(placedDomino.id), 0, "build中は倒れていない");
  assert.equal(world.toppleProgress("not-placed"), 0, "存在しないIDは0");

  world.startSimulation();
  assert.equal(world.toppleProgress(placedDomino.id), 0, "起爆直後はまだ倒れ始めていない");

  for (let i = 0; i < 60 && world.phase === "simulating"; i++) world.step(FRAME);
  const progress = world.toppleProgress(placedDomino.id);
  assert.ok(progress > 0 && progress <= 1, `倒れる動きが補間されている(${progress})`);

  runSimulationToCompletion(world);
  assert.equal(world.toppleProgress(placedDomino.id), 1, "結果確定後は倒れた状態で固定される");
});
