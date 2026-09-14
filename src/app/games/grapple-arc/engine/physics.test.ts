import assert from "node:assert/strict";
import { test } from "node:test";
import { clamp, constrainDistance, distance, integrateVerlet, randRange } from "./physics.ts";

test("clamp: 範囲内はそのまま、範囲外は境界値に丸める", () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-5, 0, 10), 0);
  assert.equal(clamp(15, 0, 10), 10);
});

test("distance: 3-4-5の直角三角形で正しい距離を返す", () => {
  assert.equal(distance(0, 0, 3, 4), 5);
});

test("randRange: 指定範囲内の値を返す", () => {
  for (let i = 0; i < 200; i++) {
    const value = randRange(10, 20);
    assert.ok(value >= 10 && value < 20, `${value} が [10, 20) の範囲内`);
  }
});

test("integrateVerlet: 静止状態から1ステップで重力ぶんだけ落下する", () => {
  const pos = { x: 100, y: 100 };
  const prevPos = { x: 100, y: 100 };
  const gravity = 1000;
  const dt = 0.1;

  const next = integrateVerlet(pos, prevPos, gravity, dt, 1);

  assert.equal(next.x, 100, "水平方向の速度がないので x は変化しない");
  assert.ok(Math.abs(next.y - (100 + gravity * dt * dt)) < 1e-9, "重力加速度ぶん落下する");
});

test("integrateVerlet: 減衰(damping)を掛けると速度に由来する移動量が小さくなる", () => {
  const pos = { x: 110, y: 100 };
  const prevPos = { x: 100, y: 100 };

  const undamped = integrateVerlet(pos, prevPos, 0, 1 / 60, 1);
  const damped = integrateVerlet(pos, prevPos, 0, 1 / 60, 0.5);

  assert.ok(damped.x - pos.x < undamped.x - pos.x, "減衰ありの方が移動量が小さい");
});

test("constrainDistance: 中心から離れた点をロープ長ちょうどの円周上へ投影する", () => {
  const anchor = { x: 0, y: 0 };
  const far = { x: 300, y: 0 };

  const constrained = constrainDistance(far, anchor, 100);

  assert.ok(Math.abs(distance(anchor.x, anchor.y, constrained.x, constrained.y) - 100) < 1e-9);
  assert.equal(constrained.x, 100, "元の方向を保ったまま距離だけ縮める");
  assert.equal(constrained.y, 0);
});

test("constrainDistance: anchor とちょうど重なる縮退ケースでも有限な点を返す", () => {
  const anchor = { x: 50, y: 50 };
  const overlapping = { x: 50, y: 50 };

  const constrained = constrainDistance(overlapping, anchor, 120);

  assert.ok(Number.isFinite(constrained.x) && Number.isFinite(constrained.y));
  assert.ok(Math.abs(distance(anchor.x, anchor.y, constrained.x, constrained.y) - 120) < 1e-9);
});
