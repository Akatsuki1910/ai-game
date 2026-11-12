import assert from "node:assert/strict";
import { test } from "node:test";
import { getPanelRects, toAbsolute, toLocalIfInside } from "./gardenLayout.ts";

test("横長では左右にパネルを並べ、隙間を空けて重ならない", () => {
  const { a, b } = getPanelRects(1000, 500);

  assert.equal(a.x, 0);
  assert.equal(a.height, 500);
  assert.ok(b.x > a.x + a.width, "AとBの間に隙間があり重ならない");
  assert.ok(a.width > 0 && b.width > 0);
  assert.equal(a.width, b.width, "左右パネルは同じ幅");
});

test("縦長(スマホ縦持ち)では上下にパネルを重ねる", () => {
  const { a, b } = getPanelRects(400, 900);

  assert.equal(a.y, 0);
  assert.equal(a.width, 400);
  assert.ok(b.y > a.y + a.height, "AとBの間に隙間があり重ならない");
  assert.equal(a.height, b.height, "上下パネルは同じ高さ");
});

test("寸法が0以下なら空の矩形を返す(ゼロ除算を起こさない)", () => {
  const { a, b } = getPanelRects(0, 0);
  assert.deepEqual(a, { x: 0, y: 0, width: 0, height: 0 });
  assert.deepEqual(b, { x: 0, y: 0, width: 0, height: 0 });
});

test("toAbsolute/toLocalIfInside は往復して元の正規化座標に戻る", () => {
  const rect = { x: 100, y: 50, width: 200, height: 150 };
  const local = { lx: 0.3, ly: 0.7 };

  const abs = toAbsolute(rect, local);
  const roundTrip = toLocalIfInside(rect, abs.x, abs.y);

  assert.ok(roundTrip !== null);
  assert.ok(Math.abs((roundTrip?.lx ?? Number.NaN) - local.lx) < 1e-9);
  assert.ok(Math.abs((roundTrip?.ly ?? Number.NaN) - local.ly) < 1e-9);
});

test("パネル範囲外の座標はnullになる", () => {
  const rect = { x: 100, y: 50, width: 200, height: 150 };
  assert.equal(toLocalIfInside(rect, 50, 60), null, "左側の範囲外");
  assert.equal(toLocalIfInside(rect, 350, 60), null, "右側の範囲外");
  assert.equal(toLocalIfInside(rect, 150, 10), null, "上側の範囲外");
  assert.equal(toLocalIfInside(rect, 150, 250), null, "下側の範囲外");
});
