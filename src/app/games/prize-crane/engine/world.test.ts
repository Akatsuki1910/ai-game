import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ATTEMPTS_MAX,
  CHUTE_X_MAX,
  getPrizeValue,
  PRIZE_SLOT_COUNT,
  PRIZE_TIERS,
  PrizeCraneWorld,
  SLOT_X_RATIOS,
} from "./world.ts";

/** どのtierでも確実に失敗する(全スロットから最大許容距離より離れている)位置。 */
const GUARANTEED_MISS_X = 0.05;

function driveToResolution(world: PrizeCraneWorld): void {
  world.step(world.descendDuration);
  world.step(world.ascendDuration);
}

test("初期状態はスロット満杯・スコア0・アテンプト満タン・idle", () => {
  const world = new PrizeCraneWorld();

  assert.equal(world.prizes.length, PRIZE_SLOT_COUNT);
  for (const prize of world.prizes) assert.ok(PRIZE_TIERS.includes(prize.tier));
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.attempts, ATTEMPTS_MAX);
  assert.equal(world.isOver, false);
  assert.equal(world.phase, "idle");
  assert.equal(world.carriedTier, null);
});

test("idle中はsetClawXで自由に移動できる", () => {
  const world = new PrizeCraneWorld();
  world.setClawX(0.7);
  assert.equal(world.clawX, 0.7);
  world.setClawX(-1);
  assert.equal(world.clawX, 0, "範囲外(負)は0にクランプされる");
  world.setClawX(2);
  assert.equal(world.clawX, 1, "範囲外(超過)は1にクランプされる");
});

test("triggerActionでidleから降下が始まり、アテンプトを1消費する", () => {
  const world = new PrizeCraneWorld();
  world.triggerAction();

  assert.equal(world.phase, "descending");
  assert.equal(world.attempts, ATTEMPTS_MAX - 1);
});

test("降下・上昇中はsetClawXを受け付けない(狙いが固定される)", () => {
  const world = new PrizeCraneWorld();
  world.setClawX(0.3);
  world.triggerAction();

  world.setClawX(0.9);
  assert.equal(world.clawX, 0.3, "降下中は移動できない");

  world.step(world.descendDuration);
  assert.equal(world.phase, "ascending");
  world.setClawX(0.9);
  assert.equal(world.clawX, 0.3, "上昇中も移動できない");
});

test("スロットの中心にぴったり合わせると必ずつかめる", () => {
  const world = new PrizeCraneWorld();
  const target = world.prizes.find((p) => p.slotIndex === 0);
  assert.ok(target);

  world.setClawX(SLOT_X_RATIOS[0]);
  world.triggerAction();
  driveToResolution(world);

  assert.equal(world.phase, "carrying");
  assert.equal(world.carriedTier, target.tier);
  assert.equal(world.prizes.length, PRIZE_SLOT_COUNT - 1, "つかんだ景品は一時的にビンから消える");
});

test("どのスロットからも十分離れた位置では必ず外れる", () => {
  const world = new PrizeCraneWorld();
  world.setClawX(GUARANTEED_MISS_X);
  world.triggerAction();
  driveToResolution(world);

  assert.equal(world.phase, "idle", "外れると何も持たずidleに戻る");
  assert.equal(world.carriedTier, null);
  assert.equal(world.prizes.length, PRIZE_SLOT_COUNT, "外れても景品は減らない");
  assert.equal(world.combo, 0);
});

test("搬出口まで運んで置くと得点が入り、スロットには新しい景品が補充される", () => {
  const world = new PrizeCraneWorld();
  world.setClawX(SLOT_X_RATIOS[0]);
  world.triggerAction();
  driveToResolution(world);
  assert.equal(world.phase, "carrying");

  world.setClawX(0);
  assert.ok(world.clawX <= CHUTE_X_MAX);
  world.triggerAction();

  assert.equal(world.phase, "idle");
  assert.ok(world.score > 0, "搬出で加点される");
  assert.equal(world.combo, 1);
  assert.equal(world.prizes.length, PRIZE_SLOT_COUNT, "スロットに新しい景品が補充される");
});

test("連続搬出でコンボボーナスが積み重なる", () => {
  const world = new PrizeCraneWorld();

  const firstPrize = world.prizes.find((p) => p.slotIndex === 0);
  assert.ok(firstPrize);
  world.setClawX(SLOT_X_RATIOS[0]);
  world.triggerAction();
  driveToResolution(world);
  world.setClawX(0);
  world.triggerAction();
  assert.equal(world.score, getPrizeValue(firstPrize.tier), "1回目はコンボボーナス無し");

  const secondPrize = world.prizes.find((p) => p.slotIndex === 1);
  assert.ok(secondPrize);
  world.setClawX(SLOT_X_RATIOS[1]);
  world.triggerAction();
  driveToResolution(world);
  world.setClawX(0);
  world.triggerAction();

  assert.equal(world.combo, 2);
  const expectedSecondPoints = getPrizeValue(secondPrize.tier) + 1 * 20;
  assert.equal(
    world.score,
    getPrizeValue(firstPrize.tier) + expectedSecondPoints,
    "2回目はコンボ1本分のボーナスが乗る",
  );
});

test("搬出口の外で置くと取り落とし(fumble)になり、景品はビンに戻る", () => {
  const world = new PrizeCraneWorld();
  world.setClawX(SLOT_X_RATIOS[2]);
  world.triggerAction();
  driveToResolution(world);
  assert.equal(world.phase, "carrying");
  const scoreBefore = world.score;

  // 搬出口(CHUTE_X_MAX以下)の外側で置く。
  world.triggerAction();

  assert.equal(world.phase, "idle");
  assert.equal(world.score, scoreBefore, "搬出口外では加点されない");
  assert.equal(world.combo, 0);
  assert.equal(world.prizes.length, PRIZE_SLOT_COUNT, "取り落とした景品はビンに戻る(消えない)");
});

test("運搬中に大きく振ると(swing)取り落とす", () => {
  const world = new PrizeCraneWorld();
  world.setClawX(SLOT_X_RATIOS[4]);
  world.triggerAction();
  driveToResolution(world);
  assert.equal(world.phase, "carrying");

  // 振り切るまで往復させる。
  let guard = 0;
  while (world.phase === "carrying" && guard < 50) {
    world.setClawX(guard % 2 === 0 ? 0.95 : 0.05);
    guard += 1;
  }

  assert.equal(world.phase, "idle", "振り切ると自動的に取り落とされる");
  assert.equal(world.combo, 0);
  assert.equal(world.prizes.length, PRIZE_SLOT_COUNT);
});

test("振り(swing)は時間経過で減衰する", () => {
  const world = new PrizeCraneWorld();
  world.setClawX(SLOT_X_RATIOS[0]);
  world.triggerAction();
  driveToResolution(world);
  world.setClawX(SLOT_X_RATIOS[0] + 0.08);
  const swingAfterMove = world.swingRatio;
  assert.ok(
    swingAfterMove > 0 && world.phase === "carrying",
    "移動直後は振りが乗るが落ちるほどではない",
  );

  world.step(0.1);
  assert.ok(world.swingRatio < swingAfterMove, "時間経過で振りが収まる");
});

test("アテンプトが尽きるとゲームオーバーになり、以降の操作は無効", () => {
  const world = new PrizeCraneWorld();

  for (let i = 0; i < ATTEMPTS_MAX; i++) {
    world.setClawX(GUARANTEED_MISS_X);
    world.triggerAction();
    driveToResolution(world);
  }

  assert.equal(world.attempts, 0);
  assert.equal(world.isOver, true);

  const scoreBefore = world.score;
  world.triggerAction();
  assert.equal(world.phase, "idle", "ゲームオーバー後はアクションが無視される");
  assert.equal(world.score, scoreBefore);
  world.setClawX(0.9);
  assert.equal(world.clawX, GUARANTEED_MISS_X, "ゲームオーバー後は移動も無視される");
});

test("reset()で最初の状態に戻る", () => {
  const world = new PrizeCraneWorld();
  world.setClawX(SLOT_X_RATIOS[0]);
  world.triggerAction();
  driveToResolution(world);
  world.setClawX(0);
  world.triggerAction();

  world.reset();

  assert.equal(world.prizes.length, PRIZE_SLOT_COUNT);
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.attempts, ATTEMPTS_MAX);
  assert.equal(world.isOver, false);
  assert.equal(world.phase, "idle");
});

test("搬出を重ねるほど許容距離・サイクル時間の難易度が上がり、下限でクランプされる", () => {
  const world = new PrizeCraneWorld();
  const initialTolerance = world.toleranceMultiplier;
  const initialDuration = world.durationMultiplier;

  // スロットへ正確に合わせるので、許容距離が狙まっても必ずつかめる(搬出成功)。
  function deliverFromSlot(slotIndex: number): void {
    world.setClawX(SLOT_X_RATIOS[slotIndex]);
    world.triggerAction();
    driveToResolution(world);
    assert.equal(world.phase, "carrying", "狙いが正確なので毎回つかめる");
    world.setClawX(0);
    world.triggerAction();
  }

  for (let i = 0; i < 3; i++) deliverFromSlot(i % SLOT_X_RATIOS.length);

  assert.ok(world.toleranceMultiplier < initialTolerance, "許容距離の係数が下がる");
  assert.ok(world.durationMultiplier < initialDuration, "サイクル時間の係数が下がる(速くなる)");
  assert.equal(world.isOver, false);

  // 残りのアテンプトを使い切るまで搬出を続ける(ATTEMPTS_MAX回で丁度アテンプトが尽きる)。
  for (let i = 3; i < ATTEMPTS_MAX; i++) deliverFromSlot(i % SLOT_X_RATIOS.length);

  assert.equal(world.isOver, true);
  assert.equal(world.toleranceMultiplier, 0.55, "許容距離の係数は下限でクランプされる");
  assert.equal(world.durationMultiplier, 0.6, "サイクル時間の係数は下限でクランプされる");
});
