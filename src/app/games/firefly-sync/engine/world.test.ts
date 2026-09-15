import assert from "node:assert/strict";
import { test } from "node:test";
import { FireflyWorld, TAP_ENERGY_COST } from "./world.ts";

/** 決定的な乱数(mulberry32)。テストの再現性のためだけに使う。 */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createWorld(seed = 1): FireflyWorld {
  return new FireflyWorld(400, 300, { random: seededRandom(seed) });
}

test("初期状態: 1夜目の設定・満タンのエネルギー・空の合唱計が揃っている", () => {
  const world = createWorld();

  assert.equal(world.night, 1);
  assert.equal(world.score, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.outcome, null);
  assert.equal(world.energy, 1);
  assert.equal(world.chorusMeter, 0);
  assert.equal(world.orderParameter, 0);
  assert.equal(world.timeRemaining, world.timeLimit);
  assert.equal(world.fireflies.length, 20, "1夜目は20匹");
  for (const firefly of world.fireflies) {
    assert.ok(firefly.phase >= 0 && firefly.phase < 1, "位相は0〜1の範囲");
  }
});

test("step() で時間が減り、秩序変数と合唱計が範囲内に収まる", () => {
  const world = createWorld();
  const before = world.timeRemaining;

  for (let i = 0; i < 60; i++) world.step(1 / 60);

  assert.ok(world.timeRemaining < before, "残り時間が減る");
  assert.ok(world.orderParameter >= 0 && world.orderParameter <= 1, "秩序変数は0〜1");
  assert.ok(world.chorusMeter >= 0 && world.chorusMeter <= 1, "合唱計は0〜1にクランプされる");
});

test("何もパルスを送らずに時間切れになると、合唱計が満ちないまま dusk-faded で終了する", () => {
  const world = createWorld(2);

  for (let i = 0; i < 60 * 60 && !world.isOver; i++) {
    world.step(1 / 60);
  }

  assert.equal(world.isOver, true);
  assert.equal(world.outcome, "duskFaded");
  assert.ok(world.chorusMeter < 1, "無操作では合唱計は満ちない");
  assert.equal(world.timeRemaining, 0);
});

test("applyPulseAtStagePoint はエネルギー不足だと発動せず false を返す", () => {
  const world = createWorld(3);

  const first = world.applyPulseAtStagePoint(world.width / 2, world.height / 2);
  assert.equal(first, true, "満タンのエネルギーなら発動する");
  assert.ok(world.energy < 1, "エネルギーが消費される");

  let deniedAtLeastOnce = false;
  for (let i = 0; i < 10; i++) {
    const accepted = world.applyPulseAtStagePoint(world.width / 2, world.height / 2);
    if (!accepted) deniedAtLeastOnce = true;
  }
  assert.ok(deniedAtLeastOnce, "連打してもエネルギーが尽きれば発動しなくなる");
  assert.ok(world.energy >= 0, "エネルギーは負にならない");
});

test("エネルギーは時間経過で回復し、再びパルスを送れるようになる", () => {
  const world = createWorld(4);

  while (world.applyPulseAtStagePoint(world.width / 2, world.height / 2)) {
    // エネルギーが尽きるまで送り続ける
  }
  assert.ok(world.energy < TAP_ENERGY_COST);

  for (let i = 0; i < 120; i++) world.step(1 / 60);

  assert.ok(world.energy >= TAP_ENERGY_COST, "2秒も経てば回復している");
  assert.equal(world.applyPulseAtStagePoint(world.width / 2, world.height / 2), true);
});

test("ゲーム終了後は step も applyPulseAtStagePoint も状態を変えない", () => {
  const world = createWorld(5);
  for (let i = 0; i < 60 * 60 && !world.isOver; i++) world.step(1 / 60);
  assert.equal(world.isOver, true);

  const energyBefore = world.energy;
  const chorusBefore = world.chorusMeter;
  world.step(1);
  assert.equal(world.energy, energyBefore, "終了後はstepしても変化しない");
  assert.equal(world.chorusMeter, chorusBefore);
  assert.equal(world.applyPulseAtStagePoint(0, 0), false, "終了後はパルスも発動しない");
});

test("合唱計が満ちると次の夜へ進み、スコアが加算され、時間制限が短くなる", () => {
  const world = createWorld(6);
  const initialTimeLimit = world.timeLimit;

  world.chorusMeter = 1;
  world.step(0);

  assert.equal(world.night, 2, "夜が進む");
  assert.ok(world.score > 0, "クリア報酬が加算される");
  assert.ok(world.chorusMeter < 1, "新しい夜では合唱計がリセットされる");
  assert.ok(world.timeLimit <= initialTimeLimit, "夜が進むほど制限時間は短くなる(下限あり)");
  assert.equal(world.timeRemaining, world.timeLimit, "新しい夜は満タンの持ち時間で始まる");
  assert.equal(world.isOver, false);
});

test("resize() すると既存のホタルの位置が新しいアリーナサイズに合わせて比例縮尺される", () => {
  const world = createWorld(7);
  const before = world.fireflies.map((f) => ({ x: f.x, y: f.y }));
  const arenaBefore = world.arenaSize;

  world.resize(800, 600);
  const scale = world.arenaSize / arenaBefore;
  const after = world.fireflies;

  for (let i = 0; i < before.length; i++) {
    assert.ok(
      Math.abs(after[i].x - before[i].x * scale) < 1e-6,
      "x座標がアリーナの拡大率に比例して伸縮する",
    );
    assert.ok(
      Math.abs(after[i].y - before[i].y * scale) < 1e-6,
      "y座標がアリーナの拡大率に比例して伸縮する",
    );
  }
});

test("reset() で1夜目の状態に戻る", () => {
  const world = createWorld(8);
  world.chorusMeter = 1;
  world.step(0);
  assert.equal(world.night, 2);

  world.reset();

  assert.equal(world.night, 1);
  assert.equal(world.score, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.outcome, null);
  assert.equal(world.chorusMeter, 0);
  assert.equal(world.fireflies.length, 20);
});

test("中央へパルスを送り続けると、1夜目は現実的な時間内にクリアできる(バランス回帰テスト)", () => {
  const world = createWorld(9);
  const dt = 1 / 60;
  const maxSteps = 60 * 20;

  for (let i = 0; i < maxSteps && world.night < 2; i++) {
    world.step(dt);
    world.applyPulseAtStagePoint(world.width / 2, world.height / 2);
  }

  assert.equal(world.night, 2, "適切に操作すれば20秒以内に1夜目をクリアできる");
  assert.ok(world.score > 0);
});
