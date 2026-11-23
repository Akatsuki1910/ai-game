import assert from "node:assert/strict";
import { test } from "node:test";
import { cellMidpoint } from "./wedgeGeometry.ts";
import {
  generateWedgeCells,
  KirigamiSnowWorld,
  MAX_LIVES,
  type RoundCompletedEvent,
  roundSecondsForRound,
  rowCountForRound,
} from "./world.ts";

/** 常に同じ値を返すRNG。決定的なテストのために使う。 */
function constantRng(value: number): () => number {
  return () => value;
}

function assertFinite(world: KirigamiSnowWorld, label: string): void {
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.lives), `${label}: lives`);
  assert.ok(Number.isFinite(world.timeRemaining), `${label}: timeRemaining`);
  assert.ok(Number.isFinite(world.round), `${label}: round`);
  assert.ok(Number.isFinite(world.liveAccuracy), `${label}: liveAccuracy`);
}

test("rowCountForRound / roundSecondsForRound: ラウンドが進むほど難しくなる(行数は増え、時間は減る)", () => {
  assert.equal(rowCountForRound(1), 3);
  assert.ok(rowCountForRound(20) <= 8, "行数には上限がある");
  assert.ok(rowCountForRound(20) >= rowCountForRound(1), "行数は減らない");

  assert.equal(roundSecondsForRound(1), 20);
  assert.ok(roundSecondsForRound(50) >= 8, "制限時間には下限がある");
  assert.ok(roundSecondsForRound(50) <= roundSecondsForRound(1), "制限時間は増えない");
});

test("generateWedgeCells: 全マスshouldKeep=trueになり得るRNGでも、必ず両方の状態が混在する", () => {
  const cells = generateWedgeCells(3, constantRng(0));
  assert.equal(cells.length, 6);
  assert.ok(
    cells.some((c) => c.shouldKeep),
    "残すべきマスが少なくとも1つある",
  );
  assert.ok(
    cells.some((c) => !c.shouldKeep),
    "切るべきマスが少なくとも1つある",
  );
  assert.ok(
    cells.every((c) => c.isCut === false),
    "生成直後はどのマスも未カット",
  );
});

test("generateWedgeCells: 全マスshouldKeep=falseになり得るRNGでも、必ず両方の状態が混在する", () => {
  const cells = generateWedgeCells(3, constantRng(0.99));
  assert.ok(
    cells.some((c) => c.shouldKeep),
    "残すべきマスが少なくとも1つある",
  );
  assert.ok(
    cells.some((c) => !c.shouldKeep),
    "切るべきマスが少なくとも1つある",
  );
});

test("起動直後は1ラウンド目・満タンのライフ・スコア0で、行数通りのセルが生成されている", () => {
  const world = new KirigamiSnowWorld();

  assert.equal(world.round, 1);
  assert.equal(world.lives, MAX_LIVES);
  assert.equal(world.score, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.rowCount, rowCountForRound(1));
  assert.equal(world.cells.length, (world.rowCount * (world.rowCount + 1)) / 2);
  assertFinite(world, "起動直後");
});

test("toggleCell: 指定したマスのカット状態が反転する", () => {
  const world = new KirigamiSnowWorld();
  assert.equal(world.cells[0].isCut, false);

  world.toggleCell(0, 0);
  assert.equal(world.cells[0].isCut, true);

  world.toggleCell(0, 0);
  assert.equal(world.cells[0].isCut, false);
});

test("toggleCellAt: セルの中点をクリックするとそのマスがカットされる", () => {
  const world = new KirigamiSnowWorld();
  const mid = cellMidpoint(1, 1, world.rowCount);

  world.toggleCellAt(mid.x, mid.y);

  const cell = world.cells.find((c) => c.row === 1 && c.col === 1);
  assert.ok(cell, "対象のマスが存在する");
  assert.equal(cell?.isCut, true);
});

test("toggleCellAt: ウェッジの外をクリックしても何も起きない", () => {
  const world = new KirigamiSnowWorld();
  const before = world.cells.map((c) => c.isCut);

  world.toggleCellAt(5, 5);

  assert.deepEqual(
    world.cells.map((c) => c.isCut),
    before,
  );
});

test("finishRound: 目標どおりに切り終えると成功し、スコアが増えて次のラウンドへ進む", () => {
  const world = new KirigamiSnowWorld();
  for (const cell of world.cells) cell.isCut = !cell.shouldKeep;

  const events: RoundCompletedEvent[] = [];
  world.onRoundCompleted = (event) => events.push(event);

  const roundBefore = world.round;
  world.finishRound();

  assert.equal(events.length, 1);
  assert.equal(events[0].success, true);
  assert.equal(events[0].accuracy, 1);
  assert.equal(events[0].round, roundBefore);
  assert.ok(world.score > 0, "成功するとスコアが増える");
  assert.equal(world.lives, MAX_LIVES, "成功してもライフは減らない");
  assert.equal(world.round, roundBefore + 1);
  assert.equal(world.isOver, false);
  assert.ok(
    world.cells.every((c) => c.isCut === false),
    "次のラウンドのセルは未カットから始まる",
  );
});

test("finishRound: 目標と大きくズレていると失敗しライフが減る(ラウンドは続く)", () => {
  // rng を固定し、「ほぼ全マスshouldKeep=false」にしておく。何も切らずに仕上げると
  // (本来は切るべきマスを切らないままになる)一致率はほぼ0になり、確実に失敗するケースを再現できる。
  const world = new KirigamiSnowWorld(constantRng(0.99));
  // 何も切らずに仕上げる(ズレが大きいケース)。
  const events: RoundCompletedEvent[] = [];
  world.onRoundCompleted = (event) => events.push(event);

  const livesBefore = world.lives;
  world.finishRound();

  assert.equal(events[0].success, false);
  assert.equal(world.lives, livesBefore - 1);
  assert.equal(world.round, 2, "失敗してもライフが残っていればラウンドは進む");
  assert.equal(world.isOver, false);
});

test("ライフが尽きるとゲームオーバーになり、以後の操作は無視される", () => {
  // rng を固定し、「ほぼ全マスshouldKeep=false」にしておく。何も切らずに仕上げると
  // 一致率はほぼ0(強制調整で1マスだけtrueになった分だけ)になり、毎ラウンド確実に失敗する。
  const world = new KirigamiSnowWorld(constantRng(0.99));

  for (let i = 0; i < MAX_LIVES; i++) {
    world.finishRound(); // 何も切らずに仕上げて失敗させ続ける
  }

  assert.equal(world.isOver, true);
  assert.equal(world.lives, 0);

  const scoreAtGameOver = world.score;
  const roundAtGameOver = world.round;
  world.toggleCell(0, 0);
  world.finishRound();
  world.step(1);

  assert.equal(world.score, scoreAtGameOver, "ゲームオーバー後はスコアが変わらない");
  assert.equal(world.round, roundAtGameOver, "ゲームオーバー後はラウンドが進まない");
});

test("step: 制限時間が尽きると自動でラウンドが仕上がる", () => {
  const world = new KirigamiSnowWorld(constantRng(0.99));
  const events: RoundCompletedEvent[] = [];
  world.onRoundCompleted = (event) => events.push(event);

  world.step(world.timeRemaining + 1);

  assert.equal(events.length, 1, "制限時間切れで自動的にfinishRoundが呼ばれる");
  assert.equal(world.timeRemaining, roundSecondsForRound(2), "次のラウンドの制限時間に戻る");
});

test("reset: 進行状態をすべて初期状態に戻す", () => {
  const world = new KirigamiSnowWorld();
  world.toggleCell(0, 0);
  world.finishRound();
  world.toggleCell(0, 0);

  world.reset();

  assert.equal(world.round, 1);
  assert.equal(world.lives, MAX_LIVES);
  assert.equal(world.score, 0);
  assert.equal(world.isOver, false);
  assert.ok(world.cells.every((c) => c.isCut === false));
});

test("時間が経っても数値が有限のまま進行し続ける", () => {
  const world = new KirigamiSnowWorld();
  for (let i = 0; i < 300 && !world.isOver; i++) {
    world.step(1 / 60);
    if (i % 30 === 0) world.toggleCell(0, 0);
  }
  assertFinite(world, "長時間経過後");
});
