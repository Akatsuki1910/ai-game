import assert from "node:assert/strict";
import { test } from "node:test";
import { LongbowBreezeWorld, type ShotResolution } from "./world.ts";

const WIDTH = 960;
const HEIGHT = 540;
const DT = 1 / 120;

/** 風をゼロにして弾道を解析的に計算できるようにする。 */
function clearWind(world: LongbowBreezeWorld): void {
  world.windAccel = 0;
}

/** 的の中心にちょうど当たる初速(vx, vy)を、与えた飛行時間から逆算する。 */
function velocityToHitCenter(world: LongbowBreezeWorld, flightSeconds: number) {
  const dx = world.target.x - world.anchorX;
  const dy = world.target.centerY - world.anchorY;
  const vx = dx / flightSeconds;
  const vy = (dy - 0.5 * world.gravity * flightSeconds ** 2) / flightSeconds;
  return { vx, vy };
}

function runUntilResolved(world: LongbowBreezeWorld, maxSteps = 2000): void {
  for (let i = 0; i < maxSteps && world.arrow; i++) {
    world.step(DT);
  }
}

function assertFinite(world: LongbowBreezeWorld, label: string): void {
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(
    Number.isFinite(world.target.x) && Number.isFinite(world.target.centerY),
    `${label}: target position`,
  );
  for (const ring of world.target.rings) {
    assert.ok(Number.isFinite(ring.radius) && ring.radius > 0, `${label}: ring radius`);
  }
  if (world.arrow) {
    assert.ok(
      Number.isFinite(world.arrow.x) && Number.isFinite(world.arrow.y),
      `${label}: arrow position`,
    );
  }
}

test("起動直後に的・風・ライフが揃っている", () => {
  const world = new LongbowBreezeWorld(WIDTH, HEIGHT);

  assert.equal(world.lives, 3);
  assert.equal(world.score, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.ready, true);
  assert.equal(world.arrow, null);
  assert.equal(world.target.rings.length, 4, "的は4段のリングを持つ");
  assert.ok(world.target.x > world.anchorX, "的は射手より右にある");
  assertFinite(world, "起動直後");
});

test("的のど真ん中を狙うと命中して加点され、ライフは減らない", () => {
  const world = new LongbowBreezeWorld(WIDTH, HEIGHT);
  clearWind(world);

  const resolutions: ShotResolution[] = [];
  world.onShotResolved = (resolution) => resolutions.push(resolution);

  const { vx, vy } = velocityToHitCenter(world, 1);
  const targetXBefore = world.target.x;
  world.fire(vx, vy);
  assert.equal(world.ready, false, "発射中は準備中フラグが立たない");

  runUntilResolved(world);

  assert.equal(resolutions.length, 1, "1回の射撃で1回だけ結果が通知される");
  assert.ok(resolutions[0].ring, "的のどこかに当たっている");
  assert.ok(resolutions[0].points > 0, "得点が入っている");
  assert.equal(world.lives, 3, "命中してもライフは減らない");
  assert.equal(world.score, resolutions[0].points);
  assert.equal(world.round, 1, "命中するとラウンドが進む");
  assert.notEqual(world.target.x, targetXBefore, "命中後は新しい的に差し替わる");
  assert.equal(world.ready, true, "次の矢を放つ準備ができている");
  assertFinite(world, "命中後");
});

test("連続で命中させるとコンボ分のボーナスが加算される", () => {
  const world = new LongbowBreezeWorld(WIDTH, HEIGHT);
  clearWind(world);

  const points: number[] = [];
  world.onShotResolved = (resolution) => {
    if (resolution.ring) points.push(resolution.points);
  };

  for (let i = 0; i < 3; i++) {
    clearWind(world);
    const { vx, vy } = velocityToHitCenter(world, 1);
    world.fire(vx, vy);
    runUntilResolved(world);
  }

  assert.equal(points.length, 3, "3回とも命中している");
  assert.ok(points[1] > points[0], "2発目はコンボボーナスで1発目より高得点");
  assert.ok(points[2] > points[1], "3発目はさらに高得点");
});

test("的を外れて当たると(的の範囲外)ライフが減りコンボがリセットされる", () => {
  const world = new LongbowBreezeWorld(WIDTH, HEIGHT);
  clearWind(world);

  const resolutions: ShotResolution[] = [];
  world.onShotResolved = (resolution) => resolutions.push(resolution);

  // 的のはるか上を通過させる(的のx座標には届くが的の外を通る)。
  const dx = world.target.x - world.anchorX;
  const flightSeconds = 1;
  const vx = dx / flightSeconds;
  const vy = -world.maxSpeed; // 的のcenterYより大幅に上を通過させる強い上向き初速
  world.fire(vx, vy);
  runUntilResolved(world);

  assert.equal(resolutions.length, 1);
  assert.equal(resolutions[0].ring, null, "的の外を通過してミスになる");
  assert.equal(world.lives, 2, "ミスでライフが1減る");
  assert.equal(world.combo, 0, "コンボがリセットされる");
  assert.equal(world.isOver, false);
});

test("力不足で的に届かず地面に落ちるとミスになる(ground)", () => {
  const world = new LongbowBreezeWorld(WIDTH, HEIGHT);
  clearWind(world);

  const resolutions: ShotResolution[] = [];
  world.onShotResolved = (resolution) => resolutions.push(resolution);

  // 的のx座標まで届かない弱い初速。
  world.fire(world.minSpeed * 0.05, -world.minSpeed * 0.1);
  runUntilResolved(world);

  assert.equal(resolutions.length, 1);
  assert.equal(resolutions[0].ring, null);
  assert.equal(resolutions[0].missReason, "ground", "地面に落ちてミスになる");
  assert.equal(world.lives, 2);
});

test("準備中でなければ fire() は無視される(矢の多重発射を防ぐ)", () => {
  const world = new LongbowBreezeWorld(WIDTH, HEIGHT);
  clearWind(world);

  world.fire(world.minSpeed, -world.minSpeed);
  const firstArrow = world.arrow;
  assert.ok(firstArrow);

  world.fire(world.maxSpeed, -world.maxSpeed);
  assert.equal(world.arrow, firstArrow, "発射中の2回目のfireは無視される");
});

test("ライフが尽きるとゲームオーバーになり、reset で最初から遊べる", () => {
  const world = new LongbowBreezeWorld(WIDTH, HEIGHT);

  for (let i = 0; i < 3 && !world.isOver; i++) {
    clearWind(world);
    // 的に届かない弱い矢を放ち、確実にミスさせる。
    world.fire(world.minSpeed * 0.05, -world.minSpeed * 0.1);
    runUntilResolved(world);
  }

  assert.equal(world.lives, 0);
  assert.equal(world.isOver, true, "ライフが尽きるとゲームオーバーになる");

  // ゲームオーバー後にstepしても壊れない
  world.step(DT);
  assertFinite(world, "ゲームオーバー後");

  world.reset();
  assert.equal(world.isOver, false);
  assert.equal(world.lives, 3);
  assert.equal(world.score, 0);
  assert.equal(world.round, 0);
  assert.equal(world.arrow, null);
  assert.equal(world.ready, true);
});

test("画面サイズが変わっても的・矢の位置は有限値で画面内に留まる", () => {
  const world = new LongbowBreezeWorld(WIDTH, HEIGHT);
  clearWind(world);
  world.fire(world.minSpeed, -world.minSpeed * 0.9);

  // PC横長 → スマホ縦長
  world.resize(375, 720);
  assert.ok(world.target.x >= 0 && world.target.x <= 375, "的が画面内(x)");
  assert.ok(world.target.centerY >= 0 && world.target.centerY <= 720, "的が画面内(y)");
  assertFinite(world, "リサイズ直後");

  for (let i = 0; i < 60 && world.arrow; i++) world.step(DT);
  assertFinite(world, "リサイズ後の飛行中");
});
