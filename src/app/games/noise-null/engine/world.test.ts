import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NoiseNullWorld,
  targetAmplitudeAt,
  targetPhaseAt,
  toCartesian,
  vectorLength,
  wrapPhase,
} from "./world.ts";

const FRAME = 1 / 60;

function assertFinite(world: NoiseNullWorld, label: string): void {
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.calm), `${label}: calm`);
  assert.ok(Number.isFinite(world.lastResidual), `${label}: lastResidual`);
  assert.ok(Number.isFinite(world.playerAmplitude), `${label}: playerAmplitude`);
  assert.ok(Number.isFinite(world.playerPhase), `${label}: playerPhase`);
}

/** プレイヤーのフェーザーを、現在のノイズをちょうど打ち消す位置(=ノイズの逆ベクトル)に合わせる。 */
function tuneToCancel(world: NoiseNullWorld): void {
  const noise = toCartesian(targetAmplitudeAt(world.elapsed), targetPhaseAt(world.elapsed));
  world.playerAmplitude = Math.min(1, Math.hypot(noise.x, noise.y));
  world.playerPhase = wrapPhase(Math.atan2(-noise.y, -noise.x));
}

test("初期状態は静止していて、calmが満タン・スコア0で始まる", () => {
  const world = new NoiseNullWorld();
  assert.equal(world.score, 0);
  assert.equal(world.calm, 100);
  assert.equal(world.isOver, false);
  assert.equal(world.playerAmplitude, 0);
  assertFinite(world, "初期状態");
});

test("wrapPhase は常に [0, 2π) の範囲に収める", () => {
  assert.ok(wrapPhase(-0.5) >= 0);
  assert.ok(wrapPhase(Math.PI * 5) < Math.PI * 2);
  assert.ok(Math.abs(wrapPhase(0) - 0) < 1e-9);
});

test("パッド操作でプレイヤーのフェーザー(振幅・位相)が決まる", () => {
  const world = new NoiseNullWorld();

  // 中心からパッド半径と同じ距離 → 振幅は1
  world.setPlayerFromPad(100, 0, 100);
  assert.ok(Math.abs(world.playerAmplitude - 1) < 1e-9);
  assert.ok(Math.abs(world.playerPhase - 0) < 1e-9);

  // パッド半径を超える距離でも振幅は1でクランプされる
  world.setPlayerFromPad(500, 0, 100);
  assert.equal(world.playerAmplitude, 1);

  // 中心(距離0)では振幅が0になり、位相は直前の値を保持する
  const phaseBeforeCenter = world.playerPhase;
  world.setPlayerFromPad(0, 0, 100);
  assert.equal(world.playerAmplitude, 0);
  assert.equal(world.playerPhase, phaseBeforeCenter, "振幅0のときは位相を変えない");
});

test("キー操作で振幅・位相を微調整できる(範囲外には出ない)", () => {
  const world = new NoiseNullWorld();
  world.nudgeAmplitude(0.3);
  assert.ok(Math.abs(world.playerAmplitude - 0.3) < 1e-9);
  world.nudgeAmplitude(-10);
  assert.equal(world.playerAmplitude, 0, "振幅は0未満にならない");
  world.nudgeAmplitude(10);
  assert.equal(world.playerAmplitude, 1, "振幅は1を超えない");

  world.nudgePhase(-0.1);
  assert.ok(world.playerPhase >= 0 && world.playerPhase < Math.PI * 2, "位相は正規化される");
});

test("ノイズのちょうど逆ベクトルに合わせ続けると残差が0に近づき、calmが回復してスコアが伸びる", () => {
  const world = new NoiseNullWorld();
  // 最初の数フレームで calm を少し減らしてから、打ち消しを開始する
  for (let i = 0; i < 10; i++) world.step(FRAME);
  const calmAfterSilence = world.calm;

  for (let i = 0; i < 180; i++) {
    tuneToCancel(world);
    world.step(FRAME);
    assertFinite(world, `打ち消し中 frame=${i}`);
  }

  assert.ok(world.lastResidual < 0.05, "打ち消し続けると残差はほぼ0になる");
  assert.ok(world.calm > calmAfterSilence, "静かな状態が続くとcalmが回復する");
  assert.ok(world.score > 0, "静かな状態が続くとスコアが伸びる");
});

test("フェーザーを合わせないまま放置するとcalmが尽きてゲームオーバーになる", () => {
  const world = new NoiseNullWorld();
  // プレイヤーは振幅0のまま放置 = ノイズを一切打ち消さない
  let steps = 0;
  while (!world.isOver && steps < 10000) {
    world.step(FRAME);
    steps++;
    assertFinite(world, `放置中 frame=${steps}`);
  }

  assert.equal(world.isOver, true, "放置を続けるとラウンドが終了する");
  assert.equal(world.calm, 0);

  // 終了後に進めても壊れない
  const scoreAtOver = world.score;
  world.step(FRAME);
  assert.equal(world.score, scoreAtOver, "終了後はスコアが変化しない");
  assertFinite(world, "終了後");
});

test("リセットで初期状態に戻る", () => {
  const world = new NoiseNullWorld();
  for (let i = 0; i < 30; i++) {
    tuneToCancel(world);
    world.step(FRAME);
  }
  assert.ok(world.elapsed > 0);

  world.reset();
  assert.equal(world.elapsed, 0);
  assert.equal(world.score, 0);
  assert.equal(world.calm, 100);
  assert.equal(world.isOver, false);
  assert.equal(world.playerAmplitude, 0);
  assert.equal(world.residualHistory.length, 0);
});

test("突発バーストは決定的なスケジュールで発生し、発生中は残差が目に見えて増える", () => {
  const world = new NoiseNullWorld();
  let sawBurst = false;
  let residualDuringBurst = 0;

  for (let i = 0; i < 400 && !sawBurst; i++) {
    tuneToCancel(world);
    world.step(FRAME);
    if (world.lastBurstActive) {
      sawBurst = true;
      residualDuringBurst = world.lastResidual;
    }
  }

  assert.ok(sawBurst, "一定時間内に少なくとも1回バーストが発生する");
  assert.ok(residualDuringBurst > 0.1, "バースト中は完全に打ち消していても残差が目に見えて残る");
});

test("残差の履歴は上限件数を超えて溜め込まない", () => {
  const world = new NoiseNullWorld();
  for (let i = 0; i < 400; i++) world.step(FRAME);
  assert.ok(world.residualHistory.length <= 180);
});

test("targetAmplitudeAt / targetPhaseAt は常に有限で、振幅は想定レンジ内", () => {
  for (let t = 0; t < 500; t += 1.7) {
    const amplitude = targetAmplitudeAt(t);
    const phase = targetPhaseAt(t);
    assert.ok(Number.isFinite(amplitude));
    assert.ok(Number.isFinite(phase));
    assert.ok(amplitude >= 0.1 && amplitude <= 1, `振幅が想定レンジ内: t=${t}`);
    assert.ok(phase >= 0 && phase < Math.PI * 2, `位相が正規化されている: t=${t}`);
  }
});

test("vectorLength / toCartesian は極座標と直交座標の変換として整合する", () => {
  const v = toCartesian(2, Math.PI / 2);
  assert.ok(Math.abs(v.x) < 1e-9);
  assert.ok(Math.abs(v.y - 2) < 1e-9);
  assert.ok(Math.abs(vectorLength(v) - 2) < 1e-9);
});
