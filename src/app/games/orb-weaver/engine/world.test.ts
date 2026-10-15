import assert from "node:assert/strict";
import { test } from "node:test";
import type { BreachEvent } from "./world.ts";
import {
  CATCH_BAND_MAX,
  CATCH_BAND_MIN,
  INTEGRITY_MAX,
  MAX_BUGS,
  OrbWeaverWorld,
  REPAIR_DURATION_SECONDS,
  SPOKE_COUNT,
} from "./world.ts";

function forceSpawn(world: OrbWeaverWorld): void {
  // step()は内部のspawnTimerが尽きたときだけスポーンするため、十分大きいdtで必ず1つ出す。
  world.step(10);
}

/**
 * 虫の半径を捕獲圏の中心付近まで直接書き換える(タイミング検証用の下準備)。
 * step()で時間を進めて移動させると出現タイマーも一緒に進んでしまい、
 * 意図しない追加スポーン(やそれに伴う破れ・コンボリセット)を引き起こすため、直接代入する。
 */
function moveIntoCatchBand(world: OrbWeaverWorld, bugId: number): void {
  const bandCenter = (CATCH_BAND_MIN + CATCH_BAND_MAX) / 2;
  const bug = world.bugs.find((b) => b.id === bugId);
  assert.ok(bug, "対象の虫が存在する");
  if (!bug) return;
  bug.radius = bandCenter;
}

test("初期状態は虫無し・スコア0・耐久満タンで、全ての糸が健全", () => {
  const world = new OrbWeaverWorld();

  assert.equal(world.bugs.length, 0);
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.integrity, INTEGRITY_MAX);
  assert.equal(world.isOver, false);
  assert.equal(world.frayedSpokes.length, SPOKE_COUNT);
  assert.ok(world.frayedSpokes.every((isFrayed) => isFrayed === false));
});

test("時間経過で虫が現れ、中心へ向かって進む(radiusが減る)", () => {
  const world = new OrbWeaverWorld();
  forceSpawn(world);

  assert.equal(world.bugs.length, 1);
  const bug = world.bugs[0];
  assert.ok(bug.spokeIndex >= 0 && bug.spokeIndex < SPOKE_COUNT);
  assert.equal(bug.radius, 1);

  world.step(1 / 60);
  assert.ok(world.bugs[0].radius < 1, "中心に向かって進む");
});

test("捕獲圏に入っているときpluckすると捕獲でき、加点・コンボが伸びる", () => {
  const world = new OrbWeaverWorld();
  forceSpawn(world);
  const bug = world.bugs[0];
  moveIntoCatchBand(world, bug.id);

  const result = world.pluck(bug.spokeIndex);

  assert.equal(result, "caught");
  assert.equal(world.score, 112);
  assert.equal(world.combo, 1);
  assert.equal(world.integrity, INTEGRITY_MAX, "捕獲では耐久は減らない");
  assert.equal(world.bugs.length, 0, "捕獲された虫は消える");
});

test("連続捕獲でコンボボーナスが積み重なる", () => {
  const world = new OrbWeaverWorld();
  forceSpawn(world);
  const first = world.bugs[0];
  moveIntoCatchBand(world, first.id);
  world.pluck(first.spokeIndex);
  assert.equal(world.score, 112);

  forceSpawn(world);
  const second = world.bugs[0];
  moveIntoCatchBand(world, second.id);
  world.pluck(second.spokeIndex);
  assert.equal(world.score, 112 + (100 + 24), "2回目はコンボ2本分のボーナスが乗る");
});

test("捕獲圏の外でpluckしても何も起きない(missで状態は変わらない)", () => {
  const world = new OrbWeaverWorld();
  forceSpawn(world);
  const bug = world.bugs[0];

  const result = world.pluck(bug.spokeIndex);

  assert.equal(result, "miss");
  assert.equal(world.score, 0);
  assert.equal(world.bugs.length, 1, "捕獲圏外のpluckでは虫は消えない");
});

test("虫が中心に到達すると巣が破れ、耐久が減ってコンボがリセットされる", () => {
  const world = new OrbWeaverWorld();
  forceSpawn(world);
  const bug = world.bugs[0];
  const breaches: BreachEvent[] = [];
  world.onBreach = (event) => {
    breaches.push(event);
  };

  world.step(100); // 十分大きいdtで必ず中心まで到達させる

  assert.equal(breaches.length, 1, "onBreachが1回発火する");
  assert.equal(breaches[0].spokeIndex, bug.spokeIndex);
  assert.equal(world.integrity, INTEGRITY_MAX - 14);
  assert.equal(world.frayedSpokes[bug.spokeIndex], true, "到達した糸は破れる");
});

test("破れた糸はpluckしても捕獲できず、frayedが返る", () => {
  const world = new OrbWeaverWorld();
  forceSpawn(world);
  const bug = world.bugs[0];
  const spokeIndex = bug.spokeIndex;
  world.step(100); // breachさせて該当の糸を破れた状態にする

  assert.equal(world.pluck(spokeIndex), "frayed", "破れている間は捕獲判定より先にfrayedを返す");
});

test("破れた糸を長押し(setRepairing)し続けると補修され、以後また捕獲できる", () => {
  const world = new OrbWeaverWorld();
  forceSpawn(world);
  const bug = world.bugs[0];
  const spokeIndex = bug.spokeIndex;
  world.step(100); // breach させて破れた状態にする
  assert.equal(world.frayedSpokes[spokeIndex], true);

  world.setRepairing(spokeIndex, true);
  let repaired: { spokeIndex: number } | null = null;
  world.onRepair = (event) => {
    repaired = event;
  };

  // 途中まで補修してもまだ破れたまま。
  world.step(REPAIR_DURATION_SECONDS / 2);
  assert.equal(world.frayedSpokes[spokeIndex], true, "補修完了前は破れたまま");
  assert.ok(world.repairProgressAt(spokeIndex) > 0 && world.repairProgressAt(spokeIndex) < 1);

  world.step(REPAIR_DURATION_SECONDS / 2 + 0.01);
  assert.equal(world.frayedSpokes[spokeIndex], false, "補修完了で健全に戻る");
  assert.ok(repaired, "onRepairが発火する");
  assert.equal(world.repairProgressAt(spokeIndex), 0, "完了後は進捗がリセットされる");
});

test("補修の手を離すと進捗は保持されるが、それ以上は進まない", () => {
  const world = new OrbWeaverWorld();
  forceSpawn(world);
  const bug = world.bugs[0];
  const spokeIndex = bug.spokeIndex;
  world.step(100);

  world.setRepairing(spokeIndex, true);
  world.step(REPAIR_DURATION_SECONDS / 3);
  const progressWhileHeld = world.repairProgressAt(spokeIndex);
  assert.ok(progressWhileHeld > 0);

  world.setRepairing(spokeIndex, false);
  world.step(REPAIR_DURATION_SECONDS / 3);
  assert.equal(
    world.repairProgressAt(spokeIndex),
    progressWhileHeld,
    "手を離している間は進捗が変化しない",
  );
});

test("耐久が0になるとゲームオーバーになり、以降は状態が変化しない", () => {
  const world = new OrbWeaverWorld();
  const breachesNeeded = Math.ceil(INTEGRITY_MAX / 14);

  for (let i = 0; i < breachesNeeded; i++) {
    forceSpawn(world);
    world.step(100);
  }

  assert.equal(world.isOver, true);
  assert.equal(world.integrity, 0);

  const scoreBefore = world.score;
  world.step(5);
  assert.equal(world.bugs.length, 0, "ゲームオーバー後はstepしてもスポーンしない");
  assert.equal(world.score, scoreBefore);
  assert.equal(world.pluck(0), "miss", "ゲームオーバー後のpluckは常にmiss");
});

test("reset()で最初の状態に戻る", () => {
  const world = new OrbWeaverWorld();
  forceSpawn(world);
  const bug = world.bugs[0];
  moveIntoCatchBand(world, bug.id);
  world.pluck(bug.spokeIndex);

  world.reset();

  assert.equal(world.bugs.length, 0);
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.integrity, INTEGRITY_MAX);
  assert.equal(world.isOver, false);
  assert.ok(world.frayedSpokes.every((isFrayed) => isFrayed === false));
});

test("連続捕獲で難易度が上がる(虫の速度上昇・出現間隔短縮)", () => {
  const world = new OrbWeaverWorld();
  const initialSpeed = world.bugSpeed;
  const initialSpawnInterval = world.spawnInterval;

  for (let i = 0; i < 6; i++) {
    forceSpawn(world);
    const bug = world.bugs[0];
    moveIntoCatchBand(world, bug.id);
    world.pluck(bug.spokeIndex);
  }

  assert.ok(world.bugSpeed > initialSpeed, "虫の速度が上がる");
  assert.ok(world.spawnInterval < initialSpawnInterval, "出現間隔が短くなる");
});

test("虫の数には上限があり、無限に増え続けない", () => {
  const world = new OrbWeaverWorld();
  let reachedCap = false;

  // 何も捕獲しない場合、出現間隔(約1.4秒)より虫が中心に達する時間(約6.25秒)の方が長いため、
  // 複数匹が同時にベルト上へ積み重なり、上限(MAX_BUGS)にぶつかるはずの時間だけ進める。
  for (let i = 0; i < 80; i++) {
    world.step(0.1);
    assert.ok(world.bugs.length <= MAX_BUGS, `上限(${MAX_BUGS}匹)を超えて増えない`);
    if (world.bugs.length === MAX_BUGS) reachedCap = true;
  }

  assert.ok(reachedCap, "十分な時間が経てば実際に上限まで積み重なる");
});
