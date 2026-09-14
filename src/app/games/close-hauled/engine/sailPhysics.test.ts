import assert from "node:assert/strict";
import { test } from "node:test";
import { clamp, computeSpeedFraction, normalizeAngle, shortestAngleDiff } from "./sailPhysics.ts";

test("normalizeAngle は角度を -PI〜PI に正規化する", () => {
  assert.ok(Math.abs(normalizeAngle(0) - 0) < 1e-9);
  // 3PI は PI と等価な角度（範囲が [-PI, PI) なので境界は -PI 側に丸まる）
  assert.ok(Math.abs(Math.abs(normalizeAngle(Math.PI * 3)) - Math.PI) < 1e-9);
  assert.ok(Math.abs(Math.abs(normalizeAngle(-Math.PI * 3)) - Math.PI) < 1e-9);
  assert.ok(normalizeAngle(Math.PI * 5.5) >= -Math.PI && normalizeAngle(Math.PI * 5.5) < Math.PI);
});

test("shortestAngleDiff は常に最短経路の角度差を返す", () => {
  // ほぼ一周に近い差は、逆向きの短い差として返るべき
  const diff = shortestAngleDiff(0.1, -Math.PI + 0.05);
  assert.ok(Math.abs(diff) <= Math.PI, "差はPIを超えない");

  const near = shortestAngleDiff(0, 0.2);
  assert.ok(Math.abs(near - 0.2) < 1e-9);
});

test("computeSpeedFraction はノーゴーゾーン境界で0になる", () => {
  const noGo = Math.PI / 4.5; // 40度前後
  assert.equal(computeSpeedFraction(0, noGo), 0, "風上の中心(no-go)は0");
  assert.equal(computeSpeedFraction(noGo, noGo), 0, "境界ちょうども0");
  assert.equal(computeSpeedFraction(-noGo, noGo), 0, "境界の逆側(符号違い)も0");
});

test("computeSpeedFraction は真後ろの追い風でも0になる", () => {
  const noGo = Math.PI / 4.5;
  const downwind = computeSpeedFraction(Math.PI, noGo);
  assert.ok(downwind < 1e-6, `真後ろは失速する想定だが ${downwind}`);
});

test("computeSpeedFraction はノーゴーゾーンの外側で正の速度になり、中間付近が最速", () => {
  const noGo = Math.PI / 4.5;
  const closeHauled = computeSpeedFraction(noGo + 0.05, noGo);
  const beamReach = computeSpeedFraction((noGo + Math.PI) / 2, noGo);
  const broadReach = computeSpeedFraction(Math.PI - 0.2, noGo);

  assert.ok(closeHauled > 0, "ノーゴーを少し出れば進める");
  assert.ok(broadReach > 0, "追い風寄りでも極端でなければ進める");
  assert.ok(beamReach >= closeHauled, "真横付近の方が速い");
  assert.ok(beamReach >= broadReach, "真横付近の方が速い");
});

test("computeSpeedFraction は常に0〜1の範囲に収まり、角度の符号に対して対称", () => {
  const noGo = Math.PI / 6;
  for (let deg = -180; deg <= 180; deg += 5) {
    const rad = (deg * Math.PI) / 180;
    const value = computeSpeedFraction(rad, noGo);
    assert.ok(value >= 0 && value <= 1, `角度${deg}度で範囲外: ${value}`);
    assert.ok(
      Math.abs(value - computeSpeedFraction(-rad, noGo)) < 1e-9,
      `角度${deg}度で左右対称でない`,
    );
  }
});

test("clamp は範囲外の値を境界に丸める", () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-5, 0, 10), 0);
  assert.equal(clamp(15, 0, 10), 10);
});
