import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CUP_GRADE,
  GOOD_BAND,
  judgeFill,
  KyusuPourWorld,
  LIFE_LOST_REASON,
  type LifeLostReason,
  MAX_LIVES,
  PERFECT_BAND,
  SPILL_MAX,
  SPOUT_X,
} from "./world.ts";

// このゲームのロジックは同期的な純粋計算のみで、非同期の競合・権限・キャッシュは存在しないため、
// それらの観点はテスト対象外とする（境界値・ゼロ件・失敗・中断・再入は以下でカバーする）。

const WIDTH = 960;
const HEIGHT = 540;
const FRAME = 1 / 60;

function createWorld(): KyusuPourWorld {
  const world = new KyusuPourWorld(() => 0.5);
  world.resize(WIDTH, HEIGHT);
  return world;
}

function stepUntil(world: KyusuPourWorld, condition: () => boolean, maxFrames = 2000): void {
  for (let i = 0; i < maxFrames; i++) {
    if (condition()) return;
    world.step(FRAME);
  }
  assert.fail("条件を満たす前にフレーム上限に達した");
}

function warmupCup(world: KyusuPourWorld) {
  const cup = world.nextCup;
  assert.ok(cup, "最初の湯呑みが用意されている");
  return cup;
}

test("起動直後はライフ満タン・こぼれ0で、最初の湯呑みはまだ注ぎ口に届いていない", () => {
  const world = createWorld();
  const cup = warmupCup(world);

  assert.equal(world.lives, MAX_LIVES);
  assert.equal(world.spilled, 0);
  assert.equal(world.score, 0);
  assert.equal(world.servedCount, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.cups.length, 1);
  assert.equal(world.isUnderSpout(cup), false);
  assert.ok(cup.x > SPOUT_X, "湯呑みは注ぎ口より右から流れてくる");
});

test("押していない間は急須が傾かず、お茶は1滴も出ない", () => {
  const world = createWorld();
  for (let i = 0; i < 60; i++) world.step(FRAME);

  assert.equal(world.tilt, 0);
  assert.equal(world.drops.length, 0);
  assert.equal(world.pendingVolume, 0);
  assert.equal(world.spilled, 0);
});

test("湯呑みが無いところへ注ぐとこぼれが溜まり、上限に達するとライフを1失ってこぼれは0に戻る", () => {
  const world = createWorld();
  const reasons: LifeLostReason[] = [];
  world.onLifeLost = (reason) => reasons.push(reason);

  world.setPouring(true);
  stepUntil(world, () => world.spilled > 0);
  assert.ok(world.isUnderSpout(warmupCup(world)) === false, "最初の湯呑みが来る前にこぼれ始める");

  stepUntil(world, () => world.lives < MAX_LIVES);
  assert.equal(world.lives, MAX_LIVES - 1);
  assert.ok(world.spilled < SPILL_MAX, "こぼれ量はライフ消費と引き換えにリセットされる");
  assert.deepEqual(reasons, [LIFE_LOST_REASON.spilled]);
});

test("湯呑みの到着に合わせて注ぎ、空中の分まで見越して止めると高評価で得点しコンボが伸びる", () => {
  const world = createWorld();
  const cup = warmupCup(world);
  const served: string[] = [];
  world.onCupServed = ({ grade }) => served.push(grade);

  // 落下時間を考えずに、湯呑みが注ぎ口の真下に来てから注ぎ始める(ストーリーテストと同じ戦略)
  stepUntil(world, () => world.isUnderSpout(cup));
  world.setPouring(true);
  stepUntil(
    world,
    () => cup.filled + world.pendingVolume >= cup.capacity * (cup.targetRatio - 0.05),
  );
  world.setPouring(false);
  stepUntil(world, () => cup.grade !== null);

  assert.ok(
    cup.grade === CUP_GRADE.perfect || cup.grade === CUP_GRADE.good,
    `高評価になる: ${cup.grade} (水位 ${(cup.filled / cup.capacity).toFixed(2)} / 目標 ${cup.targetRatio})`,
  );
  assert.ok(world.score > 0);
  assert.equal(world.combo, 1);
  assert.equal(world.lives, MAX_LIVES);
  assert.equal(world.servedCount, 1);
  assert.deepEqual(served, [cup.grade]);
});

test("何も注がずに湯呑みを見送ると「少ない」判定でライフを失い、コンボも切れる", () => {
  const world = createWorld();
  const cup = warmupCup(world);
  const reasons: LifeLostReason[] = [];
  world.onLifeLost = (reason) => reasons.push(reason);

  stepUntil(world, () => cup.grade !== null);

  assert.equal(cup.grade, CUP_GRADE.short);
  assert.equal(world.lastGrade, CUP_GRADE.short);
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.lives, MAX_LIVES - 1);
  assert.deepEqual(reasons, [LIFE_LOST_REASON.missedCup]);
});

test("湯呑みの上で注ぎ続けると溢れて「入れすぎ」になり、溢れた分はこぼれに加算される", () => {
  const world = createWorld();
  const cup = warmupCup(world);

  stepUntil(world, () => world.isUnderSpout(cup));
  world.setPouring(true);
  stepUntil(world, () => cup.hasOverflowed);
  assert.equal(cup.filled, cup.capacity, "満杯より多くは入らない");
  assert.ok(world.spilled > 0, "溢れた分がこぼれになる");

  world.setPouring(false);
  stepUntil(world, () => cup.grade !== null);
  assert.equal(cup.grade, CUP_GRADE.over);
  assert.ok(world.lives < MAX_LIVES);
});

test("ライフが尽きると閉店して進行が止まり、リセットすると何度でも初期状態から遊び直せる", () => {
  const world = createWorld();
  world.setPouring(true);
  stepUntil(world, () => world.isOver, 6000);

  assert.equal(world.lives, 0);
  assert.equal(world.isPouring, false, "閉店時に注ぎは止まる");
  const frozenTravel = world.beltTravel;
  world.setPouring(true);
  world.step(FRAME);
  assert.equal(world.beltTravel, frozenTravel, "閉店後はベルトも止まる");

  for (let round = 0; round < 2; round++) {
    world.reset();
    assert.equal(world.lives, MAX_LIVES);
    assert.equal(world.spilled, 0);
    assert.equal(world.score, 0);
    assert.equal(world.isOver, false);
    assert.equal(world.lastGrade, null);
    assert.equal(world.drops.length, 0);
    assert.equal(world.cups.length, 1);
  }
});

test("湯呑みは重ならずに流れ続け、採点が進むほどベルトが速くなる", () => {
  const world = createWorld();
  const initialSpeed = world.beltSpeed;

  // 採点を通すため、湯呑みの下でだけ注いでライフを長持ちさせる
  for (let i = 0; i < 3000 && world.servedCount < 6 && !world.isOver; i++) {
    const cup = world.nextCup;
    world.setPouring(
      cup !== null &&
        world.isUnderSpout(cup) &&
        cup.filled + world.pendingVolume < cup.capacity * cup.targetRatio,
    );
    world.step(FRAME);

    const ordered = world.cups.every((current, index) => {
      const previous = world.cups[index - 1];
      return !previous || previous.x + previous.width / 2 <= current.x - current.width / 2;
    });
    assert.ok(ordered, "湯呑み同士が重ならない");
  }

  assert.ok(world.servedCount >= 6, `複数杯採点される: ${world.servedCount}`);
  assert.ok(world.beltSpeed > initialSpeed, "ベルトが加速する");
  for (const cup of world.cups) {
    assert.ok(cup.capacity > 0, "満杯量が正");
    assert.ok(cup.targetRatio > 0 && cup.targetRatio < 1, "目標水位は湯呑みの中");
  }
});

test("大きなフレーム落ち(delta 0.1秒)でも滴が縁をすり抜けずに湯呑みへ入る", () => {
  const world = createWorld();
  const cup = warmupCup(world);
  stepUntil(world, () => world.isUnderSpout(cup));
  world.setPouring(true);
  for (let i = 0; i < 4; i++) world.step(0.1);
  world.setPouring(false);
  for (let i = 0; i < 6; i++) world.step(0.1);

  assert.ok(cup.filled > 0, "粗いステップでも湯呑みに入る");
});

test("0以下のサイズや0以下のdeltaは無視され、状態が壊れない", () => {
  const world = createWorld();
  const cup = warmupCup(world);
  const heightBefore = world.cupHeight(cup);
  world.resize(0, 0);
  world.resize(-10, 300);
  assert.equal(world.cupHeight(cup), heightBefore);

  const xBefore = cup.x;
  world.step(0);
  world.step(-1);
  assert.equal(cup.x, xBefore);

  world.resize(390, 780);
  const portraitHeight = world.cupHeight(cup);
  assert.ok(Number.isFinite(portraitHeight) && portraitHeight > 0, "縦長でも湯呑みの高さが有限");
});

test("水位の採点は目標との差の帯で決まり、溢れさせたら水位に関わらず入れすぎ", () => {
  assert.equal(judgeFill(0.7, 0.7, false), CUP_GRADE.perfect);
  assert.equal(judgeFill(0.7 + PERFECT_BAND - 0.001, 0.7, false), CUP_GRADE.perfect);
  assert.equal(judgeFill(0.7 - GOOD_BAND + 0.001, 0.7, false), CUP_GRADE.good);
  assert.equal(judgeFill(0.7 - GOOD_BAND - 0.01, 0.7, false), CUP_GRADE.short);
  assert.equal(judgeFill(0.7 + GOOD_BAND + 0.01, 0.7, false), CUP_GRADE.over);
  assert.equal(judgeFill(0, 0.7, false), CUP_GRADE.short);
  assert.equal(judgeFill(0.7, 0.7, true), CUP_GRADE.over);
});
