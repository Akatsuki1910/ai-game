import assert from "node:assert/strict";
import { test } from "node:test";
import { CEILING_ALTITUDE, EmberLoftWorld, GROUND_ALTITUDE, LOGICAL_HEIGHT } from "./world.ts";

const WIDTH = 960;
const HEIGHT = 540;
const FRAME = 1 / 60;

function assertFinite(world: EmberLoftWorld, label: string): void {
  assert.ok(Number.isFinite(world.altitude), `${label}: altitude`);
  assert.ok(Number.isFinite(world.verticalVelocity), `${label}: verticalVelocity`);
  assert.ok(Number.isFinite(world.heat), `${label}: heat`);
  assert.ok(Number.isFinite(world.distance), `${label}: distance`);
  assert.ok(Number.isFinite(world.score), `${label}: score`);
}

test("起動直後は中間の高度・釣り合いの熱量・スコア0で、先の障害物とオーブがあらかじめ用意されている", () => {
  const world = new EmberLoftWorld(WIDTH, HEIGHT);

  assert.equal(world.altitude, LOGICAL_HEIGHT * 0.4);
  assert.equal(world.verticalVelocity, 0);
  assert.equal(world.distance, 0);
  assert.equal(world.score, 0);
  assert.equal(world.integrity, 100);
  assert.equal(world.orbsCollected, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.crashReason, null);
  assert.ok(world.obstacles.length > 0, "先の障害物があらかじめ用意されている");
  assert.ok(world.orbs.length > 0, "先のオーブがあらかじめ用意されている");
  assertFinite(world, "起動直後");
});

test("バーナーを点火し続けると熱量が上がって上昇し、消すと冷えて沈む", () => {
  const rising = new EmberLoftWorld(WIDTH, HEIGHT);
  const falling = new EmberLoftWorld(WIDTH, HEIGHT);
  rising.setBurner(true);
  falling.setBurner(false);

  for (let i = 0; i < 90; i++) {
    rising.step(FRAME);
    falling.step(FRAME);
  }

  assert.ok(rising.altitude > LOGICAL_HEIGHT * 0.4, "点火し続けると上昇する");
  assert.ok(falling.altitude < LOGICAL_HEIGHT * 0.4, "消火したままだと沈む");
  assertFinite(rising, "点火し続けた後");
  assertFinite(falling, "消火し続けた後");
});

test("地面(高度0)に到達すると墜落してゲームオーバーになり、以後は状態が変化しない", () => {
  const world = new EmberLoftWorld(WIDTH, HEIGHT);
  world.setBurner(false);

  for (let i = 0; i < 600 && !world.isOver; i++) {
    world.step(FRAME);
  }

  assert.equal(world.isOver, true, "熱を失い続けると地面に落ちて墜落する");
  assert.equal(world.crashReason, "ground");
  assert.equal(world.altitude, GROUND_ALTITUDE);
  assertFinite(world, "墜落直後");

  const frozenDistance = world.distance;
  const frozenScore = world.score;
  world.setBurner(true);
  world.step(FRAME);

  assert.equal(world.distance, frozenDistance, "ゲームオーバー後は距離が変化しない");
  assert.equal(world.score, frozenScore, "ゲームオーバー後はスコアが変化しない");
});

test("天井(高度上限)にぶつかっても墜落はせず、そこで頭打ちになる", () => {
  const world = new EmberLoftWorld(WIDTH, HEIGHT);
  world.setBurner(true);

  for (let i = 0; i < 600 && !world.isOver; i++) {
    world.step(FRAME);
  }

  assert.equal(world.isOver, false, "天井にぶつかっただけでは墜落しない");
  assert.equal(world.altitude, CEILING_ALTITUDE);
  assert.ok(world.verticalVelocity <= 0, "天井では上向きの速度が残らない");
  assertFinite(world, "天井到達後");
});

test("障害物に衝突すると耐久が減り、耐久が尽きると墜落する", () => {
  const world = new EmberLoftWorld(WIDTH, HEIGHT);
  const obstacle = {
    id: 999_001,
    x: world.distance + 5,
    altitude: world.altitude,
    kind: "cloud" as const,
  };
  world.obstacles.unshift(obstacle);

  const hits: number[] = [];
  world.onObstacleHit = () => hits.push(1);

  world.step(FRAME);

  assert.equal(hits.length, 1, "近くの障害物に衝突するとイベントが発火する");
  assert.equal(world.integrity, 75, "1回の衝突で耐久が25減る");
  assert.ok(
    world.obstacles.every((o) => o.id !== obstacle.id),
    "衝突した障害物はワールドから取り除かれる",
  );
  assert.equal(world.isOver, false, "1回の衝突では墜落しない");

  for (let i = 0; i < 3; i++) {
    world.obstacles.unshift({
      id: 999_002 + i,
      x: world.distance + 5,
      altitude: world.altitude,
      kind: "bird",
    });
    world.step(FRAME);
  }

  assert.equal(world.integrity, 0, "耐久は0未満にならない");
  assert.equal(world.isOver, true, "耐久が尽きると墜落する");
  assert.equal(world.crashReason, "integrity");
  assertFinite(world, "耐久切れ墜落後");
});

test("オーブに近づくと自動で拾われ、得点と熱量ボーナスが入る", () => {
  const world = new EmberLoftWorld(WIDTH, HEIGHT);
  const nearOrb = { id: 999_101, x: world.distance + 5, altitude: world.altitude };
  world.orbs.unshift(nearOrb);
  const heatBefore = world.heat;

  const collected: Array<{ points: number }> = [];
  world.onOrbCollected = (event) => collected.push({ points: event.points });

  world.step(FRAME);

  assert.equal(world.orbsCollected, 1, "近くのオーブを自動で拾う");
  assert.ok(world.score > 0, "得点が入っている");
  assert.equal(collected.length, 1);
  assert.ok(collected[0].points > 0);
  assert.ok(world.heat >= heatBefore, "熱量ボーナスが入る");
  assert.ok(
    world.orbs.every((orb) => orb.id !== nearOrb.id),
    "拾ったオーブはワールドから取り除かれる",
  );
});

test("reset() で高度・熱量・距離・得点・耐久・障害物/オーブが初期状態に戻る", () => {
  const world = new EmberLoftWorld(WIDTH, HEIGHT);
  world.setBurner(false);
  for (let i = 0; i < 600 && !world.isOver; i++) world.step(FRAME);
  assert.equal(world.isOver, true, "前提: 一度墜落させておく");

  world.reset();

  assert.equal(world.altitude, LOGICAL_HEIGHT * 0.4);
  assert.equal(world.verticalVelocity, 0);
  assert.equal(world.distance, 0);
  assert.equal(world.score, 0);
  assert.equal(world.integrity, 100);
  assert.equal(world.orbsCollected, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.crashReason, null);
  assert.ok(world.obstacles.length > 0);
  assert.ok(world.orbs.length > 0);
  assertFinite(world, "リセット後");
});

test("画面サイズが変わっても、表示範囲の先まで障害物とオーブが用意される", () => {
  const world = new EmberLoftWorld(320, 480);
  const narrowFurthestX = Math.max(...world.obstacles.map((o) => o.x));

  world.resize(1600, 800);
  const wideFurthestX = Math.max(...world.obstacles.map((o) => o.x));

  assert.ok(wideFurthestX > narrowFurthestX, "画面が広がった分だけ先まで障害物が補充される");
  assert.ok(
    wideFurthestX >= world.cameraX + world.logicalViewWidth,
    "表示範囲より手前で障害物が尽きない",
  );

  // 不正なサイズを渡しても壊れない
  world.resize(0, 0);
  world.resize(-10, -10);
  assert.ok(world.width > 0 && world.height > 0, "不正なリサイズ値は無視される");
});

test("前に進み続けても障害物/オーブ配列が際限なく伸びず、手前のものは掃除される", () => {
  const world = new EmberLoftWorld(WIDTH, HEIGHT);
  world.setBurner(true);

  for (let i = 0; i < 4000 && !world.isOver; i++) {
    if (i % 40 < 20) world.setBurner(true);
    else world.setBurner(false);
    world.step(FRAME);
  }

  assert.ok(world.obstacles.length < 30, "手前の障害物が掃除され、配列が伸び続けない");
  assert.ok(world.orbs.length < 30, "手前のオーブが掃除され、配列が伸び続けない");
  assertFinite(world, "長距離移動後");
});

test("風の帯ごとの前進倍率は許容範囲に収まり、高度によって帯が変わる", () => {
  const world = new EmberLoftWorld(WIDTH, HEIGHT);

  assert.equal(world.getBandIndex(0), 0);
  assert.equal(world.getBandIndex(LOGICAL_HEIGHT - 1), 2);
  assert.equal(world.getBandIndex(LOGICAL_HEIGHT / 2), 1);

  for (let i = 0; i < 300; i++) {
    world.step(FRAME);
    for (let band = 0; band < 3; band++) {
      const multiplier = world.getBandMultiplier(band);
      assert.ok(Number.isFinite(multiplier), "倍率は有限");
      assert.ok(multiplier > 0, "倍率は常に正(距離が後退しない)");
    }
  }
});
