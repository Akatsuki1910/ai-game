import assert from "node:assert/strict";
import { test } from "node:test";
import { AMPLITUDE, MochiPoundWorld, START_LIVES } from "./world.ts";

function assertFinite(world: MochiPoundWorld, label: string): void {
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.angle), `${label}: angle`);
  assert.ok(Number.isFinite(world.stretch), `${label}: stretch`);
  assert.ok(Number.isFinite(world.lives), `${label}: lives`);
}

test("起動直後は角度0(鉛直下向き)でラウンド1、ライフ満タンの状態", () => {
  const world = new MochiPoundWorld();

  assert.equal(world.round, 1);
  assert.equal(world.lives, START_LIVES);
  assert.equal(world.score, 0);
  assert.equal(world.stretch, 0);
  assert.equal(world.angle, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.isHandPresent, false);
  assertFinite(world, "起動直後");
});

test("最下点(角度0)で振り下ろすとPERFECT判定でスコアと伸びが増え、手の時間帯に入る", () => {
  const world = new MochiPoundWorld();
  const events: string[] = [];
  world.onStrike = (event) => events.push(event.accuracy);

  world.strike();

  assert.deepEqual(events, ["perfect"]);
  assert.ok(world.score > 0, "スコアが増える");
  assert.ok(world.stretch > 0, "伸びが増える");
  assert.equal(world.combo, 1);
  assert.equal(world.isHandPresent, true, "成功直後は合いの手の時間帯に入る");
  assertFinite(world, "PERFECT直後");
});

test("合いの手の時間帯に振り下ろすと手を叩いてしまいライフが減りコンボが切れる", () => {
  const world = new MochiPoundWorld();
  world.strike(); // 1回目はPERFECTでhandCooldownRemaining > 0 になる
  assert.ok(world.isHandPresent);
  assert.equal(world.combo, 1);

  world.strike(); // 手がある間に振り下ろす

  assert.equal(world.lives, START_LIVES - 1, "ライフが1減る");
  assert.equal(world.combo, 0, "コンボが切れる");
});

test("振れ幅の端(角度が最大)でタイミングを外すとMISSになりライフが減る", () => {
  const world = new MochiPoundWorld();
  // omega = 1.6 (ラウンド1) のとき time = (π/2)/omega で角度が最大振幅になる。
  const quarterPeriodSeconds = Math.PI / 2 / 1.6;
  world.step(quarterPeriodSeconds);

  assert.ok(Math.abs(world.angle - AMPLITUDE) < 1e-6, "角度がほぼ最大振幅になっている");
  assert.equal(world.isHandPresent, false);

  const events: string[] = [];
  world.onStrike = (event) => events.push(event.accuracy);
  world.strike();

  assert.deepEqual(events, ["miss"]);
  assert.equal(world.lives, START_LIVES - 1);
  assert.equal(world.score, 0);
});

test("ライフが尽きるとゲームオーバーになり、以降の操作は何も変えない", () => {
  const world = new MochiPoundWorld();
  const omega = 1.6; // ラウンド1のomega
  const quarterPeriodSeconds = Math.PI / 2 / omega;
  const halfPeriodSeconds = Math.PI / omega;

  // 最大振幅(角度=±AMPLITUDE、ウィンドウ幅より確実に外側)の瞬間だけを狙って外し続ける。
  world.step(quarterPeriodSeconds);
  for (let i = 0; i < START_LIVES; i++) {
    world.strike();
    if (i < START_LIVES - 1) world.step(halfPeriodSeconds);
  }

  assert.equal(world.lives, 0);
  assert.equal(world.isOver, true);

  const scoreBefore = world.score;
  const angleBefore = world.angle;
  world.step(1);
  world.strike();

  assert.equal(world.score, scoreBefore, "ゲームオーバー後はスコアが変わらない");
  assert.equal(world.angle, angleBefore, "ゲームオーバー後は角度も進まない");
});

test("目標の伸びに達するとラウンドをクリアし、次のラウンドはより厳しくなる", () => {
  const world = new MochiPoundWorld();
  const roundEvents: number[] = [];
  world.onRoundCompleted = (event) => roundEvents.push(event.round);

  const omega = 1.6; // ラウンド1のomega(ラウンドが進む前提なのでループ内で固定)
  const period = (2 * Math.PI) / omega;
  const handClearSeconds = 0.55; // ラウンド1のhandClearSeconds

  let elapsed = 0;
  let guard = 0;
  while (world.round === 1 && !world.isOver) {
    // 合いの手の時間帯を抜けたあと、最初に角度がちょうど0(最下点)に戻る時刻まで進める。
    const minElapsed = elapsed + handClearSeconds + 0.01;
    const target = Math.ceil(minElapsed / period) * period;
    world.step(target - elapsed);
    elapsed = target;
    world.strike();
    guard += 1;
    assert.ok(guard < 100, "無限ループになっていない");
  }

  assert.deepEqual(roundEvents, [1]);
  assert.equal(world.round, 2);
  assert.equal(world.stretch, 0);
  assert.equal(world.lives, START_LIVES, "ラウンドクリアでライフが満タンまで回復する");
  assertFinite(world, "ラウンドクリア後");
});
