import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COLUMN_COUNT,
  KEEP_END_INDEX,
  KEEP_START_INDEX,
  TideKeepWorld,
  WAVE_DURATION_SECONDS,
  WAVE_INTERVAL_START_SECONDS,
  type WaveResolvedEvent,
} from "./world.ts";

const WIDTH = 480;
const HEIGHT = 720;
const FRAME = 1 / 60;

function assertFinite(world: TideKeepWorld, label: string): void {
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.waterLevel), `${label}: waterLevel`);
  assert.ok(Number.isFinite(world.keepIntegrity), `${label}: keepIntegrity`);
  for (const height of world.sandHeights) {
    assert.ok(Number.isFinite(height), `${label}: sandHeights entry`);
  }
}

test("起動直後はスコア0・波0回・全柱が同じ初期高さで始まる", () => {
  const world = new TideKeepWorld(WIDTH, HEIGHT);

  assert.equal(world.score, 0);
  assert.equal(world.waveIndex, 0);
  assert.equal(world.wavesSurvived, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.sandHeights.length, COLUMN_COUNT);
  assert.ok(
    world.sandHeights.every((h) => h === world.sandHeights[0]),
    "全柱が同じ初期高さ",
  );
  assert.ok(world.keepIntegrity > 0, "初期状態では砦は健全");
  assert.equal(world.shovelX, WIDTH / 2);
  assertFinite(world, "起動直後");
});

test("盛っていない間は一様な砂山の高さが(侵食が起きない範囲では)変化しない", () => {
  const world = new TideKeepWorld(WIDTH, HEIGHT);
  const before = [...world.sandHeights];

  for (let i = 0; i < 30; i++) world.step(FRAME);

  for (let i = 0; i < COLUMN_COUNT; i++) {
    assert.ok(
      Math.abs(world.sandHeights[i] - before[i]) < 1e-6,
      `柱${i}: 侵食される水位に達していない間は高さが変わらない`,
    );
  }
  assertFinite(world, "無操作30フレーム後");
});

test("ショベル位置に長押しすると、その周辺の柱だけ高さが盛り上がる", () => {
  const world = new TideKeepWorld(WIDTH, HEIGHT);
  const centerIndex = Math.floor(COLUMN_COUNT / 2);
  world.setShovelPosition((centerIndex + 0.5) * world.columnWidth);
  world.setPiling(true);

  for (let i = 0; i < 30; i++) world.step(FRAME);

  assert.ok(
    world.sandHeights[centerIndex] > world.sandHeights[0],
    "ショベル中心の柱は遠く離れた柱より高く盛られる",
  );
  assert.ok(
    world.sandHeights[centerIndex] > world.sandHeights[COLUMN_COUNT - 1],
    "ショベル中心の柱は反対側の遠い柱より高く盛られる",
  );
  assertFinite(world, "盛った後");
});

test("盛るのをやめると setPiling(false) 以降は柱が(侵食以外で)それ以上盛り上がらない", () => {
  const world = new TideKeepWorld(WIDTH, HEIGHT);
  const centerIndex = Math.floor(COLUMN_COUNT / 2);
  world.setShovelPosition((centerIndex + 0.5) * world.columnWidth);
  world.setPiling(true);
  for (let i = 0; i < 20; i++) world.step(FRAME);
  world.setPiling(false);
  const afterStop = world.sandHeights[centerIndex];

  for (let i = 0; i < 20; i++) world.step(FRAME);

  assert.ok(
    world.sandHeights[centerIndex] <= afterStop + 1e-6,
    "盛るのをやめたら中心の柱がそれ以上は高くならない",
  );
});

test("水没した柱は時間とともに削られ、砦ゾーンも例外なく侵食されうる", () => {
  const world = new TideKeepWorld(WIDTH, HEIGHT);
  world.sandHeights.fill(20); // 開始直後の水位(潮位のみ)より低い高さにしておく
  const before = [...world.sandHeights];

  world.step(FRAME);

  for (let i = 0; i < COLUMN_COUNT; i++) {
    assert.ok(world.sandHeights[i] < before[i], `柱${i}: 水没しているので削られる`);
  }
  assertFinite(world, "侵食後");
});

test("砦ゾーンの健全度が0になるとゲームオーバーになり、以後は状態が変化しない", () => {
  const world = new TideKeepWorld(WIDTH, HEIGHT);
  for (let i = KEEP_START_INDEX; i < KEEP_END_INDEX; i++) world.sandHeights[i] = 0;

  world.step(FRAME);

  assert.equal(world.isOver, true, "砦ゾーンの柱が崩れるとゲームオーバーになる");
  assertFinite(world, "ゲームオーバー直後");

  const frozenScore = world.score;
  const frozenHeights = [...world.sandHeights];
  world.setPiling(true);
  world.setShovelPosition(0);
  world.step(FRAME);

  assert.equal(world.score, frozenScore, "終了後はスコアが変化しない");
  assert.deepEqual(world.sandHeights, frozenHeights, "終了後は柱の高さも変化しない");
});

test("時間経過で波が発生し、砦が健全なら乗り切ってスコアにボーナスが乗る", () => {
  const world = new TideKeepWorld(WIDTH, HEIGHT);
  const resolved: WaveResolvedEvent[] = [];
  world.onWaveResolved = (event) => resolved.push(event);

  const stepsUntilFirstWaveResolves = Math.ceil(
    (WAVE_INTERVAL_START_SECONDS + WAVE_DURATION_SECONDS + 0.2) / FRAME,
  );
  for (let i = 0; i < stepsUntilFirstWaveResolves && !world.isOver; i++) world.step(FRAME);

  assert.ok(world.waveIndex >= 1, "最初の波が発生している");
  assert.equal(resolved.length, 1, "1回の波が解決イベントとして通知される");
  assert.equal(resolved[0].isKeepSafe, true, "初期状態の砂山なら最初の波は乗り切れる");
  assert.equal(world.wavesSurvived, 1);
  assert.ok(world.score > 0, "生存時間ぶんのスコアが加算されている");
  assertFinite(world, "最初の波を乗り切った後");
});

test("リサイズすると柱の高さとショベル位置が比例して追従し、不正なサイズは無視される", () => {
  const world = new TideKeepWorld(WIDTH, HEIGHT);
  world.setShovelPosition(WIDTH / 4);
  const heightBefore = world.sandHeights[0];

  world.resize(WIDTH * 2, HEIGHT * 2);

  assert.ok(Math.abs(world.shovelX - WIDTH / 2) < 1e-6, "幅が2倍になった分だけショベルxも伸びる");
  assert.ok(
    Math.abs(world.sandHeights[0] - heightBefore * 2) < 1e-6,
    "高さが2倍になった分だけ砂柱の高さも伸びる",
  );

  world.resize(0, 0);
  world.resize(-10, -10);
  assert.ok(world.width > 0 && world.height > 0, "不正なリサイズ値は無視される");
});

test("setShovelPosition / moveShovelBy は画面幅の範囲にクランプされる", () => {
  const world = new TideKeepWorld(WIDTH, HEIGHT);

  world.setShovelPosition(-100);
  assert.equal(world.shovelX, 0);

  world.setShovelPosition(WIDTH + 100);
  assert.equal(world.shovelX, WIDTH);

  world.setShovelPosition(WIDTH / 2);
  world.moveShovelBy(-WIDTH * 10);
  assert.equal(world.shovelX, 0);
});

test("reset() でスコア・波数・柱の高さなどが初期状態に戻る", () => {
  const world = new TideKeepWorld(WIDTH, HEIGHT);
  world.setShovelPosition(10);
  world.setPiling(true);
  for (let i = 0; i < 400; i++) world.step(FRAME);
  assert.ok(world.waveIndex > 0 || world.score > 0, "前提: プレイが進んでいる");

  world.reset();

  assert.equal(world.score, 0);
  assert.equal(world.waveIndex, 0);
  assert.equal(world.wavesSurvived, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.shovelX, WIDTH / 2);
  assert.ok(
    world.sandHeights.every((h) => h === world.sandHeights[0]),
    "全柱が同じ初期高さに戻る",
  );
});
