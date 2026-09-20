import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HAZARD_KIND,
  LANE_COUNT,
  type Lane,
  LIVES_MAX,
  NigiriWorld,
  SUSHI_KINDS,
} from "./world.ts";

const GUARD_LIMIT = 200;

/**
 * 条件に合うレーンが出現するまで時間を進める。
 * 探している条件が「注文中のネタ以外」のときに注文中のネタが偶然出現すると、
 * 探索中に放置タイムアウトしてライフが減ってしまい、その後のテストの前提
 * （このアクションの直前はまだフルライフ、など）を壊してしまう。そのため
 * 探索中に見つかった注文中のネタは、探索を汚さないようその場で正解として
 * 取り除いてから探索を続ける。
 */
/**
 * 出現中の注文中ネタのレーンをすべて正解として取り除く。1件取ると次の注文に
 * 切り替わり、それに別のレーンが偶然一致することがあるため、変化がなくなる
 * まで繰り返す(同時出現数が2以上のときに必要)。
 */
function resolveActiveTargetLanes(world: NigiriWorld): void {
  let resolvedAny = true;
  while (resolvedAny) {
    resolvedAny = false;
    for (const lane of world.lanes) {
      if (lane.state === "active" && lane.kind === world.target) {
        world.attemptGrab(lane.index);
        resolvedAny = true;
      }
    }
  }
}

function spawnUntil(world: NigiriWorld, predicate: (lane: Lane) => boolean): Lane {
  for (let guard = 0; guard < GUARD_LIMIT; guard++) {
    const found = world.lanes.find(predicate);
    if (found) return found;
    resolveActiveTargetLanes(world);
    world.step(world.spawnInterval);
  }
  throw new Error("条件を満たすレーンが出現しなかった");
}

function activeLane(world: NigiriWorld): Lane {
  return spawnUntil(world, (lane) => lane.state === "active");
}

function activeLaneWithKind(world: NigiriWorld, kind: string): Lane {
  return spawnUntil(world, (lane) => lane.state === "active" && lane.kind === kind);
}

function activeLaneWithTarget(world: NigiriWorld): Lane {
  return spawnUntil(world, (lane) => lane.state === "active" && lane.kind === world.target);
}

function activeLaneNotTarget(world: NigiriWorld): Lane {
  return spawnUntil(
    world,
    (lane) => lane.state === "active" && lane.kind !== null && lane.kind !== world.target,
  );
}

/** 注文と違うが、わさびではない(=取ると"wrongItem"になる)出現中レーンを待つ。 */
function activeLaneWrongEdible(world: NigiriWorld): Lane {
  return spawnUntil(
    world,
    (lane) =>
      lane.state === "active" &&
      lane.kind !== null &&
      lane.kind !== world.target &&
      lane.kind !== HAZARD_KIND,
  );
}

test("起動直後は全レーンが空で、スコア・ライフ・注文が初期状態になっている", () => {
  const world = new NigiriWorld();

  assert.equal(world.lanes.length, LANE_COUNT);
  assert.ok(
    world.lanes.every((lane) => lane.state === "empty" && lane.kind === null),
    "開始時は全レーンが空",
  );
  assert.equal(world.score, 0);
  assert.equal(world.lives, LIVES_MAX);
  assert.equal(world.isOver, false);
  assert.ok(SUSHI_KINDS.includes(world.target), "注文は取れるネタの中から選ばれる");
});

test("時間経過でレーンに寿司が出現する", () => {
  const world = new NigiriWorld();
  const lane = activeLane(world);
  assert.ok(lane.kind !== null);
  assert.ok(lane.timer > 0 && lane.timer <= lane.duration);
});

test("注文と同じネタを取るとスコアが増え、次の注文に切り替わる。ライフは減らない", () => {
  const world = new NigiriWorld();
  const previousTarget = world.target;
  const lane = activeLaneWithTarget(world);

  const result = world.attemptGrab(lane.index);

  assert.equal(result, "correct");
  assert.ok(world.score > 0);
  assert.equal(world.lives, LIVES_MAX, "正解ではライフは減らない");
  assert.equal(world.lanes[lane.index].state, "cooldown");
  assert.notEqual(world.target, previousTarget, "注文は毎回変わる");
});

test("注文と違うネタを取るとライフが減り、注文は変わらない", () => {
  const world = new NigiriWorld();
  const lane = activeLaneWrongEdible(world);
  const previousTarget = world.target;
  const scoreBefore = world.score;
  const livesBefore = world.lives;

  const result = world.attemptGrab(lane.index);

  assert.equal(result, "wrongItem");
  assert.equal(world.score, scoreBefore, "誤答では加点されない");
  assert.equal(world.lives, livesBefore - 1);
  assert.equal(world.target, previousTarget, "誤答では注文は変わらない");
});

test("わさびを取るとライフが減る(注文と一致していても不一致でも常にペナルティ)", () => {
  const world = new NigiriWorld();
  const lane = activeLaneWithKind(world, HAZARD_KIND);
  const scoreBefore = world.score;
  const livesBefore = world.lives;

  const result = world.attemptGrab(lane.index);

  assert.equal(result, "hazard");
  assert.equal(world.score, scoreBefore, "わさびを取っても加点されない");
  assert.equal(world.lives, livesBefore - 1);
});

test("空/冷却中のレーンや範囲外indexへのグラブは無効で状態を変えない", () => {
  const world = new NigiriWorld();

  assert.equal(world.attemptGrab(0), "invalid", "出現していないレーンは無効");
  assert.equal(world.attemptGrab(99), "invalid", "範囲外のlaneIndex");
  assert.equal(world.attemptGrab(-1), "invalid", "負のlaneIndex");
  assert.equal(world.score, 0);
  assert.equal(world.lives, LIVES_MAX);
});

test("注文中のネタを取り逃す(タイムアウト)とライフが減る", () => {
  const world = new NigiriWorld();
  const lane = activeLaneWithTarget(world);
  let missed = false;
  world.onMiss = (event) => {
    if (event.laneIndex === lane.index) missed = true;
  };

  world.step(lane.timer + 1);

  assert.equal(missed, true, "onMissが発火する");
  assert.equal(world.lives, LIVES_MAX - 1);
  assert.equal(world.lanes[lane.index].state, "cooldown");
});

test("注文と違うネタやわさびを取り逃してもライフは減らない", () => {
  const world = new NigiriWorld();
  const lane = activeLaneNotTarget(world);
  const kindAtSpawn = lane.kind;

  world.step(lane.timer + 1);

  assert.equal(world.lives, LIVES_MAX, "対象外のネタの取り逃しはノーペナルティ");
  assert.equal(world.lanes[lane.index].state, "cooldown");
  assert.notEqual(kindAtSpawn, world.target);
});

test("ライフが0になるとゲームオーバーになり、以降は状態が変化しない", () => {
  const world = new NigiriWorld();

  for (let i = 0; i < LIVES_MAX; i++) {
    const lane = activeLaneWithKind(world, HAZARD_KIND);
    world.attemptGrab(lane.index);
  }

  assert.equal(world.isOver, true);
  assert.equal(world.lives, 0);

  const scoreBefore = world.score;
  world.step(5);
  assert.equal(world.score, scoreBefore, "ゲームオーバー後はstepしても変化しない");
  assert.equal(world.attemptGrab(0), "invalid", "ゲームオーバー後のグラブは常に無効");
});

test("reset()で最初の状態に戻る", () => {
  const world = new NigiriWorld();
  const lane = activeLaneWithTarget(world);
  world.attemptGrab(lane.index);

  world.reset();

  assert.equal(world.score, 0);
  assert.equal(world.lives, LIVES_MAX);
  assert.equal(world.isOver, false);
  assert.ok(world.lanes.every((l) => l.state === "empty" && l.kind === null));
});

test("連続成功で難易度が上がる(出現時間短縮・出現間隔短縮・同時出現数増加)", () => {
  const world = new NigiriWorld();
  const initialActiveDuration = world.activeDuration;
  const initialSpawnInterval = world.spawnInterval;
  const initialMaxConcurrent = world.maxConcurrent;

  for (let i = 0; i < 6; i++) {
    const lane = activeLaneWithTarget(world);
    world.attemptGrab(lane.index);
  }

  assert.ok(world.activeDuration < initialActiveDuration, "出現時間が短くなる");
  assert.ok(world.spawnInterval < initialSpawnInterval, "出現間隔が短くなる");
  assert.ok(world.maxConcurrent > initialMaxConcurrent, "同時出現数が増える");
});

test("同時出現数が増えると複数レーンが同時に出現し得る", () => {
  const world = new NigiriWorld();

  for (let i = 0; i < 4; i++) {
    const lane = activeLaneWithTarget(world);
    world.attemptGrab(lane.index);
  }

  assert.ok(world.maxConcurrent >= 2, "4回成功でmaxConcurrentが2以上になっている前提");

  world.step(1);
  world.step(0.0001);
  const activeCount = world.lanes.filter((lane) => lane.state === "active").length;
  assert.ok(activeCount >= 1, "少なくとも1つは出現している");
  assert.ok(activeCount <= world.maxConcurrent, "同時出現数の上限を超えない");
});

test("正解が連続するほど1回あたりのスコアが増える(連続ボーナス)", () => {
  const world = new NigiriWorld();
  const firstLane = activeLaneWithTarget(world);
  world.attemptGrab(firstLane.index);
  const scoreAfterFirst = world.score;

  const secondLane = activeLaneWithTarget(world);
  world.attemptGrab(secondLane.index);
  const secondGain = world.score - scoreAfterFirst;

  assert.ok(secondGain > scoreAfterFirst, "2回目の加点が1回目より大きい(連続ボーナス)");
});
