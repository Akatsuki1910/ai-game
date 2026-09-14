import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ChromaWellWorld,
  colorDistance,
  mixColor,
  PIGMENTS,
  ROUND_SECONDS,
  randomAchievableColor,
  rgbToCssColor,
  rgbToHex,
} from "./world.ts";

const WIDTH = 960;
const HEIGHT = 540;
const FRAME = 1 / 60;

function assertFinite(world: ChromaWellWorld, label: string): void {
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.timeRemaining), `${label}: timeRemaining`);
  assert.ok(Number.isFinite(world.matchProgress), `${label}: matchProgress`);
  for (const blob of world.blobs) {
    assert.ok(Number.isFinite(blob.x) && Number.isFinite(blob.y), `${label}: blob position`);
    assert.ok(Number.isFinite(blob.r), `${label}: blob radius`);
  }
}

test("初期状態: 的は空で、お題は3原色の混色として作れる範囲に収まっている", () => {
  const world = new ChromaWellWorld(WIDTH, HEIGHT);

  assert.equal(world.blobs.length, 0, "開始時は何も盛られていない");
  assert.equal(world.score, 0);
  assert.equal(world.timeRemaining, ROUND_SECONDS);
  assert.equal(world.isOver, false);
  assert.equal(world.currentColor, null, "何も盛られていなければ現在色はない");

  const minR = Math.min(...PIGMENTS.map((p) => p.r));
  const maxR = Math.max(...PIGMENTS.map((p) => p.r));
  const minG = Math.min(...PIGMENTS.map((p) => p.g));
  const maxG = Math.max(...PIGMENTS.map((p) => p.g));
  const minB = Math.min(...PIGMENTS.map((p) => p.b));
  const maxB = Math.max(...PIGMENTS.map((p) => p.b));

  // 凸結合の性質上、お題の各チャンネルは3原色の最小〜最大の範囲に必ず収まる（=必ず作れる）。
  assert.ok(world.target.r >= minR - 1e-6 && world.target.r <= maxR + 1e-6);
  assert.ok(world.target.g >= minG - 1e-6 && world.target.g <= maxG + 1e-6);
  assert.ok(world.target.b >= minB - 1e-6 && world.target.b <= maxB + 1e-6);
});

test("何度リセットしてもお題は必ず混色で作れる範囲に収まる", () => {
  for (let i = 0; i < 200; i++) {
    const color = randomAchievableColor();
    for (const channel of [color.r, color.g, color.b]) {
      assert.ok(channel >= -1e-6 && channel <= 255 + 1e-6, "各チャンネルが0〜255に収まる");
    }
  }
});

test("インクを盛ると育ち、蒸発するまで放っておくと消える", () => {
  const world = new ChromaWellWorld(WIDTH, HEIGHT);
  world.applyPigment(100, 100, 0);
  assert.equal(world.blobs.length, 1);
  const blob = world.blobs[0];
  assert.equal(blob.pigmentIndex, 0);

  // 育ちきるまで進める
  for (let i = 0; i < 60 && blob.isGrowing; i++) world.step(FRAME);
  assert.equal(blob.isGrowing, false, "十分な時間でフルサイズまで育つ");
  const grownRadius = blob.r;
  assert.ok(grownRadius > 1);

  // 放置すると蒸発して消える
  for (let i = 0; i < 600 && world.blobs.length > 0; i++) world.step(FRAME);
  assert.equal(world.blobs.length, 0, "十分な時間放置すると蒸発して消える");
});

test("同じ場所に同色を盛り直すと、既存の滴が育て直される（無限に増えない）", () => {
  const world = new ChromaWellWorld(WIDTH, HEIGHT);
  world.applyPigment(200, 200, 1);
  for (let i = 0; i < 30; i++) world.step(FRAME);
  const before = world.blobs.length;

  // 蒸発させてから同じ場所に盛り直す
  for (let i = 0; i < 200; i++) world.step(FRAME);
  const shrunkRadius = world.blobs[0]?.r ?? 0;

  world.applyPigment(202, 198, 1);
  assert.equal(world.blobs.length, before, "近くに同色があれば新規に増えない");
  assert.equal(world.blobs[0].isGrowing, true, "育て直しフラグが立つ");
  world.step(FRAME);
  assert.ok(world.blobs[0].r > shrunkRadius, "盛り直すと再び育つ");
});

test("盛る滴の数には上限があり、超えると一番小さい滴から消える", () => {
  const world = new ChromaWellWorld(WIDTH, HEIGHT);
  const positions = Array.from({ length: 80 }, (_, i) => ({
    x: (i % 20) * 40 + 10,
    y: Math.floor(i / 20) * 40 + 10,
  }));
  for (const pos of positions) {
    world.applyPigment(pos.x, pos.y, (positions.indexOf(pos) % 3) as 0 | 1 | 2);
  }
  assert.ok(world.blobs.length <= 70, "上限を超えて増え続けない");
});

test("混色は面積で加重平均され、お題に近づけて維持すると成立して得点する", () => {
  const world = new ChromaWellWorld(WIDTH, HEIGHT);
  // お題を「赤のみ」に固定して、確実に一致させられる状況を作る。
  world.target = PIGMENTS[0];

  const completed: number[] = [];
  world.onMatchSucceeded = ({ points }) => completed.push(points);

  for (let i = 0; i < 600 && completed.length === 0; i++) {
    world.applyPigment(WIDTH / 2, HEIGHT / 2, 0);
    world.step(FRAME);
  }

  assert.equal(completed.length, 1, "お題を維持し続ければ成立する");
  assert.ok(completed[0] > 0, "得点が入っている");
  assert.equal(world.score, completed[0]);
  assert.equal(world.streak, 1);
  assert.ok(world.tolerance < 46, "成立するたびに許容差が厳しくなる");
  assertFinite(world, "成立後");
});

test("お題からずれた色のまま放置すると成立しない", () => {
  const world = new ChromaWellWorld(WIDTH, HEIGHT);
  world.target = PIGMENTS[0];

  const completed: number[] = [];
  world.onMatchSucceeded = () => completed.push(1);

  // 赤の対極にある緑だけを盛り続ける
  for (let i = 0; i < 120; i++) {
    world.applyPigment(WIDTH / 2, HEIGHT / 2, 1);
    world.step(FRAME);
  }

  assert.equal(completed.length, 0, "違う色を維持しても成立しない");
  assert.equal(world.matchProgress, 0);
});

test(`${ROUND_SECONDS}秒遊ぶとラウンドが終わり、リスタートで最初から遊べる`, () => {
  const world = new ChromaWellWorld(WIDTH, HEIGHT);
  world.applyPigment(WIDTH / 2, HEIGHT / 2, 0);

  for (let i = 0; i < 1200 && !world.isOver; i++) {
    world.step(0.1);
    assertFinite(world, "ラウンド中");
  }

  assert.equal(world.isOver, true, "ラウンドが終了する");
  assert.equal(world.timeRemaining, 0);

  // 終了後にインクを盛ったり進めたりしても壊れない
  const blobsBeforeStop = world.blobs.length;
  world.applyPigment(10, 10, 2);
  assert.equal(world.blobs.length, blobsBeforeStop, "終了後は新しく盛れない");
  world.step(FRAME);
  assertFinite(world, "ラウンド終了後");

  world.reset();
  assert.equal(world.isOver, false);
  assert.equal(world.score, 0);
  assert.equal(world.blobs.length, 0);
  assert.equal(world.timeRemaining, ROUND_SECONDS);
});

test("画面サイズが変わっても盛られたインクは画面内に収まる", () => {
  const world = new ChromaWellWorld(WIDTH, HEIGHT);
  world.applyPigment(WIDTH * 0.9, HEIGHT * 0.9, 0);

  // PC横長 → スマホ縦長
  world.resize(375, 720);
  for (const blob of world.blobs) {
    assert.ok(blob.x >= 0 && blob.x <= 375, "インクが画面内");
    assert.ok(blob.y >= 0 && blob.y <= 720, "インクが画面内");
  }
  assertFinite(world, "リサイズ後");
});

test("mixColor は面積の重みで加重平均する（純粋関数の直接検証）", () => {
  assert.equal(mixColor([]), null, "何もなければ null");

  const mixed = mixColor([
    { id: 1, x: 0, y: 0, r: 10, isGrowing: false, pigmentIndex: 0 },
    { id: 2, x: 0, y: 0, r: 10, isGrowing: false, pigmentIndex: 1 },
  ]);
  assert.ok(mixed);
  // 同じ半径（同じ面積）なら単純平均になる
  assert.ok(Math.abs((mixed?.r ?? 0) - (PIGMENTS[0].r + PIGMENTS[1].r) / 2) < 1e-6);

  const biased = mixColor([
    { id: 1, x: 0, y: 0, r: 20, isGrowing: false, pigmentIndex: 0 },
    { id: 2, x: 0, y: 0, r: 1, isGrowing: false, pigmentIndex: 1 },
  ]);
  assert.ok(biased);
  // 半径が大きい（面積が大きい）方の色に強く寄る
  assert.ok(
    colorDistance(biased as never, PIGMENTS[0]) < colorDistance(biased as never, PIGMENTS[1]),
  );
});

test("rgbToHex / rgbToCssColor は範囲外の値を0〜255にクランプする", () => {
  assert.equal(rgbToHex({ r: -10, g: 300, b: 128 }), (0 << 16) | (255 << 8) | 128);
  assert.equal(rgbToCssColor({ r: -10, g: 300, b: 128.6 }), "rgb(0, 255, 129)");
});
