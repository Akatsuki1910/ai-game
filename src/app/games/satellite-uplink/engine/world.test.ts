import assert from "node:assert/strict";
import { test } from "node:test";
import {
  circularDistanceDeg,
  ELEVATION_MAX,
  ELEVATION_MIN,
  LOCK_TOLERANCE_DEG,
  SatelliteUplinkWorld,
  STATIC_MAX,
  wrapDeg,
} from "./world.ts";

test("wrapDegは0〜360度の範囲に正規化する", () => {
  assert.equal(wrapDeg(0), 0);
  assert.equal(wrapDeg(359), 359);
  assert.equal(wrapDeg(360), 0);
  assert.equal(wrapDeg(370), 10);
  assert.equal(wrapDeg(-10), 350);
  assert.equal(wrapDeg(-370), 350);
});

test("circularDistanceDegは360度境界をまたぐ最短角度差を返す", () => {
  assert.equal(circularDistanceDeg(10, 20), 10);
  assert.equal(circularDistanceDeg(350, 10), 20, "0度をまたぐ差は短い方を返す");
  assert.equal(circularDistanceDeg(0, 180), 180, "正反対は180度");
  assert.equal(circularDistanceDeg(0, 0), 0);
});

test("初期状態はスコア0・ロック無し・ノイズ0で、アンテナと衛星は離れている", () => {
  const world = new SatelliteUplinkWorld();

  assert.equal(world.score, 0);
  assert.equal(world.lockStreakSeconds, 0);
  assert.equal(world.staticLevel, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.isLocked, false);

  const dist = Math.hypot(
    circularDistanceDeg(world.dishAz, world.satAz),
    Math.abs(world.dishEl - world.satEl),
  );
  assert.ok(dist > LOCK_TOLERANCE_DEG, "初期配置ではロックが成立しない距離だけ離れている");
});

test("ロックしていない間はノイズが蓄積し、スコアは増えない", () => {
  const world = new SatelliteUplinkWorld();

  world.step(1 / 60);

  assert.equal(world.isLocked, false);
  assert.ok(world.staticLevel > 0, "ロック無しでノイズが増える");
  assert.equal(world.score, 0);
});

test("ノイズが上限に達すると回線切断(ゲームオーバー)になる", () => {
  const world = new SatelliteUplinkWorld();

  world.step(1000); // 十分大きいdtで必ず上限に到達させる

  assert.equal(world.staticLevel, STATIC_MAX);
  assert.equal(world.isOver, true);

  const scoreBefore = world.score;
  world.step(1 / 60);
  assert.equal(world.score, scoreBefore, "ゲームオーバー後はstepしても状態が変化しない");
  assert.equal(world.staticLevel, STATIC_MAX);
});

test("ゲームオーバー後はsetDishAim/turnDishが無視される", () => {
  const world = new SatelliteUplinkWorld();
  world.step(1000);
  assert.equal(world.isOver, true);

  const azBefore = world.dishAz;
  const elBefore = world.dishEl;
  world.setDishAim(99, 60);
  world.turnDish(10, 10);

  assert.equal(world.dishAz, azBefore, "ゲームオーバー後はアンテナの向きが変わらない");
  assert.equal(world.dishEl, elBefore);
});

test("アンテナを衛星にぴったり向けるとロックが成立し、スコアが増えノイズが減る", () => {
  const world = new SatelliteUplinkWorld();
  world.staticLevel = 50; // ロックで減ることを確認するため、あらかじめノイズを積んでおく

  world.setDishAim(world.satAz, world.satEl);
  world.step(1 / 60);

  assert.equal(world.isLocked, true);
  assert.ok(world.score > 0, "ロック中はスコアが増える");
  assert.ok(world.lockStreakSeconds > 0, "ロック継続時間が増える");
  assert.ok(world.staticLevel < 50, "ロック中はノイズが減る");
});

test("ロックが途切れるとロック継続時間が0に戻り、再びノイズが増える", () => {
  const world = new SatelliteUplinkWorld();
  world.setDishAim(world.satAz, world.satEl);
  world.step(1 / 60);
  assert.equal(world.isLocked, true);
  assert.ok(world.lockStreakSeconds > 0);

  world.setDishAim(world.satAz + 90, world.satEl);
  world.step(1 / 60);

  assert.equal(world.isLocked, false);
  assert.equal(world.lockStreakSeconds, 0, "ロックが途切れると継続時間がリセットされる");
});

test("継続的に完璧に追尾し続けると、方位角が360度を周回してもロックが途切れない", () => {
  const world = new SatelliteUplinkWorld();

  for (let i = 0; i < 6000; i++) {
    world.setDishAim(world.satAz, world.satEl);
    world.step(1 / 60);
    assert.equal(world.isLocked, true, `${i}ステップ目でロックが途切れた`);
  }

  assert.equal(world.isOver, false);
  assert.ok(world.score > 0, "追尾を続けるとスコアが積み上がる");
  assert.ok(world.staticLevel < STATIC_MAX, "追尾を続けている間はノイズが上限に達しない");
});

test("setDishAimは方位角を0〜360度にラップし、高度角を範囲内にクランプする", () => {
  const world = new SatelliteUplinkWorld();

  world.setDishAim(-10, 1000);
  assert.equal(world.dishAz, 350);
  assert.equal(world.dishEl, ELEVATION_MAX);

  world.setDishAim(370, -1000);
  assert.equal(world.dishAz, 10);
  assert.equal(world.dishEl, ELEVATION_MIN);
});

test("turnDishは現在の向きからの相対移動で、同様にラップ・クランプされる", () => {
  const world = new SatelliteUplinkWorld();
  world.setDishAim(350, ELEVATION_MIN + 5);

  world.turnDish(20, -100);

  assert.equal(world.dishAz, 10, "350 + 20 は 10 にラップする");
  assert.equal(world.dishEl, ELEVATION_MIN);
});

test("reset()で初期状態に戻る", () => {
  const world = new SatelliteUplinkWorld();
  world.setDishAim(world.satAz, world.satEl);
  world.step(5);

  world.reset();

  assert.equal(world.score, 0);
  assert.equal(world.lockStreakSeconds, 0);
  assert.equal(world.staticLevel, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.isLocked, false);
});

test("生存時間が伸びるほど衛星の方位角速度(難易度)が上がる", () => {
  const world = new SatelliteUplinkWorld();
  const azBefore = world.satAz;
  world.step(1 / 60);
  const earlyDelta = circularDistanceDeg(world.satAz, azBefore);

  // 十分に生存させてから同じ1フレームでの移動量を比較する。
  for (let i = 0; i < 600; i++) {
    world.setDishAim(world.satAz, world.satEl); // ロックさせてゲームオーバーを避ける
    world.step(1 / 60);
  }
  const azBeforeLate = world.satAz;
  world.step(1 / 60);
  const lateDelta = circularDistanceDeg(world.satAz, azBeforeLate);

  assert.ok(lateDelta >= earlyDelta, "生存時間が伸びると衛星の移動速度(難易度)が上がる");
});
