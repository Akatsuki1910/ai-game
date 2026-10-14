import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BatonSyncWorld,
  DYNAMICS_MAX,
  DYNAMICS_MIN,
  FOCUS_MAX,
  TEMPO_MAX,
  TEMPO_MIN,
} from "./world.ts";

// このゲームのロジックは同期的な純粋計算のみで、非同期の競合・権限・キャッシュは存在しないため、
// それらの観点はテスト対象外とする（境界値・ゼロ件・失敗・中断・再入は以下でカバーする）。

const WIDTH = 960;
const HEIGHT = 540;
const FRAME = 1 / 60;

function assertFinite(world: BatonSyncWorld, label: string): void {
  assert.ok(Number.isFinite(world.tempo), `${label}: tempo`);
  assert.ok(Number.isFinite(world.dynamics), `${label}: dynamics`);
  assert.ok(Number.isFinite(world.focus), `${label}: focus`);
  assert.ok(Number.isFinite(world.score), `${label}: score`);
}

/** 現在の目標ちょうどの位置へバトン入力を移す(プレイヤーが完璧に追従した状態を再現する)。 */
function moveInputToTarget(world: BatonSyncWorld): void {
  const x = ((world.targetTempo - TEMPO_MIN) / (TEMPO_MAX - TEMPO_MIN)) * world.width;
  const y =
    (1 - (world.targetDynamics - DYNAMICS_MIN) / (DYNAMICS_MAX - DYNAMICS_MIN)) * world.height;
  world.setBatonInput(x, y);
}

test("起動直後は中央のテンポ・音量が目標と一致し、集中力は満タン", () => {
  const world = new BatonSyncWorld(WIDTH, HEIGHT);

  assert.ok(Math.abs(world.tempo - world.targetTempo) < 1e-6, "初期テンポが目標と一致");
  assert.ok(Math.abs(world.dynamics - world.targetDynamics) < 1e-6, "初期音量が目標と一致");
  assert.equal(world.focus, FOCUS_MAX);
  assert.equal(world.score, 0);
  assert.equal(world.isOver, false);
  assert.ok(world.targetTempo >= TEMPO_MIN && world.targetTempo <= TEMPO_MAX);
  assert.ok(world.targetDynamics >= DYNAMICS_MIN && world.targetDynamics <= DYNAMICS_MAX);
});

test("目標に合わせ続けると同調し続けてスコアが増え、集中力は満タンを保つ", () => {
  const world = new BatonSyncWorld(WIDTH, HEIGHT);

  for (let i = 0; i < 120; i++) {
    moveInputToTarget(world);
    world.step(FRAME);
    assertFinite(world, "同調中");
  }

  assert.ok(world.score > 0, "合わせ続けるとスコアが増える");
  assert.equal(world.focus, FOCUS_MAX, "合っている間は集中力が満タンのまま");
  assert.equal(world.isOver, false);
});

test("目標から外れた位置に入力し続けると集中力が尽きてゲームオーバーになる", () => {
  const world = new BatonSyncWorld(WIDTH, HEIGHT);
  world.setBatonInput(0, world.height); // 最低テンポ・最低音量側へ大きく外す

  for (let i = 0; i < 2000 && !world.isOver; i++) {
    world.step(FRAME);
    assertFinite(world, "ズレている間");
    assert.ok(world.focus >= 0 && world.focus <= FOCUS_MAX, "集中力は範囲内に収まる");
  }

  assert.equal(world.isOver, true, "集中力が尽きて終了する");
  assert.equal(world.focus, 0);

  // 終了後に進めても状態が壊れない
  world.step(FRAME);
  assertFinite(world, "終了後");
  assert.equal(world.isOver, true);
  assert.equal(world.focus, 0);
});

test("セグメントが進むほど許容差が狭くフレーズ間隔が短くなり、合わせ続ければ終了しない", () => {
  const world = new BatonSyncWorld(WIDTH, HEIGHT);
  const initialTempoTolerance = world.tempoTolerance;
  const initialDynamicsTolerance = world.dynamicsTolerance;
  const initialSegmentDuration = world.segmentDuration;

  // 十分な実時間(約10秒ぶん)を、常に目標へ重ねたまま進める
  for (let i = 0; i < Math.ceil(10 / FRAME); i++) {
    moveInputToTarget(world);
    world.step(FRAME);
    assertFinite(world, "フレーズ進行中");
  }

  assert.ok(world.tempoTolerance < initialTempoTolerance, "テンポの許容差が狭くなる");
  assert.ok(world.dynamicsTolerance < initialDynamicsTolerance, "音量の許容差が狭くなる");
  assert.ok(world.segmentDuration < initialSegmentDuration, "フレーズ間隔が短くなる");
  assert.equal(world.isOver, false, "合わせ続けていればゲームオーバーにならない");
});

test("画面サイズが変わってもバトンの入力位置が画面内に収まり、位置の比率を保つ", () => {
  const world = new BatonSyncWorld(WIDTH, HEIGHT);
  world.setBatonInput(WIDTH * 0.75, HEIGHT * 0.25);

  world.resize(375, 720);

  assert.ok(world.inputX >= 0 && world.inputX <= 375, "リサイズ後も画面内");
  assert.ok(world.inputY >= 0 && world.inputY <= 720, "リサイズ後も画面内");
  assert.ok(Math.abs(world.inputX / 375 - 0.75) < 0.01, "横位置の比率を保つ");
  assert.ok(Math.abs(world.inputY / 720 - 0.25) < 0.01, "縦位置の比率を保つ");
});

test("キーボード操作(nudgeBatonInput)は画面外に出ない", () => {
  const world = new BatonSyncWorld(WIDTH, HEIGHT);

  world.nudgeBatonInput(-999999, -999999);
  assert.equal(world.inputX, 0);
  assert.equal(world.inputY, 0);

  world.nudgeBatonInput(999999, 999999);
  assert.equal(world.inputX, WIDTH);
  assert.equal(world.inputY, HEIGHT);
});

test("リセットで最初の状態に戻る(再入)", () => {
  const world = new BatonSyncWorld(WIDTH, HEIGHT);
  world.setBatonInput(0, 0);
  for (let i = 0; i < 300 && !world.isOver; i++) world.step(FRAME);

  world.reset();

  assert.equal(world.score, 0);
  assert.equal(world.focus, FOCUS_MAX);
  assert.equal(world.isOver, false);
  assert.ok(Math.abs(world.tempo - world.targetTempo) < 1e-6);
  assert.ok(Math.abs(world.dynamics - world.targetDynamics) < 1e-6);
});
