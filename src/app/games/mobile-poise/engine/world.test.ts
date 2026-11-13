import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type Hook,
  holdRequiredSecondsForLevel,
  hookCountForLevel,
  MobilePoiseWorld,
  toleranceForLevel,
} from "./world.ts";

const WIDTH = 960;
const HEIGHT = 540;
const FRAME = 1 / 60;

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [items.slice()];
  const result: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const perm of permutations(rest)) {
      result.push([items[i], ...perm]);
    }
  }
  return result;
}

/** world.charms を全順列で world.hooks に割り当て、targetTorque に一致する組み合わせを1つ探す。 */
function findSolvingAssignment(world: MobilePoiseWorld): Map<number, number> | null {
  for (const order of permutations(world.hooks)) {
    const torque = world.charms.reduce(
      (sum, charm, i) => sum + charm.mass * order[i].offsetUnits,
      0,
    );
    if (torque === world.targetTorque) {
      const map = new Map<number, number>();
      for (const [i, charm] of world.charms.entries()) {
        map.set(charm.id, order[i].id);
      }
      return map;
    }
  }
  return null;
}

function applyAssignment(world: MobilePoiseWorld, assignment: Map<number, number>): void {
  for (const [charmId, hookId] of assignment) {
    world.assignCharmToHook(charmId, hookId);
  }
}

/**
 * 「許容帯からしっかり外れた割り当て」を使うテスト用に、全組み合わせの中で
 * targetTorque から最もズレる順列を持つラウンドを探す。乱数生成なので、
 * ごく稀に全おもりの重さが偶然揃って順列間の差が出ないラウンドがあり得るため、
 * 条件を満たすまで(上限付きで)ラウンドを生成し直す。プロダクションの判定ロジックを
 * リトライするわけではなく、テスト用の固定具(fixture)を用意しているだけ。
 */
function buildWorldWithLargeWorstDeviation(): { world: MobilePoiseWorld; worstOrder: Hook[] } {
  for (let attempt = 0; attempt < 50; attempt++) {
    const world = new MobilePoiseWorld(WIDTH, HEIGHT);
    let worstOrder: Hook[] | null = null;
    let worstDeviation = -Infinity;
    for (const order of permutations(world.hooks)) {
      const torque = world.charms.reduce(
        (sum, charm, i) => sum + charm.mass * order[i].offsetUnits,
        0,
      );
      const deviation = Math.abs(torque - world.targetTorque);
      if (deviation > worstDeviation) {
        worstDeviation = deviation;
        worstOrder = order;
      }
    }
    if (worstOrder && worstDeviation > world.toleranceBand) {
      return { world, worstOrder };
    }
  }
  throw new Error("許容帯より十分外れた割り当てを持つラウンドを生成できなかった");
}

function assertFinite(world: MobilePoiseWorld, label: string): void {
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.roundTimeRemaining), `${label}: roundTimeRemaining`);
  assert.ok(Number.isFinite(world.tiltAngle), `${label}: tiltAngle`);
  assert.ok(Number.isFinite(world.totalTorque), `${label}: totalTorque`);
  for (const hook of world.hooks) {
    const p = world.hookPosition(hook);
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `${label}: hook position`);
  }
  for (const charm of world.charms) {
    const p = world.charmPosition(charm);
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `${label}: charm position`);
  }
}

test("起動直後はレベル1相当のフックとおもりが揃っている", () => {
  const world = new MobilePoiseWorld(WIDTH, HEIGHT);

  assert.equal(world.level, 1);
  assert.equal(world.score, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.hooks.length, hookCountForLevel(1));
  assert.equal(world.charms.length, hookCountForLevel(1));
  assert.ok(
    world.charms.every((c) => c.hookId === null),
    "最初はすべてトレイにある",
  );
  assert.ok(world.roundTimeRemaining > 0);
  assert.equal(world.toleranceBand, toleranceForLevel(1));
  assert.equal(world.holdRequiredSeconds, holdRequiredSecondsForLevel(1));
});

test("ラウンド生成直後は必ず解ける組み合わせが存在する", () => {
  for (let i = 0; i < 20; i++) {
    const world = new MobilePoiseWorld(WIDTH, HEIGHT);
    const solving = findSolvingAssignment(world);
    assert.ok(solving, "targetTorque に一致する割り当てが少なくとも1つ存在する");
  }
});

test("おもりをフックに掛ける/入れ替える/外すことができ、1フックに2つ掛かることはない", () => {
  const world = new MobilePoiseWorld(WIDTH, HEIGHT);
  const [hookA, hookB] = world.hooks;
  const [charmA, charmB] = world.charms;

  const hookAPos = world.hookPosition(hookA);
  assert.equal(world.findHookAt(hookAPos.x, hookAPos.y)?.id, hookA.id);
  const charmAPos = world.charmPosition(charmA);
  assert.equal(world.findCharmAt(charmAPos.x, charmAPos.y)?.id, charmA.id);

  world.assignCharmToHook(charmA.id, hookA.id);
  assert.equal(charmA.hookId, hookA.id);

  // 別のおもりを同じフックに掛けると、先にいたおもりは元の場所(トレイ)へ戻る
  world.assignCharmToHook(charmB.id, hookA.id);
  assert.equal(charmB.hookId, hookA.id);
  assert.equal(charmA.hookId, null, "押し出されたおもりはトレイに戻る");

  // 既にフックに掛かっているおもり同士を入れ替える(A→hookB, 元々hookBにいたBはAの元の場所へ)
  world.assignCharmToHook(charmA.id, hookB.id);
  world.assignCharmToHook(charmB.id, hookB.id);
  assert.equal(charmB.hookId, hookB.id);
  assert.equal(charmA.hookId, hookA.id, "押し出されたAは、Bが元いたフックへ入れ替わる");

  world.unassignCharm(charmB.id);
  assert.equal(charmB.hookId, null);

  for (const hook of world.hooks) {
    const occupants = world.charms.filter((c) => c.hookId === hook.id);
    assert.ok(occupants.length <= 1, "1フックに複数のおもりは掛からない");
  }
});

test("正しい組み合わせを保ち続けるとラウンドがクリアされてレベルとスコアが進む", () => {
  const world = new MobilePoiseWorld(WIDTH, HEIGHT);
  const solving = findSolvingAssignment(world);
  assert.ok(solving);
  if (!solving) return;
  applyAssignment(world, solving);

  const cleared: { level: number; points: number }[] = [];
  world.onRoundCleared = (event) => cleared.push(event);

  for (let i = 0; i < 400 && cleared.length === 0; i++) {
    world.step(FRAME);
    assertFinite(world, "クリアまでの間");
  }

  assert.equal(cleared.length, 1, "ラウンドが1回クリアされる");
  assert.equal(cleared[0].level, 1, "クリアしたのはレベル1");
  assert.ok(cleared[0].points > 0, "得点が入っている");
  assert.equal(world.level, 2, "レベルが進む");
  assert.equal(world.score, cleared[0].points);
  assert.equal(world.hooks.length, hookCountForLevel(2), "次のレベルのフック数になる");
  assert.ok(
    world.charms.every((c) => c.hookId === null),
    "新ラウンドはトレイからやり直す",
  );
});

test("フックが1つでも空いているとクリアしない", () => {
  const world = new MobilePoiseWorld(WIDTH, HEIGHT);
  const solving = findSolvingAssignment(world);
  assert.ok(solving);
  if (!solving) return;
  applyAssignment(world, solving);

  const [firstCharmId] = solving.keys();
  world.unassignCharm(firstCharmId);

  for (let i = 0; i < 400; i++) {
    world.step(FRAME);
    assertFinite(world, "空きフックがある間");
  }

  assert.equal(world.holdTimer, 0, "空きフックがある間は保持タイマーが進まない");
  assert.equal(world.level, 1, "レベルは進まない");
});

test("大きく外れた組み合わせのままだと時間切れでゲームオーバーになり、リセットで最初から遊べる", () => {
  const { world, worstOrder } = buildWorldWithLargeWorstDeviation();
  for (const [i, charm] of world.charms.entries()) {
    world.assignCharmToHook(charm.id, worstOrder[i].id);
  }

  for (let i = 0; i < 2000 && !world.isOver; i++) {
    world.step(0.1);
    assertFinite(world, "ゲームオーバーまでの間");
  }

  assert.equal(world.isOver, true, "時間切れでゲームオーバーになる");
  assert.equal(world.holdTimer, 0, "保持タイマーは進んでいない");

  world.step(FRAME);
  assertFinite(world, "ゲームオーバー後");

  world.reset();
  assert.equal(world.isOver, false);
  assert.equal(world.level, 1);
  assert.equal(world.score, 0);
  assert.ok(world.charms.every((c) => c.hookId === null));
});

test("画面サイズが変わってもフックとおもりが画面内に収まる", () => {
  const world = new MobilePoiseWorld(WIDTH, HEIGHT);

  world.resize(375, 720);
  for (const hook of world.hooks) {
    const p = world.hookPosition(hook);
    assert.ok(p.x >= 0 && p.x <= 375, "フックが画面内");
    assert.ok(p.y >= 0 && p.y <= 720, "フックが画面内");
  }
  for (const charm of world.charms) {
    const p = world.charmPosition(charm);
    assert.ok(p.x >= 0 && p.x <= 375, "おもりが画面内");
    assert.ok(p.y >= 0 && p.y <= 720, "おもりが画面内");
  }

  for (let i = 0; i < 60; i++) world.step(FRAME);
  assertFinite(world, "リサイズ後");
});
