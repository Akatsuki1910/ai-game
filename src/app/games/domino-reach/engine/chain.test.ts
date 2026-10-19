import assert from "node:assert/strict";
import { test } from "node:test";
import { DOMINO_REACH, type PlacedDomino, START_REACH, simulateChain } from "./chain.ts";

function domino(id: string, x: number, isBooster = false): PlacedDomino {
  return { id, x, isBooster };
}

test("ドミノが1枚も無い場合は何も倒れず、ゴールが射程内でない限り失敗する", () => {
  const result = simulateChain([], 600);
  assert.deepEqual(result.timeline, []);
  assert.equal(result.frontier, START_REACH);
  assert.equal(result.reachedGoal, false);
});

test("ゴールがスタートの起爆射程内なら、ドミノ無しでも成功とみなす(境界値)", () => {
  const result = simulateChain([], START_REACH);
  assert.equal(result.reachedGoal, true);
});

test("隙間なく並べれば連鎖が最後まで届く", () => {
  const dominoes = [domino("a", 50), domino("b", 130), domino("c", 210)];
  // 50+88=138 >= 130, 130+88=218 >= 210, 210+88=298 >= goal
  const result = simulateChain(dominoes, 280);
  assert.deepEqual(
    result.timeline.map((e) => e.id),
    ["a", "b", "c"],
  );
  assert.equal(result.reachedGoal, true);
});

test("射程を超える隙間があると、そこで連鎖が途切れる(それ以降は倒れない)", () => {
  const dominoes = [domino("a", 50), domino("far", 400), domino("b", 420)];
  const result = simulateChain(dominoes, 600);
  assert.deepEqual(
    result.timeline.map((e) => e.id),
    ["a"],
  );
  assert.equal(result.reachedGoal, false);
  assert.equal(result.frontier, 50 + DOMINO_REACH.standard);
});

test("標準ドミノでは届かない隙間も、ブースタードミノなら越えられる", () => {
  // 50からの隙間(120)は標準の射程(88)を超えるが、ブースターの射程(154)には収まる。
  const farSide = 50 + 120;
  assert.ok(farSide - 50 > DOMINO_REACH.standard);
  assert.ok(farSide - 50 <= DOMINO_REACH.booster);

  // ゴールは、ブースターでaを倒した直後の射程(204)より遠いが、
  // さらにbまで倒せた射程(258)には収まる位置に置く。
  const goalX = 230;

  const withStandard = simulateChain([domino("a", 50), domino("b", farSide)], goalX);
  assert.deepEqual(
    withStandard.timeline.map((e) => e.id),
    ["a"],
  );
  assert.equal(withStandard.reachedGoal, false);

  const withBooster = simulateChain([domino("a", 50, true), domino("b", farSide)], goalX);
  assert.deepEqual(
    withBooster.timeline.map((e) => e.id),
    ["a", "b"],
  );
  assert.equal(withBooster.reachedGoal, true);
});

test("配置順がx昇順でなくても、座標でソートして正しく連鎖する", () => {
  const dominoes = [domino("c", 210), domino("a", 50), domino("b", 130)];
  const result = simulateChain(dominoes, 280);
  assert.deepEqual(
    result.timeline.map((e) => e.id),
    ["a", "b", "c"],
  );
  assert.equal(result.reachedGoal, true);
});

test("ドミノの座標が直前の射程ちょうどに重なる境界値でも倒れる", () => {
  const dominoes = [domino("a", START_REACH)];
  const result = simulateChain(dominoes, START_REACH + DOMINO_REACH.standard);
  assert.deepEqual(
    result.timeline.map((e) => e.id),
    ["a"],
  );
  assert.equal(result.reachedGoal, true);
});

test("射程をわずかに超える座標のドミノは倒れない(境界値)", () => {
  const dominoes = [domino("a", START_REACH + 0.01)];
  const result = simulateChain(dominoes, 600);
  assert.deepEqual(result.timeline, []);
  assert.equal(result.frontier, START_REACH);
});
