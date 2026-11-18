import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BASE_ROUND_SECONDS,
  normalizeAngle,
  PIECE_RADIUS,
  roundSeconds,
  SHAPE_IDS,
  SilhouetteBoardWorld,
} from "./board.ts";

const WIDTH = 960;
const HEIGHT = 540;
const FRAME = 1 / 60;

function assertFinite(world: SilhouetteBoardWorld, label: string): void {
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.timeRemaining), `${label}: timeRemaining`);
  for (const piece of world.pieces) {
    assert.ok(Number.isFinite(piece.x) && Number.isFinite(piece.y), `${label}: piece position`);
  }
  for (const slot of world.slots) {
    assert.ok(Number.isFinite(slot.x) && Number.isFinite(slot.y), `${label}: slot position`);
  }
}

/** ピースを同じ形状の枠の真上（位置のみ）へ移動させる。回転は呼び出し側の責務。 */
function moveOntoMatchingSlot(world: SilhouetteBoardWorld, shapeId: (typeof SHAPE_IDS)[number]) {
  const piece = world.pieces.find((p) => p.shapeId === shapeId);
  const slot = world.slots.find((s) => s.shapeId === shapeId);
  assert.ok(piece && slot, `${shapeId} のピースと枠が両方存在する`);
  if (!piece || !slot) return;
  world.setPiecePosition(piece.id, slot.x, slot.y);
}

test("起動直後は7ピース・7枠が未配置で揃っている", () => {
  const world = new SilhouetteBoardWorld(WIDTH, HEIGHT);

  assert.equal(world.pieces.length, 7);
  assert.equal(world.slots.length, 7);
  assert.equal(world.placedCount, 0);
  assert.equal(world.totalCount, 7);
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.round, 1);
  assert.equal(world.isOver, false);
  assert.equal(world.timeRemaining, roundSeconds(1));
  assert.equal(roundSeconds(1), BASE_ROUND_SECONDS);

  // 全ての形状が1枚ずつ、ピース・枠の双方に存在する
  for (const shapeId of SHAPE_IDS) {
    assert.equal(world.pieces.filter((p) => p.shapeId === shapeId).length, 1);
    assert.equal(world.slots.filter((s) => s.shapeId === shapeId).length, 1);
  }

  // ラウンド1は回転なしで合わせられる（全て正立）
  for (const slot of world.slots) assert.equal(slot.targetRotationDeg, 0);
  for (const piece of world.pieces) assert.equal(piece.rotationDeg, 0);
});

test("ピースを掴んで動かせる（配置済みは掴めない・画面外にはみ出さない）", () => {
  const world = new SilhouetteBoardWorld(WIDTH, HEIGHT);
  const piece = world.pieces[0];

  assert.equal(world.findPieceAt(piece.x, piece.y)?.id, piece.id);
  assert.equal(world.findPieceAt(piece.x + 9999, piece.y + 9999), undefined);

  world.setPiecePosition(piece.id, 400, 300);
  assert.equal(piece.x, 400);
  assert.equal(piece.y, 300);

  world.setPiecePosition(piece.id, -9999, 9999);
  assert.ok(piece.x >= 0 && piece.x <= WIDTH);
  assert.ok(piece.y >= 0 && piece.y <= HEIGHT);

  piece.isPlaced = true;
  assert.equal(world.findPieceAt(piece.x, piece.y), undefined, "配置済みのピースは掴めない");
  world.setPiecePosition(piece.id, 10, 10);
  assert.notEqual(piece.x, 10, "配置済みのピースは動かせない");
});

test("ピースは45度刻みで回転し、一周で0度に戻る（配置済みは回らない）", () => {
  const world = new SilhouetteBoardWorld(WIDTH, HEIGHT);
  const piece = world.pieces[0];

  assert.equal(piece.rotationDeg, 0);
  world.rotatePiece(piece.id);
  assert.equal(piece.rotationDeg, 45);

  for (let i = 0; i < 7; i++) world.rotatePiece(piece.id);
  assert.equal(piece.rotationDeg, 0, "8回で一周して0度に戻る");

  world.rotatePiece(piece.id, -45);
  assert.equal(normalizeAngle(-45), 315);
  assert.equal(piece.rotationDeg, 315, "負方向にも回せて正規化される");

  piece.isPlaced = true;
  const before = piece.rotationDeg;
  world.rotatePiece(piece.id);
  assert.equal(piece.rotationDeg, before, "配置済みのピースは回転しない");
});

test("位置や角度が合わないと枠にはまらず、コンボが崩れる", () => {
  const world = new SilhouetteBoardWorld(WIDTH, HEIGHT);
  const piece = world.pieces.find((p) => p.shapeId === "triangle");
  assert.ok(piece);
  if (!piece) return;

  // まずは正しく1つはめてコンボを作る
  moveOntoMatchingSlot(world, "triangle");
  assert.equal(world.tryPlacePiece(piece.id), true);
  assert.equal(world.combo, 1);

  // 別のピースを、枠から離れた位置で試す → 失敗してコンボが0に戻る
  const arrowPiece = world.pieces.find((p) => p.shapeId === "arrow");
  assert.ok(arrowPiece);
  if (!arrowPiece) return;
  world.setPiecePosition(arrowPiece.id, 5, 5);
  const scoreBefore = world.score;
  assert.equal(world.tryPlacePiece(arrowPiece.id), false);
  assert.equal(world.combo, 0, "失敗するとコンボが崩れる");
  assert.equal(world.score, scoreBefore, "失敗時は得点が増えない");
  assert.equal(arrowPiece.isPlaced, false);
});

test("位置と角度の両方が合えばはまり、コンボで得点が増える", () => {
  const world = new SilhouetteBoardWorld(WIDTH, HEIGHT);
  const events: number[] = [];
  world.onPieceSeated = ({ points }) => events.push(points);

  moveOntoMatchingSlot(world, "triangle");
  const trianglePiece = world.pieces.find((p) => p.shapeId === "triangle");
  assert.ok(trianglePiece);
  if (!trianglePiece) return;
  assert.equal(world.tryPlacePiece(trianglePiece.id), true);
  assert.equal(trianglePiece.isPlaced, true);
  assert.equal(world.placedCount, 1);

  const slot = world.slots.find((s) => s.shapeId === "triangle");
  assert.equal(slot?.occupiedBy, trianglePiece.id);
  assert.equal(trianglePiece.x, slot?.x);
  assert.equal(trianglePiece.y, slot?.y);

  moveOntoMatchingSlot(world, "arrow");
  const arrowPiece = world.pieces.find((p) => p.shapeId === "arrow");
  assert.ok(arrowPiece);
  if (!arrowPiece) return;
  assert.equal(world.tryPlacePiece(arrowPiece.id), true);

  assert.equal(events.length, 2);
  assert.ok(events[1] > events[0], "連続成功でコンボボーナスが増える");
  assert.equal(world.score, events[0] + events[1]);
  assertFinite(world, "2つ配置後");
});

test("7ピース全てはめ切るとラウンドが進み、枠と制限時間が更新される", () => {
  const world = new SilhouetteBoardWorld(WIDTH, HEIGHT);
  const roundEvents: { round: number; bonus: number }[] = [];
  world.onRoundCompleted = (event) => roundEvents.push(event);

  for (const shapeId of SHAPE_IDS) {
    moveOntoMatchingSlot(world, shapeId);
    const piece = world.pieces.find((p) => p.shapeId === shapeId);
    assert.ok(piece);
    if (!piece) continue;
    world.tryPlacePiece(piece.id);
  }

  assert.equal(roundEvents.length, 1);
  assert.equal(roundEvents[0].round, 1, "完了したのはラウンド1");
  assert.ok(roundEvents[0].bonus > 0, "クリア時間ボーナスが入る");

  assert.equal(world.round, 2);
  assert.equal(world.placedCount, 0, "次ラウンドは全て未配置に戻る");
  assert.equal(world.pieces.length, 7);
  assert.equal(world.slots.length, 7);
  assert.equal(world.timeRemaining, roundSeconds(2));
  assert.ok(roundSeconds(2) < roundSeconds(1), "ラウンドが進むと制限時間が短くなる");

  // ラウンド2は向きがずれているので、回さずに置こうとすると失敗する
  const idx = SHAPE_IDS.indexOf("triangle");
  const piece = world.pieces.find((p) => p.shapeId === "triangle");
  const slot = world.slots.find((s) => s.shapeId === "triangle");
  assert.ok(piece && slot);
  if (!piece || !slot) return;
  assert.notEqual(
    piece.rotationDeg,
    slot.targetRotationDeg,
    "ラウンド2は初期角度が目標とずれている",
  );
  world.setPiecePosition(piece.id, slot.x, slot.y);
  assert.equal(world.tryPlacePiece(piece.id), false, "回転させないと合わない");

  // 4回(180度)回すとちょうど目標角度に一致する
  for (let i = 0; i < 4; i++) world.rotatePiece(piece.id);
  assert.equal(piece.rotationDeg, slot.targetRotationDeg);
  assert.equal(world.tryPlacePiece(piece.id), true, "正しい向きに合わせればはまる");
  void idx;
});

test("制限時間が尽きるとラウンドが終了し、進めても壊れない", () => {
  const world = new SilhouetteBoardWorld(WIDTH, HEIGHT);

  for (let i = 0; i < 10_000 && !world.isOver; i++) {
    world.step(FRAME);
    assertFinite(world, "ラウンド中");
  }

  assert.equal(world.isOver, true);
  assert.equal(world.timeRemaining, 0);

  world.step(FRAME);
  assertFinite(world, "終了後");
  assert.equal(world.timeRemaining, 0, "終了後は時間が変わらない");

  world.reset();
  assert.equal(world.isOver, false);
  assert.equal(world.score, 0);
  assert.equal(world.round, 1);
  assert.equal(world.placedCount, 0);
  assert.equal(world.timeRemaining, roundSeconds(1));
});

test("画面サイズが変わってもピース・枠は画面内に収まる", () => {
  const world = new SilhouetteBoardWorld(WIDTH, HEIGHT);

  world.resize(375, 720);
  for (const piece of world.pieces) {
    assert.ok(piece.x >= 0 && piece.x <= 375, "ピースが画面内");
    assert.ok(piece.y >= 0 && piece.y <= 720, "ピースが画面内");
  }
  for (const slot of world.slots) {
    assert.ok(slot.x >= 0 && slot.x <= 375, "枠が画面内");
    assert.ok(slot.y >= 0 && slot.y <= 720, "枠が画面内");
  }

  world.resize(780, 390);
  for (const piece of world.pieces) {
    assert.ok(piece.x >= 0 && piece.x <= 780, "横長でもピースが画面内");
    assert.ok(piece.y >= 0 && piece.y <= 390, "横長でもピースが画面内");
  }
  assertFinite(world, "リサイズ後");
  assert.ok(PIECE_RADIUS > 0);
});
