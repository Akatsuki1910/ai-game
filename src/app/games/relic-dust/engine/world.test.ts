import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CLEARED_SAND_THRESHOLD,
  COMPLETE_REVEAL_RATIO,
  CRACK_INTEGRITY_PENALTY,
  GRID_COLS,
  GRID_ROWS,
  INTEGRITY_MAX,
  LIVES_START,
  RelicDustWorld,
  STAMINA_MAX,
} from "./world.ts";

// このゲームのロジックは同期的な純粋計算のみで、権限やキャッシュの概念は存在しないため、
// それらの観点は対象外とする。境界値・ゼロ件・失敗・中断・再入は以下でカバーする。

const WIDTH = 980;
const HEIGHT = 560;
const FRAME = 1 / 60;

function assertFinite(world: RelicDustWorld, label: string): void {
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.integrity), `${label}: integrity`);
  assert.ok(Number.isFinite(world.stamina), `${label}: stamina`);
  assert.ok(Number.isFinite(world.pointerX), `${label}: pointerX`);
  assert.ok(Number.isFinite(world.pointerY), `${label}: pointerY`);
}

/**
 * 許容速度より十分遅い速度で、遺物の楕円全体を覆うラスタースキャンを数周行い、
 * ヒビを入れずに丁寧に払い切る(異常系ではなく正常系の土台として使う)。
 */
function sweepClearRelic(world: RelicDustWorld, passes = 4): void {
  const startRelicIndex = world.relicIndex;
  const { cx, cy, rx, ry } = world.getRelicBoundsPx();
  const margin = Math.max(world.brushRadiusPx * 0.5, 4);
  const x0 = Math.max(0, cx - rx - margin);
  const x1 = Math.min(world.width, cx + rx + margin);
  const y0 = Math.max(0, cy - ry - margin);
  const y1 = Math.min(world.height, cy + ry + margin);
  const stepPx = Math.max(2, world.brushRadiusPx * 0.55);
  const speedPxPerSec = world.allowedSpeed * 0.75; // 常に許容速度より十分遅い

  world.setPointerDown(x0, y0);
  for (let pass = 0; pass < passes; pass++) {
    for (let y = y0; y <= y1; y += stepPx) {
      const leftToRight = Math.floor((y - y0) / stepPx) % 2 === 0;
      const xs: number[] = [];
      for (let x = x0; x <= x1; x += stepPx) xs.push(x);
      if (!leftToRight) xs.reverse();
      for (const x of xs) {
        const dist = Math.hypot(x - world.pointerX, y - world.pointerY);
        const dt = Math.max(dist / speedPxPerSec, FRAME);
        world.setPointerPosition(x, y);
        world.step(dt);
        if (world.isOver || world.relicIndex !== startRelicIndex) return;
      }
    }
  }
  world.setPointerUp();
}

test("起動直後は満タンのライフ・耐久・スタミナで、ラウンド1(relicIndex=0)から始まる", () => {
  const world = new RelicDustWorld(WIDTH, HEIGHT);

  assert.equal(world.relicIndex, 0);
  assert.equal(world.lives, LIVES_START);
  assert.equal(world.integrity, INTEGRITY_MAX);
  assert.equal(world.stamina, STAMINA_MAX);
  assert.equal(world.score, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.revealRatio, 0, "開始時はまだ何も発掘していない");

  let relicCells = 0;
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      if (world.getCell(col, row).isRelic) relicCells++;
    }
  }
  assert.ok(relicCells > 0, "遺物のセルが1つ以上存在する(データ0件にならない)");
});

test("ゆっくり遺物全体を払い切ると、ヒビを入れずにラウンドをクリアしてスコアが増え次のラウンドへ進む", () => {
  const world = new RelicDustWorld(WIDTH, HEIGHT);
  const integrityBefore = world.integrity;

  sweepClearRelic(world);

  assert.equal(world.isOver, false);
  assert.equal(world.lives, LIVES_START, "ライフを失っていない");
  assert.equal(world.relicIndex, 1, "次のラウンドに進んでいる");
  assert.ok(world.score > 0, "スコアが増えている");
  assert.equal(integrityBefore, INTEGRITY_MAX, "念のため: 開始時の耐久は満タンだった");
  assertFinite(world, "クリア後");
});

/**
 * 2歩に分けて「前回サンプル位置」を確定させてから大きくジャンプさせ、
 * 許容速度を大きく超える速さでの通過を再現する。
 */
function fastPassThrough(
  world: RelicDustWorld,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): void {
  world.setPointerDown(fromX, fromY);
  world.step(FRAME);
  world.setPointerPosition(toX, toY);
  world.step(FRAME);
}

test("遺物にまだ砂が十分残っている状態でも、許容速度を超える速さで払うとヒビが入り耐久が減る(ラウンドは継続)", () => {
  const world = new RelicDustWorld(WIDTH, HEIGHT);
  const { cx, cy, rx } = world.getRelicBoundsPx();
  // 中心ではなく縁寄りを狙うことで、ブラシ範囲に入る遺物セルを少数(シャッターしない量)に絞る。
  const targetX = cx + rx * 0.9;
  const targetY = cy;
  const col = Math.floor(targetX / world.cellWidth);
  const row = Math.floor(targetY / world.cellHeight);

  const integrityBefore = world.integrity;
  const sandBefore = world.getCell(col, row).sand;
  assert.ok(sandBefore > CLEARED_SAND_THRESHOLD, "開始時点ではまだ砂が十分残っている");

  fastPassThrough(world, targetX - world.allowedSpeed * FRAME * 10, targetY, targetX, targetY);

  const integrityLost = integrityBefore - world.integrity;
  assert.ok(integrityLost > 0, "ヒビで耐久が減る");
  assert.equal(
    integrityLost % CRACK_INTEGRITY_PENALTY,
    0,
    "減った量はヒビ1回分の整数倍(範囲内の複数セルが同時に割れることがある)",
  );
  assert.equal(world.getCell(col, row).isCracked, true, "そのセルがヒビ入りとして記録される");
  assert.equal(world.getCell(col, row).sand, sandBefore, "ヒビが入った瞬間は砂が変化しない");
  assert.equal(world.isOver, false, "この程度の被弾ではゲームオーバーにならない");
  assertFinite(world, "ヒビ発生後");
});

test("遺物の中心付近を速く払うと、範囲内の複数セルが同時に割れて耐久が一気に失われる(シャッターし得る)", () => {
  const world = new RelicDustWorld(WIDTH, HEIGHT);
  const { cx, cy } = world.getRelicBoundsPx();
  const livesBefore = world.lives;
  const relicIndexBefore = world.relicIndex;

  fastPassThrough(world, cx - world.allowedSpeed * FRAME * 10, cy, cx, cy);

  // 中心付近はブラシ範囲に入る遺物セルが多く、1回の通過で複数個所にヒビが入って
  // 耐久が大きく失われる(壊れ切ればそのラウンドは失敗として次に進む)。
  assert.ok(
    world.integrity < INTEGRITY_MAX || world.relicIndex !== relicIndexBefore,
    "中心を速く払うと耐久が大きく減るか、シャッターしてラウンドが切り替わる",
  );
  if (world.relicIndex !== relicIndexBefore) {
    assert.equal(world.lives, livesBefore - 1, "シャッターした場合はライフを1失う");
  }
  assertFinite(world, "中心を速く払った後");
});

test("払っている間だけスタミナが減り、離している間だけ回復する", () => {
  const world = new RelicDustWorld(WIDTH, HEIGHT);
  const { cx, cy } = world.getRelicBoundsPx();

  world.setPointerDown(cx, cy);
  for (let i = 0; i < 30; i++) {
    world.setPointerPosition(cx, cy);
    world.step(FRAME);
  }
  assert.ok(world.stamina < STAMINA_MAX, "払い続けるとスタミナが減る");
  const staminaWhileHeld = world.stamina;

  // 押しっぱなしでも、スタミナが尽きるまで動かさなければそれ以上減らない下限は0
  for (let i = 0; i < 1000 && world.stamina > 0; i++) world.step(FRAME);
  assert.equal(world.stamina, 0, "スタミナは0未満にならない");

  world.setPointerUp();
  for (let i = 0; i < 30; i++) world.step(FRAME);
  assert.ok(world.stamina > 0, "離すとスタミナが回復する");
  assert.ok(world.stamina <= STAMINA_MAX, "スタミナはMAXを超えない");
  assert.notEqual(staminaWhileHeld, STAMINA_MAX);
});

test("何もせず放置すると制限時間が尽きてライフを1失い、次のラウンドへ進む(ゲームオーバーにはならない)", () => {
  const world = new RelicDustWorld(WIDTH, HEIGHT);
  const livesBefore = world.lives;
  const relicIndexBefore = world.relicIndex;

  for (let i = 0; i < Math.ceil((world.roundDuration + 1) / FRAME); i++) {
    world.step(FRAME);
    assertFinite(world, "タイムアウト進行中");
    if (world.relicIndex !== relicIndexBefore) break;
  }

  assert.equal(world.lives, livesBefore - 1, "タイムアウトでライフが1減る");
  assert.equal(world.relicIndex, relicIndexBefore + 1, "次のラウンドへ進む");
  assert.equal(world.isOver, false);
});

test("ライフが0になるとゲームオーバーになり、以後 step() しても状態が壊れない", () => {
  const world = new RelicDustWorld(WIDTH, HEIGHT);

  for (let life = LIVES_START; life > 0 && !world.isOver; life--) {
    for (let i = 0; i < Math.ceil((world.roundDuration + 1) / FRAME) && !world.isOver; i++) {
      world.step(FRAME);
    }
  }

  assert.equal(world.isOver, true, "ライフを使い切るとゲームオーバーになる");
  assert.equal(world.lives, 0);

  world.step(FRAME);
  assertFinite(world, "ゲームオーバー後");
  assert.equal(world.isOver, true);
  assert.equal(world.lives, 0);
});

test("画面サイズが変わってもポインタが画面内に収まる", () => {
  const world = new RelicDustWorld(WIDTH, HEIGHT);
  world.setPointerDown(WIDTH * 0.95, HEIGHT * 0.95);

  world.resize(320, 500);

  assert.ok(world.pointerX >= 0 && world.pointerX <= 320);
  assert.ok(world.pointerY >= 0 && world.pointerY <= 500);
});

test("キーボード操作(nudgePointer)は画面外に出ない", () => {
  const world = new RelicDustWorld(WIDTH, HEIGHT);

  world.nudgePointer(-999999, -999999);
  assert.equal(world.pointerX, 0);
  assert.equal(world.pointerY, 0);

  world.nudgePointer(999999, 999999);
  assert.equal(world.pointerX, WIDTH);
  assert.equal(world.pointerY, HEIGHT);
});

test("リセットで最初の状態に戻る(再入)", () => {
  const world = new RelicDustWorld(WIDTH, HEIGHT);
  sweepClearRelic(world);
  assert.ok(world.relicIndex > 0 && world.score > 0);

  world.reset();

  assert.equal(world.relicIndex, 0);
  assert.equal(world.score, 0);
  assert.equal(world.lives, LIVES_START);
  assert.equal(world.integrity, INTEGRITY_MAX);
  assert.equal(world.stamina, STAMINA_MAX);
  assert.equal(world.isOver, false);
});

test("ラウンドが進むほど遺物は大きく・許容速度は遅く・制限時間は短くなる", () => {
  const world = new RelicDustWorld(WIDTH, HEIGHT);
  const initialAllowedSpeed = world.allowedSpeed;
  const initialDuration = world.roundDuration;
  const initialBounds = world.getRelicBoundsPx();

  sweepClearRelic(world);
  assert.equal(world.relicIndex, 1);

  assert.ok(world.allowedSpeed < initialAllowedSpeed, "許容速度が下がる");
  assert.ok(world.roundDuration < initialDuration, "制限時間が短くなる");
  const nextBounds = world.getRelicBoundsPx();
  assert.ok(
    nextBounds.rx >= initialBounds.rx && nextBounds.ry >= initialBounds.ry,
    "遺物が大きくなる",
  );
});

test("ゼロ除算や巨大なdeltaSecondsを渡しても状態が破綻しない", () => {
  const world = new RelicDustWorld(WIDTH, HEIGHT);
  world.setPointerDown(world.width / 2, world.height / 2);

  world.step(0);
  assertFinite(world, "delta=0");

  world.setPointerPosition(world.width, world.height);
  world.step(5);
  assertFinite(world, "巨大なdelta");
  assert.ok(world.integrity >= 0 && world.integrity <= INTEGRITY_MAX);
  assert.ok(world.stamina >= 0 && world.stamina <= STAMINA_MAX);
});

// 以下はモジュールが期待どおりの定数を公開していることの確認(UI側の表示ロジックが依拠する)。
test("公開定数が想定どおりの範囲を表す", () => {
  assert.ok(COMPLETE_REVEAL_RATIO > 0 && COMPLETE_REVEAL_RATIO <= 1);
  assert.ok(CLEARED_SAND_THRESHOLD >= 0 && CLEARED_SAND_THRESHOLD < 1);
  assert.ok(CRACK_INTEGRITY_PENALTY > 0 && CRACK_INTEGRITY_PENALTY <= INTEGRITY_MAX);
});
