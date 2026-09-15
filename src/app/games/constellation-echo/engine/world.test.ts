import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ConstellationEchoWorld,
  INITIAL_SEQUENCE_LENGTH,
  MAX_SEQUENCE_LENGTH,
  STAR_COUNT,
  START_LIVES,
} from "./world.ts";

const WIDTH = 960;
const HEIGHT = 540;
const FRAME = 1 / 60;

function assertFinite(world: ConstellationEchoWorld, label: string): void {
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.timeRemaining), `${label}: timeRemaining`);
  for (const star of world.stars) {
    assert.ok(Number.isFinite(star.x) && Number.isFinite(star.y), `${label}: star position`);
  }
}

/** previewフェーズを最後まで進めてrecallフェーズに入るまで時間を進める。 */
function advanceThroughPreview(world: ConstellationEchoWorld): void {
  for (let i = 0; i < 600 && world.phase === "preview"; i++) world.step(FRAME);
  assert.equal(world.phase, "recall", "previewを終えるとrecallに入る");
}

/** 現在のsequenceを正しい順にすべてタップする。 */
function solveSequence(world: ConstellationEchoWorld): void {
  for (const starId of world.sequence) world.selectStar(starId);
}

test("起動直後は星と手順が揃っており、previewフェーズから始まる", () => {
  const world = new ConstellationEchoWorld(WIDTH, HEIGHT);

  assert.equal(world.stars.length, STAR_COUNT, "星が指定数配置されている");
  assert.equal(world.sequence.length, INITIAL_SEQUENCE_LENGTH, "初期手順の長さ");
  assert.equal(world.phase, "preview");
  assert.equal(world.round, 1);
  assert.equal(world.score, 0);
  assert.equal(world.lives, START_LIVES);
  assert.equal(world.isOver, false);

  // sequenceの中身は重複のない有効な星idの並び
  const uniqueIds = new Set(world.sequence);
  assert.equal(uniqueIds.size, world.sequence.length, "手順内に重複がない");
  for (const id of world.sequence) {
    assert.ok(id >= 0 && id < STAR_COUNT, "手順の星idが範囲内");
  }
  assertFinite(world, "起動直後");
});

test("previewで手順どおりに星が光り、recallへ遷移する", () => {
  const world = new ConstellationEchoWorld(WIDTH, HEIGHT);
  const revealedOrder: number[] = [];
  world.onStarRevealed = ({ star, order }) => {
    assert.equal(order, revealedOrder.length, "revealはsequence順に発火する");
    revealedOrder.push(star.id);
  };

  advanceThroughPreview(world);

  assert.deepEqual(revealedOrder, world.sequence, "光った星の順序がsequenceと一致する");
  assert.equal(world.revealedCount, world.sequence.length);
  assert.ok(world.timeRemaining > 0, "recallフェーズの残り時間が設定される");
});

test("正しい順にタップし続けるとラウンドをクリアして得点し、次のラウンドは手順が1つ長くなる", () => {
  const world = new ConstellationEchoWorld(WIDTH, HEIGHT);
  const cleared: { round: number; points: number }[] = [];
  world.onRoundCleared = (event) => cleared.push(event);

  advanceThroughPreview(world);
  const firstSequenceLength = world.sequence.length;
  solveSequence(world);

  assert.equal(cleared.length, 1, "1ラウンドクリアした");
  assert.ok(cleared[0].points > 0, "得点が入っている");
  assert.equal(world.score, cleared[0].points);
  // world.phaseを直接assertすると、strict assertのasserts型guardでworld.phaseの型自体が
  // "success"に狭まり、後続のwhileループでの比較がTS2367（重なりのない型同士の比較）になる。
  // ローカル変数に写してから比較することでプロパティ側の型を狭めないようにする。
  const phaseAfterClear: string = world.phase;
  assert.equal(phaseAfterClear, "success");
  assert.equal(world.round, 2, "ラウンドが進む");

  // successの余韻フェーズを抜けて次のラウンドが始まる
  for (let i = 0; i < 300 && world.phase !== "preview"; i++) world.step(FRAME);
  assert.equal(world.phase, "preview");
  assert.equal(world.sequence.length, firstSequenceLength + 1, "次の手順は1つ長くなる");
  assertFinite(world, "1ラウンドクリア後");
});

test("違う星をタップするとミスになりライフが減るが、ラウンド番号は変わらない", () => {
  const world = new ConstellationEchoWorld(WIDTH, HEIGHT);
  const mistakes: { reason: string; livesRemaining: number }[] = [];
  world.onMistake = (event) => mistakes.push(event);

  advanceThroughPreview(world);
  const roundBefore = world.round;
  const wrongId = (world.sequence[0] + 1) % STAR_COUNT;

  world.selectStar(wrongId);

  assert.equal(mistakes.length, 1);
  assert.equal(mistakes[0].reason, "wrongStar");
  assert.equal(world.lives, START_LIVES - 1);
  const phaseAfterMistake: string = world.phase;
  assert.equal(phaseAfterMistake, "mistake");
  assert.equal(world.round, roundBefore, "ミスではラウンド番号は増えない");

  // mistakeの余韻フェーズを抜けると新しい星配置でpreviewからやり直す
  for (let i = 0; i < 300 && world.phase !== "preview"; i++) world.step(FRAME);
  assert.equal(world.phase, "preview");
  assertFinite(world, "ミス後");
});

test("recallの制限時間内にタップし終えないとタイムアウトでミスになる", () => {
  const world = new ConstellationEchoWorld(WIDTH, HEIGHT);
  advanceThroughPreview(world);

  const mistakes: string[] = [];
  world.onMistake = (event) => mistakes.push(event.reason);

  for (let i = 0; i < 2000 && world.phase === "recall"; i++) world.step(FRAME);

  assert.equal(mistakes.length, 1);
  assert.equal(mistakes[0], "timeout");
  assert.equal(world.lives, START_LIVES - 1);
});

test("ライフが尽きるとゲームオーバーになり、以降のtapやstepで状態が壊れない", () => {
  const world = new ConstellationEchoWorld(WIDTH, HEIGHT);

  for (let life = START_LIVES; life > 0; life--) {
    advanceThroughPreview(world);
    const wrongId = (world.sequence[0] + 1) % STAR_COUNT;
    world.selectStar(wrongId);
    if (world.isOver) break;
    for (let i = 0; i < 300 && world.phase !== "preview"; i++) world.step(FRAME);
  }

  assert.equal(world.isOver, true, "ライフが尽きてゲームオーバーになる");
  assert.equal(world.lives, 0);
  assert.equal(world.phase, "gameOver");

  // ゲームオーバー後に操作・進行しても壊れない
  world.selectStar(world.sequence[0] ?? 0);
  world.step(FRAME);
  assertFinite(world, "ゲームオーバー後");

  world.reset();
  assert.equal(world.isOver, false);
  assert.equal(world.score, 0);
  assert.equal(world.lives, START_LIVES);
  assert.equal(world.round, 1);
  assert.equal(world.phase, "preview");
});

test("手順の長さはSTAR_COUNTを超えて伸びない", () => {
  const world = new ConstellationEchoWorld(WIDTH, HEIGHT);

  for (let i = 0; i < MAX_SEQUENCE_LENGTH + 3; i++) {
    advanceThroughPreview(world);
    solveSequence(world);
    for (let j = 0; j < 300 && world.phase !== "preview"; j++) world.step(FRAME);
  }

  assert.ok(world.sequence.length <= MAX_SEQUENCE_LENGTH, "手順の長さがSTAR_COUNT以下に収まる");
});

test("previewフェーズ中や一時停止相当のタイミングでタップしても無視される（recallフェーズ以外は無反応）", () => {
  const world = new ConstellationEchoWorld(WIDTH, HEIGHT);
  const scoreBefore = world.score;
  const roundBefore = world.round;

  // まだpreview中なのでタップしても何も起きない
  world.selectStar(world.sequence[0]);

  assert.equal(world.score, scoreBefore);
  assert.equal(world.round, roundBefore);
  assert.equal(world.phase, "preview");
});

test("画面サイズが変わっても星は画面内に収まり続ける", () => {
  const world = new ConstellationEchoWorld(WIDTH, HEIGHT);

  world.resize(375, 720);
  for (const star of world.stars) {
    assert.ok(star.x >= -1 && star.x <= 376, "星が画面内(横)");
    assert.ok(star.y >= -1 && star.y <= 721, "星が画面内(縦)");
  }
  assertFinite(world, "リサイズ後");

  world.resize(1200, 800);
  for (const star of world.stars) {
    assert.ok(star.x >= -1 && star.x <= 1201, "再リサイズ後も星が画面内(横)");
    assert.ok(star.y >= -1 && star.y <= 801, "再リサイズ後も星が画面内(縦)");
  }
});

test("findStarAtは星の近くだけを拾う", () => {
  const world = new ConstellationEchoWorld(WIDTH, HEIGHT);
  const star = world.stars[0];

  assert.equal(world.findStarAt(star.x, star.y)?.id, star.id);
  assert.equal(world.findStarAt(star.x + 1000, star.y + 1000), undefined);
});
