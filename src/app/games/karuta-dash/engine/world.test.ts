import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  INITIAL_CARD_COUNT,
  KarutaDashWorld,
  MAX_CARD_COUNT,
  START_LIVES,
} from "./world.ts";

const WIDTH = 960;
const HEIGHT = 540;
const FRAME = 1 / 60;

function assertFinite(world: KarutaDashWorld, label: string): void {
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.rivalProgress), `${label}: rivalProgress`);
  for (const card of world.cards) {
    assert.ok(Number.isFinite(card.x) && Number.isFinite(card.y), `${label}: card position`);
  }
}

/** 現在の目標ラベルを持つ札を見つけて取る。 */
function grabTarget(world: KarutaDashWorld): void {
  const card = world.cards.find((c) => c.label === world.targetLabel);
  assert.ok(card, "目標の札が盤面に存在する");
  if (card) world.grabCard(card.id);
}

/** 目標ではない(ハズレの)札を1枚見つける。 */
function findWrongCard(world: KarutaDashWorld) {
  const card = world.cards.find((c) => c.label !== world.targetLabel);
  assert.ok(card, "ハズレの札が盤面に存在する");
  return card;
}

test("起動直後は札が指定数配置され、目標ラベルは盤面のいずれかの札と一致する", () => {
  const world = new KarutaDashWorld(WIDTH, HEIGHT);

  assert.equal(world.cards.length, INITIAL_CARD_COUNT, "初期の札数");
  assert.equal(world.round, 1);
  assert.equal(world.score, 0);
  assert.equal(world.lives, START_LIVES);
  assert.equal(world.isOver, false);
  assert.equal(world.rivalProgress, 0);
  assert.ok(
    world.cards.some((c) => c.label === world.targetLabel),
    "目標ラベルが盤面の札のどれかと一致する",
  );

  const uniqueLabels = new Set(world.cards.map((c) => c.label));
  assert.equal(uniqueLabels.size, world.cards.length, "札のラベルに重複がない");
  assertFinite(world, "起動直後");
});

test("正しい札を取ると得点し盤面から消え、次の目標が残りの札の中から選ばれる", () => {
  const world = new KarutaDashWorld(WIDTH, HEIGHT);
  const captured: { cardId: number; points: number; comboAfter: number }[] = [];
  world.onCardCaptured = (event) => captured.push(event);

  const cardCountBefore = world.cards.length;
  const targetBefore = world.cards.find((c) => c.label === world.targetLabel);
  assert.ok(targetBefore);

  grabTarget(world);

  assert.equal(captured.length, 1, "1回捕獲イベントが発火する");
  assert.ok(captured[0].points > 0, "得点が入っている");
  assert.equal(world.score, captured[0].points);
  assert.equal(world.combo, 1, "コンボが1になる");
  assert.equal(world.cards.length, cardCountBefore - 1, "札が1枚減る");
  assert.ok(
    targetBefore && !world.cards.some((c) => c.id === targetBefore.id),
    "取った札は盤面から消える",
  );
  assert.ok(
    world.cards.some((c) => c.label === world.targetLabel),
    "新しい目標も盤面の札のどれかと一致する",
  );
  assert.equal(world.rivalProgress, 0, "捕獲後はライバルの進行度がリセットされる");
  assertFinite(world, "1枚捕獲後");
});

test("連続で正しい札を取るとコンボ加算で得点が伸びる", () => {
  const world = new KarutaDashWorld(WIDTH, HEIGHT);

  grabTarget(world);
  const firstPoints = world.score;
  grabTarget(world);
  const secondGain = world.score - firstPoints;

  assert.ok(secondGain > 0, "2枚目でも得点が入る");
  assert.equal(world.combo, 2, "コンボが2になる");
});

test("ハズレの札を取るとライフが減りコンボが0に戻るが、目標とライバルの進行度は変わらない", () => {
  const world = new KarutaDashWorld(WIDTH, HEIGHT);
  grabTarget(world); // コンボを1にしておく
  for (let i = 0; i < 20; i++) world.step(FRAME); // ライバルの進行度を少し進めておく(0のままだと変化なしを確認できない)

  const targetBefore = world.targetLabel;
  const rivalProgressBefore = world.rivalProgress;
  const wrongCard = findWrongCard(world);
  const cardCountBefore = world.cards.length;

  const misses: { reason: string; livesRemaining: number }[] = [];
  world.onMiss = (event) => misses.push(event);

  world.grabCard(wrongCard.id);

  assert.equal(misses.length, 1);
  assert.equal(misses[0].reason, "wrongCard");
  assert.equal(world.lives, START_LIVES - 1);
  assert.equal(world.combo, 0, "ハズレでコンボが0に戻る");
  assert.equal(world.targetLabel, targetBefore, "ハズレでは目標が変わらない");
  assert.equal(world.rivalProgress, rivalProgressBefore, "ハズレではライバルの進行度が変わらない");
  assert.equal(world.cards.length, cardCountBefore, "ハズレの札は盤面に残る");
  assertFinite(world, "ハズレ後");
});

test("ハズレ直後は猶予時間があり、少し経ってからライバルの進行度が進み始める", () => {
  const world = new KarutaDashWorld(WIDTH, HEIGHT);
  const wrongCard = findWrongCard(world);
  world.grabCard(wrongCard.id);

  assert.equal(world.rivalProgress, 0);
  for (let i = 0; i < 20; i++) world.step(FRAME); // 猶予(0.6秒)の範囲内
  assert.equal(world.rivalProgress, 0, "猶予中はライバルの進行度が進まない");

  for (let i = 0; i < 120; i++) world.step(FRAME); // 猶予を抜けて十分進める
  assert.ok(world.rivalProgress > 0, "猶予を抜けるとライバルの進行度が進み始める");
});

test("ライバルの進行度が1に達すると目標の札が横取りされ、ライフが減って次の目標に移る", () => {
  const world = new KarutaDashWorld(WIDTH, HEIGHT);
  const cardCountBefore = world.cards.length;
  const targetLabelBefore = world.targetLabel;

  const misses: { reason: string; cardId: number | null; label: string | null }[] = [];
  world.onMiss = (event) => misses.push(event);

  for (let i = 0; i < 1000 && misses.length === 0 && !world.isOver; i++) world.step(FRAME);

  assert.equal(misses.length, 1, "横取りのミスイベントが1回発火する");
  assert.equal(misses[0].reason, "snatchedByRival");
  assert.equal(misses[0].label, targetLabelBefore, "横取りされた札のラベルが目標と一致する");
  assert.equal(world.lives, START_LIVES - 1);
  assert.equal(world.cards.length, cardCountBefore - 1, "横取りされた札は盤面から消える");
  assert.notEqual(world.targetLabel, "", "次の目標が設定される");
  assert.equal(world.rivalProgress, 0, "横取り後はライバルの進行度がリセットされる");
  assertFinite(world, "横取り後");
});

test("盤面の札を全て取り切るとラウンドが進み、札数が増えて得点にクリアボーナスが入る", () => {
  const world = new KarutaDashWorld(WIDTH, HEIGHT);
  const cleared: { round: number; bonus: number }[] = [];
  world.onRoundCleared = (event) => cleared.push(event);

  const initialCount = world.cards.length;
  for (let i = 0; i < initialCount; i++) grabTarget(world);

  assert.equal(cleared.length, 1, "ラウンドクリアイベントが1回発火する");
  assert.ok(cleared[0].bonus > 0, "クリアボーナスがある");
  assert.equal(world.round, 2, "ラウンドが進む");
  assert.equal(
    world.cards.length,
    Math.min(MAX_CARD_COUNT, INITIAL_CARD_COUNT + 2),
    "次のラウンドは札数が増える",
  );
  assertFinite(world, "ラウンドクリア後");
});

test("ラウンドを重ねても札数はMAX_CARD_COUNTを超えない", () => {
  const world = new KarutaDashWorld(WIDTH, HEIGHT);

  for (let round = 0; round < 10; round++) {
    const count = world.cards.length;
    for (let i = 0; i < count; i++) grabTarget(world);
  }

  assert.ok(world.cards.length <= MAX_CARD_COUNT, "札数がMAX_CARD_COUNT以下に収まる");
});

test("ライフが尽きるとゲームオーバーになり、以降の操作やstepで状態が壊れない", () => {
  const world = new KarutaDashWorld(WIDTH, HEIGHT);

  for (let life = START_LIVES; life > 0; life--) {
    const wrongCard = findWrongCard(world);
    world.grabCard(wrongCard.id);
  }

  assert.equal(world.isOver, true, "ライフが尽きてゲームオーバーになる");
  assert.equal(world.lives, 0);

  // ゲームオーバー後に操作・進行しても壊れない
  world.grabCard(world.cards[0]?.id ?? 0);
  world.step(FRAME);
  assertFinite(world, "ゲームオーバー後");

  world.reset();
  assert.equal(world.isOver, false);
  assert.equal(world.score, 0);
  assert.equal(world.lives, START_LIVES);
  assert.equal(world.round, 1);
  assert.equal(world.cards.length, INITIAL_CARD_COUNT);
});

test("既に取られた札や存在しないidをgrabCardしても何も起きない", () => {
  const world = new KarutaDashWorld(WIDTH, HEIGHT);
  const targetCard = world.cards.find((c) => c.label === world.targetLabel);
  assert.ok(targetCard);
  if (!targetCard) return;

  grabTarget(world);
  const scoreAfterCapture = world.score;
  const livesAfterCapture = world.lives;

  world.grabCard(targetCard.id); // もう盤面に無いid
  world.grabCard(99999); // 存在しないid

  assert.equal(world.score, scoreAfterCapture, "存在しない札への操作で得点が変わらない");
  assert.equal(world.lives, livesAfterCapture, "存在しない札への操作でライフが変わらない");
});

test("画面サイズが変わっても札とセレクタは画面内に収まり続ける", () => {
  const world = new KarutaDashWorld(WIDTH, HEIGHT);

  world.resize(375, 720);
  for (const card of world.cards) {
    assert.ok(card.x >= -1 && card.x <= 376, "札が画面内(横)");
    assert.ok(card.y >= -1 && card.y <= 721, "札が画面内(縦)");
  }
  assertFinite(world, "リサイズ後");

  world.resize(1200, 800);
  for (const card of world.cards) {
    assert.ok(card.x >= -1 && card.x <= 1201, "再リサイズ後も札が画面内(横)");
    assert.ok(card.y >= -1 && card.y <= 801, "再リサイズ後も札が画面内(縦)");
  }
});

test("findCardAtは札の矩形周辺だけを拾う", () => {
  const world = new KarutaDashWorld(WIDTH, HEIGHT);
  const card = world.cards[0];

  assert.equal(world.findCardAt(card.x, card.y)?.id, card.id);
  assert.equal(
    world.findCardAt(card.x + CARD_WIDTH, card.y + CARD_HEIGHT),
    undefined,
    "離れた場所は拾わない",
  );
});

test("セレクタの移動は画面内に制限され、grabAtSelectorでその位置の札を取れる", () => {
  const world = new KarutaDashWorld(WIDTH, HEIGHT);

  world.setSelectorPosition(-500, -500);
  assert.equal(world.selectorX, 0, "画面外(負)に出ない");
  assert.equal(world.selectorY, 0, "画面外(負)に出ない");

  world.setSelectorPosition(100000, 100000);
  assert.equal(world.selectorX, world.width, "画面外(正)に出ない");
  assert.equal(world.selectorY, world.height, "画面外(正)に出ない");

  const targetCard = world.cards.find((c) => c.label === world.targetLabel);
  assert.ok(targetCard);
  if (!targetCard) return;

  world.setSelectorPosition(targetCard.x, targetCard.y);
  world.grabAtSelector();
  assert.equal(world.combo, 1, "セレクタ位置の正しい札を取れる");
});
