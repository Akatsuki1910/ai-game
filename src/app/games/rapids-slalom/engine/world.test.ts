import assert from "node:assert/strict";
import { test } from "node:test";
import { BRACE_WINDOW_SECONDS, KAYAK_RADIUS, RapidsSlalomWorld, STARTING_LIVES } from "./world.ts";

const WIDTH = 960;
const HEIGHT = 540;
const FRAME = 1 / 60;

function assertFinite(world: RapidsSlalomWorld, label: string): void {
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.kayak.x) && Number.isFinite(world.kayak.vx), `${label}: kayak`);
  for (const gate of world.gates) {
    assert.ok(Number.isFinite(gate.y) && Number.isFinite(gate.gapCenterX), `${label}: gate`);
  }
  for (const rock of world.rocks) {
    assert.ok(Number.isFinite(rock.x) && Number.isFinite(rock.y), `${label}: rock`);
  }
}

/**
 * ゲートが現れるまでステップを進める。岩の出現有無はテスト対象外のため、
 * 岩に当たってコンボ/ライフが乱されないよう毎フレーム取り除く。
 */
function runUntilNextGate(world: RapidsSlalomWorld, maxSeconds = 10): void {
  for (let elapsed = 0; elapsed < maxSeconds && !world.nextGate; elapsed += FRAME) {
    world.step(FRAME);
    world.rocks = [];
  }
}

/**
 * 岩が現れるまでステップを進める。ゲートは中央付近をすり抜けようとして
 * 誤ってミス判定を起こしうるため、テスト対象外の間は毎フレーム取り除く。
 */
function runUntilNextRock(world: RapidsSlalomWorld, maxSeconds = 15): void {
  for (let elapsed = 0; elapsed < maxSeconds && world.rocks.length === 0; elapsed += FRAME) {
    world.step(FRAME);
    world.gates = [];
  }
}

/**
 * 常に「次のゲート」の隙間中央へ操舵し続け、指定した枚数を通過するまで進める。
 * 岩はこのテストの対象外なので、途中で出現しても衝突しないよう取り除く。
 */
function clearGates(world: RapidsSlalomWorld, count: number, maxSeconds = 20): void {
  let resolved = 0;
  world.onGateResolved = () => {
    resolved += 1;
  };
  for (
    let elapsed = 0;
    elapsed < maxSeconds && resolved < count && !world.isOver;
    elapsed += FRAME
  ) {
    const gate = world.nextGate;
    if (gate) world.setSteerTarget(gate.gapCenterX);
    world.step(FRAME);
    world.rocks = [];
  }
  world.onGateResolved = null;
}

// このテストはクライアント完結のミニゲームであり、権限拒否・キャッシュの陳腐化の観点は対象外
// （サーバー通信や認可を持たないため）。境界値(画面端でのクランプ)・空/ゼロ件(開始直後にゲート
// が1枚もない状態)・エラー/失敗(隙間を外す・岩に当たる)・再入(ゲームオーバー後のreset)・
// 操作の中断(ブレース猶予切れ)は以下でカバーする。非同期の競合はゲームループが単一スレッドの
// 同期stepのみのため対象外。

test("起動直後はカヤックが中央にいて、ゲート/岩はまだ無く状態が初期化されている", () => {
  const world = new RapidsSlalomWorld(WIDTH, HEIGHT);

  assert.equal(world.kayak.x, WIDTH / 2, "カヤックは中央から始まる");
  assert.equal(world.gates.length, 0, "開始直後はゲートがまだ無い");
  assert.equal(world.rocks.length, 0, "開始直後は岩がまだ無い");
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.lives, STARTING_LIVES);
  assert.equal(world.isOver, false);
  assert.equal(world.isBracing, false, "開始直後はブレースしていない");
  assertFinite(world, "起動直後");
});

test("操作しなくても流れに乗ってゲートが画面上部から生成され下方向へ進む", () => {
  const world = new RapidsSlalomWorld(WIDTH, HEIGHT);

  runUntilNextGate(world);
  const gate = world.nextGate;
  assert.ok(gate, "ゲートが生成される");
  const firstY = gate?.y ?? 0;

  world.step(FRAME);
  assert.ok(gate && gate.y > firstY, "ゲートは時間経過で下方向へ進む");
  assertFinite(world, "無操作進行後");
});

test("操作しなくても岩が画面上部から生成される", () => {
  const world = new RapidsSlalomWorld(WIDTH, HEIGHT);

  runUntilNextRock(world);
  assert.ok(world.rocks.length > 0, "岩が生成される");
  assertFinite(world, "無操作進行後");
});

test("最初の2枚のゲートは強制的に緑で、ブレースなしでも隙間に合わせれば通過できる", () => {
  const world = new RapidsSlalomWorld(WIDTH, HEIGHT);
  runUntilNextGate(world);
  assert.equal(world.nextGate?.color, "green", "1枚目は緑固定");

  clearGates(world, 2);

  assert.equal(world.combo, 2, "2枚連続で綺麗に抜けるとコンボが2になる");
  assert.ok(world.score > 0, "得点が入っている");
  assert.equal(world.lives, STARTING_LIVES, "ライフは減っていない");
  assertFinite(world, "緑ゲート通過後");
});

test("ゲートの隙間を外して通過するとライフが減りコンボがリセットされる", () => {
  const world = new RapidsSlalomWorld(WIDTH, HEIGHT);
  runUntilNextGate(world);
  const gate = world.nextGate;
  assert.ok(gate, "対象のゲートがある");
  if (!gate) return;

  const misses: boolean[] = [];
  world.onGateResolved = (event) => misses.push(event.isClean);

  // 隙間の外側(左端の棒のさらに外)へ狙いを外す
  world.setSteerTarget(Math.max(KAYAK_RADIUS, gate.gapCenterX - gate.gapHalfWidth - 40));
  for (let elapsed = 0; elapsed < 10 && gate.y < world.kayakY; elapsed += FRAME) {
    world.step(FRAME);
    world.rocks = [];
  }

  assert.deepEqual(misses, [false], "隙間を外すと失敗として記録される");
  assert.equal(world.lives, STARTING_LIVES - 1, "ライフが1減る");
  assert.equal(world.combo, 0, "コンボがリセットされる");
  assertFinite(world, "ゲートミス後");
});

test("赤ゲートはブレースなしだと隙間に合わせても失敗し、ブレース中なら成功する", () => {
  const world = new RapidsSlalomWorld(WIDTH, HEIGHT);
  runUntilNextGate(world);
  const gate = world.nextGate;
  assert.ok(gate, "対象のゲートがある");
  if (!gate) return;
  gate.color = "red";

  world.setSteerTarget(gate.gapCenterX);
  const events: boolean[] = [];
  world.onGateResolved = (event) => events.push(event.isClean);
  for (let elapsed = 0; elapsed < 10 && !gate.resolved; elapsed += FRAME) {
    world.step(FRAME);
    world.rocks = [];
  }
  assert.deepEqual(events, [false], "ブレースせずに赤ゲートを通ると失敗になる");
  assert.equal(world.lives, STARTING_LIVES - 1);

  const world2 = new RapidsSlalomWorld(WIDTH, HEIGHT);
  runUntilNextGate(world2);
  const gate2 = world2.nextGate;
  assert.ok(gate2, "対象のゲートがある");
  if (!gate2) return;
  gate2.color = "red";
  world2.setSteerTarget(gate2.gapCenterX);
  const events2: boolean[] = [];
  world2.onGateResolved = (event) => events2.push(event.isClean);
  // ブレースの猶予は短いため、ゲートが自分の位置(kayakY)へ到達する直前に発動する。
  const braceMarginPx = 40;
  for (let elapsed = 0; elapsed < 10 && !gate2.resolved; elapsed += FRAME) {
    if (gate2.y >= world2.kayakY - braceMarginPx) world2.brace();
    world2.step(FRAME);
    world2.rocks = [];
  }
  assert.deepEqual(events2, [true], "ブレース中に通ると成功する");
  assert.equal(world2.lives, STARTING_LIVES, "ライフは減らない");
  assertFinite(world2, "赤ゲート通過後");
});

test("ブレースの効果は一定時間で切れる", () => {
  const world = new RapidsSlalomWorld(WIDTH, HEIGHT);
  world.brace();
  assert.equal(world.isBracing, true, "発動直後は有効");

  world.step(BRACE_WINDOW_SECONDS - 0.05);
  assert.equal(world.isBracing, true, "猶予時間内はまだ有効");

  world.step(0.1);
  assert.equal(world.isBracing, false, "猶予時間を過ぎると無効になる");
});

test("岩にぶつかるとライフが減りコンボがリセットされる", () => {
  const world = new RapidsSlalomWorld(WIDTH, HEIGHT);
  world.combo = 3;
  runUntilNextRock(world);
  const rock = world.rocks.find((r) => !r.resolved);
  assert.ok(rock, "岩が生成されている");
  if (!rock) return;

  const hits: number[] = [];
  world.onRockHit = ({ livesRemaining }) => hits.push(livesRemaining);
  world.setSteerTarget(rock.x);
  for (let elapsed = 0; elapsed < 15 && !rock.resolved; elapsed += FRAME) {
    world.step(FRAME);
    world.gates = [];
  }

  assert.equal(hits.length, 1, "岩に1回ぶつかる");
  assert.equal(world.lives, STARTING_LIVES - 1);
  assert.equal(world.combo, 0, "コンボがリセットされる");
  assertFinite(world, "岩衝突後");
});

test(`ライフが${STARTING_LIVES}回尽きるとisOverになり、resetで最初から遊べる`, () => {
  const world = new RapidsSlalomWorld(WIDTH, HEIGHT);

  for (let attempt = 0; attempt < STARTING_LIVES && !world.isOver; attempt++) {
    runUntilNextGate(world);
    const gate = world.nextGate;
    if (!gate) break;
    world.setSteerTarget(Math.max(KAYAK_RADIUS, gate.gapCenterX - gate.gapHalfWidth - 60));
    for (let elapsed = 0; elapsed < 10 && gate.y < world.kayakY; elapsed += FRAME) {
      world.step(FRAME);
      world.rocks = [];
    }
  }

  assert.equal(world.isOver, true, "ライフが尽きてラウンド終了する");
  assert.equal(world.lives, 0);

  const kayakBeforeExtraStep = { ...world.kayak };
  world.step(FRAME);
  assert.deepEqual(world.kayak, kayakBeforeExtraStep, "終了後は状態が変化しない(早期リターン)");

  world.reset();
  assert.equal(world.isOver, false);
  assert.equal(world.lives, STARTING_LIVES);
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.gates.length, 0);
  assertFinite(world, "リセット後");
});

test("操舵目標とカヤックの位置は画面端でクランプされ、はみ出さない", () => {
  const world = new RapidsSlalomWorld(WIDTH, HEIGHT);

  world.setSteerTarget(-1000);
  assert.equal(world.targetX, KAYAK_RADIUS, "左端でクランプされる");
  world.setSteerTarget(WIDTH + 1000);
  assert.equal(world.targetX, WIDTH - KAYAK_RADIUS, "右端でクランプされる");

  world.setSteerTarget(-1000);
  for (let i = 0; i < 240; i++) world.step(FRAME);
  assert.ok(world.kayak.x >= KAYAK_RADIUS - 0.01, "カヤックは左端を突き抜けない");
  assertFinite(world, "端へ寄せ続けた後");
});

test("画面サイズが変わってもカヤック・ゲート・岩が画面内に収まる", () => {
  const world = new RapidsSlalomWorld(WIDTH, HEIGHT);
  runUntilNextGate(world);
  runUntilNextRock(world);

  // PC横長 → スマホ縦長
  world.resize(375, 720);

  assert.ok(world.kayak.x >= -1 && world.kayak.x <= 376, "カヤックが画面内に収まる");
  for (const gate of world.gates) {
    assert.ok(gate.gapCenterX >= -1 && gate.gapCenterX <= 376, "ゲートが画面内に収まる");
  }
  for (const rock of world.rocks) {
    assert.ok(rock.x >= -1 && rock.x <= 376, "岩が画面内に収まる");
  }
  assert.equal(world.kayakY, 720 * 0.78, "カヤックの縦位置は新しい高さに追従する");

  for (let i = 0; i < 60; i++) world.step(FRAME);
  assertFinite(world, "リサイズ後の進行");
});
