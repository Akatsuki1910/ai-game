import assert from "node:assert/strict";
import { test } from "node:test";
import { LIVES_MAX, MAX_PIECES_ON_BELT, SCRAP_COLORS, ShredderLineWorld } from "./world.ts";

function forceSpawn(world: ShredderLineWorld): void {
  // step()は内部のspawnTimerが尽きたときだけスポーンするため、十分大きいdtで必ず1つ出す。
  world.step(10);
}

test("初期状態はスクラップ無し・スコア0・ライフ満タン", () => {
  const world = new ShredderLineWorld();

  assert.equal(world.pieces.length, 0);
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.lives, LIVES_MAX);
  assert.equal(world.isOver, false);
});

test("時間経過でスクラップがベルトに現れ、進行度が進む", () => {
  const world = new ShredderLineWorld();
  forceSpawn(world);

  assert.equal(world.pieces.length, 1);
  const piece = world.pieces[0];
  assert.ok(SCRAP_COLORS.includes(piece.color));
  assert.equal(piece.progress, 0);

  world.step(1 / 60);
  assert.ok(world.pieces[0].progress > 0, "ベルトの進行で progress が増える");
});

test("正しいシュートに投入すると加点され、コンボが伸びる", () => {
  const world = new ShredderLineWorld();
  forceSpawn(world);
  const piece = world.pieces[0];
  const chuteIndex = SCRAP_COLORS.indexOf(piece.color);

  const result = world.sortPiece(piece.id, chuteIndex);

  assert.equal(result, "correct");
  assert.equal(world.score, 100);
  assert.equal(world.combo, 1);
  assert.equal(world.lives, LIVES_MAX, "正解ではライフは減らない");
  assert.equal(world.pieces.length, 0, "投入されたスクラップはベルトから消える");
});

test("連続正解でコンボボーナスが積み重なる", () => {
  const world = new ShredderLineWorld();
  forceSpawn(world);
  const first = world.pieces[0];
  world.sortPiece(first.id, SCRAP_COLORS.indexOf(first.color));
  assert.equal(world.score, 100);

  forceSpawn(world);
  const second = world.pieces[0];
  world.sortPiece(second.id, SCRAP_COLORS.indexOf(second.color));
  assert.equal(world.score, 100 + (100 + 15), "2回目はコンボ1本分のボーナスが乗る");
});

test("間違ったシュートに投入するとライフが減り、コンボがリセットされる", () => {
  const world = new ShredderLineWorld();
  forceSpawn(world);
  const piece = world.pieces[0];
  const wrongIndex = (SCRAP_COLORS.indexOf(piece.color) + 1) % SCRAP_COLORS.length;

  const result = world.sortPiece(piece.id, wrongIndex);

  assert.equal(result, "wrong");
  assert.equal(world.score, 0);
  assert.equal(world.lives, LIVES_MAX - 1);
  assert.equal(world.pieces.length, 0);
});

test("存在しないidや範囲外のchuteIndexへの投入は無効で状態を変えない", () => {
  const world = new ShredderLineWorld();
  forceSpawn(world);
  const piece = world.pieces[0];

  assert.equal(world.sortPiece(9999, 0), "invalid", "存在しないidは無効");
  assert.equal(world.sortPiece(piece.id, -1), "invalid", "範囲外(負)のchuteIndexは無効");
  assert.equal(world.sortPiece(piece.id, SCRAP_COLORS.length), "invalid", "範囲外(超過)は無効");
  assert.equal(world.score, 0);
  assert.equal(world.lives, LIVES_MAX);
  assert.equal(world.pieces.length, 1, "無効な操作ではスクラップは消えない");
});

test("シュレッダーの刃まで達すると未分別のまま失われ、ライフが減る", () => {
  const world = new ShredderLineWorld();
  forceSpawn(world);
  let missed: { pieceId: number; color: string } | null = null;
  world.onMiss = (event) => {
    missed = event;
  };

  world.step(100); // 十分大きいdtで必ずシュレッダーまで到達させる(この1stepで次のスポーンも起きる)

  assert.ok(missed, "onMissが発火する");
  assert.equal(world.lives, LIVES_MAX - 1);
  assert.equal(
    world.pieces.length,
    1,
    "失われた直後、同じstep内の出現間隔切れで次のスクラップが1つ現れる",
  );
  assert.equal(world.pieces[0].progress, 0, "新しく現れた分はまだ進んでいない");
});

test("掴んでいる間はベルトが進まず、離すと再開する", () => {
  const world = new ShredderLineWorld();
  forceSpawn(world);
  const piece = world.pieces[0];

  const grabbed = world.grabPiece(piece.id);
  assert.equal(grabbed, true);

  world.step(100);
  const stillHeld = world.pieces.find((p) => p.id === piece.id);
  assert.ok(stillHeld, "掴んでいる間はシュレッダーに到達せず消えない");
  assert.equal(stillHeld?.progress, 0, "掴んでいる間は進行度が変化しない");

  world.releasePiece(piece.id);
  world.step(1 / 60);
  const released = world.pieces.find((p) => p.id === piece.id);
  assert.ok(released, "離した直後もまだベルト上にある");
  assert.ok((released?.progress ?? 0) > 0, "離すとベルトの進行が再開する");
});

test("既に掴んでいるスクラップは再度掴めない", () => {
  const world = new ShredderLineWorld();
  forceSpawn(world);
  const piece = world.pieces[0];

  assert.equal(world.grabPiece(piece.id), true);
  assert.equal(world.grabPiece(piece.id), false, "二重に掴むことはできない");
});

test("ライフが0になるとゲームオーバーになり、以降は状態が変化しない", () => {
  const world = new ShredderLineWorld();

  for (let i = 0; i < LIVES_MAX; i++) {
    forceSpawn(world);
    const piece = world.pieces[0];
    const wrongIndex = (SCRAP_COLORS.indexOf(piece.color) + 1) % SCRAP_COLORS.length;
    world.sortPiece(piece.id, wrongIndex);
  }

  assert.equal(world.isOver, true);
  assert.equal(world.lives, 0);

  const scoreBefore = world.score;
  world.step(5);
  assert.equal(world.pieces.length, 0, "ゲームオーバー後はstepしてもスポーンしない");
  assert.equal(world.score, scoreBefore);
  assert.equal(world.sortPiece(0, 0), "invalid", "ゲームオーバー後の投入は常に無効");
  assert.equal(world.grabPiece(0), false, "ゲームオーバー後は掴めない");
});

test("reset()で最初の状態に戻る", () => {
  const world = new ShredderLineWorld();
  forceSpawn(world);
  const piece = world.pieces[0];
  world.sortPiece(piece.id, SCRAP_COLORS.indexOf(piece.color));

  world.reset();

  assert.equal(world.pieces.length, 0);
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.lives, LIVES_MAX);
  assert.equal(world.isOver, false);
});

test("連続成功で難易度が上がる(ベルト速度上昇・出現間隔短縮)", () => {
  const world = new ShredderLineWorld();
  const initialBeltSpeed = world.beltSpeed;
  const initialSpawnInterval = world.spawnInterval;

  for (let i = 0; i < 6; i++) {
    forceSpawn(world);
    const piece = world.pieces[0];
    world.sortPiece(piece.id, SCRAP_COLORS.indexOf(piece.color));
  }

  assert.ok(world.beltSpeed > initialBeltSpeed, "ベルト速度が上がる");
  assert.ok(world.spawnInterval < initialSpawnInterval, "出現間隔が短くなる");
});

test("ベルト上のスクラップ数には上限があり、無限に増え続けない", () => {
  const world = new ShredderLineWorld();
  const dt = world.spawnInterval; // 何も投入しないので出現間隔は一定のまま

  for (let i = 0; i < 10; i++) {
    world.step(dt);
  }

  assert.ok(world.pieces.length > 0, "そもそもスポーンはしている");
  assert.ok(
    world.pieces.length <= MAX_PIECES_ON_BELT,
    `上限(${MAX_PIECES_ON_BELT}個)を超えて増えない`,
  );
});

test("mostUrgentPieceIdは掴んでいないスクラップの中で最も進んだものを返す", () => {
  const world = new ShredderLineWorld();
  forceSpawn(world);
  const first = world.pieces[0];
  // ちょうど出現間隔分だけ進めると、1つ目だけ進行度が乗った状態で2つ目がスポーンする。
  world.step(world.spawnInterval);
  assert.equal(world.pieces.length, 2, "2つ目が追加されている");

  const urgent = world.mostUrgentPieceId();
  assert.equal(urgent, first.id, "先にスポーンした分だけ進んでいるほうが最優先");

  world.grabPiece(first.id);
  const urgentAfterGrab = world.mostUrgentPieceId();
  assert.notEqual(urgentAfterGrab, first.id, "掴んでいるものは対象から外れる");
});

test("スクラップが1つも無いときmostUrgentPieceIdはnullを返す", () => {
  const world = new ShredderLineWorld();
  assert.equal(world.mostUrgentPieceId(), null);
});
