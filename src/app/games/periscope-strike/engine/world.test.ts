import assert from "node:assert/strict";
import { test } from "node:test";
import { LANE_RATIOS, PeriscopeStrikeWorld, TORPEDO_SPEED } from "./world.ts";

const WIDTH = 960;
const HEIGHT = 540;
const FRAME = 1 / 60;

/** 魚雷が指定レーンに到達するまでの時間(秒)。 */
function travelTimeToLane(height: number, lane: number): number {
  return (height - height * LANE_RATIOS[lane]) / TORPEDO_SPEED;
}

/** 指定レーンだけに1隻を残し、他の艦はレーン外へ退避させて検証対象を単独にする。 */
function isolateSingleShip(world: PeriscopeStrikeWorld, lane: number, x: number, vx: number): void {
  world.ships = [{ id: 1, lane, x, y: world.height * LANE_RATIOS[lane], vx, radius: 24 }];
}

function stepFor(world: PeriscopeStrikeWorld, seconds: number): void {
  const frames = Math.ceil(seconds / FRAME) + 2;
  for (let i = 0; i < frames; i++) world.step(FRAME);
}

test("起動直後は艦が浮いていて、スコア・ライフ・検知が初期値になっている", () => {
  const world = new PeriscopeStrikeWorld(WIDTH, HEIGHT);

  assert.ok(world.ships.length > 0, "艦が配置されている");
  assert.equal(world.score, 0);
  assert.equal(world.lives, 3);
  assert.equal(world.detection, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.isAiming, false);
});

test("照準を開始・移動して離すと魚雷が発射される", () => {
  const world = new PeriscopeStrikeWorld(WIDTH, HEIGHT);

  world.startAiming(100);
  assert.equal(world.isAiming, true);
  assert.equal(world.aimX, 100);

  world.updateAim(300);
  assert.equal(world.aimX, 300);

  world.releaseAndFire();
  assert.equal(world.isAiming, false, "発射すると照準状態が解除される");
  assert.equal(world.torpedoes.length, 1, "魚雷が1本発射される");
  assert.equal(world.torpedoes[0].x, 300);

  // リロード中はもう一度構えて離しても発射されない
  world.startAiming(300);
  world.releaseAndFire();
  assert.equal(world.torpedoes.length, 1, "リロード中は追加で発射されない");
});

test("静止した艦をちょうどの位置で狙うと命中し、スコアとコンボが伸びる", () => {
  const world = new PeriscopeStrikeWorld(WIDTH, HEIGHT);
  const lane = 1;
  isolateSingleShip(world, lane, 500, 0);

  const sunk: number[] = [];
  world.onShipSunk = ({ points }) => sunk.push(points);

  world.startAiming(500);
  world.releaseAndFire();
  stepFor(world, travelTimeToLane(HEIGHT, lane));

  assert.equal(sunk.length, 1, "艦を1隻沈めた");
  assert.ok(sunk[0] > 0, "得点が入っている");
  assert.equal(world.score, sunk[0]);
  assert.equal(world.combo, 1);
  assert.equal(world.ships.length, 0, "沈めた艦は盤面から消える");
});

test("動いている艦も未来位置をリードして狙えば命中する", () => {
  const world = new PeriscopeStrikeWorld(WIDTH, HEIGHT);
  const lane = 0;
  const shipX = 300;
  const shipVx = 60;
  isolateSingleShip(world, lane, shipX, shipVx);

  const travelTime = travelTimeToLane(HEIGHT, lane);
  const leadX = shipX + shipVx * travelTime;

  const sunk: number[] = [];
  world.onShipSunk = () => sunk.push(1);

  world.startAiming(leadX);
  world.releaseAndFire();
  stepFor(world, travelTime);

  assert.equal(sunk.length, 1, "リードを合わせた魚雷が命中する");
});

test("艦がいない位置へ発射すると画面上端まで抜けてコンボが0に戻る", () => {
  const world = new PeriscopeStrikeWorld(WIDTH, HEIGHT);
  world.ships = [];
  world.combo = 3;

  let missed = false;
  world.onMiss = () => {
    missed = true;
  };

  world.startAiming(480);
  world.releaseAndFire();
  stepFor(world, HEIGHT / TORPEDO_SPEED);

  assert.equal(missed, true, "命中しなければ外れ判定になる");
  assert.equal(world.combo, 0, "外すとコンボが0に戻る");
  assert.equal(world.torpedoes.length, 0, "抜けた魚雷は消える");
});

test("ペリスコープを上げ続けると検知が満ちて発見され、ライフが減ってクールダウンに入る", () => {
  const world = new PeriscopeStrikeWorld(WIDTH, HEIGHT);

  let spottedCount = 0;
  world.onSpotted = () => {
    spottedCount += 1;
  };

  world.startAiming(world.width / 2);
  for (let i = 0; i < 200 && spottedCount === 0; i++) {
    world.updateAim(world.width / 2);
    world.step(0.1);
  }

  assert.equal(spottedCount, 1, "発見イベントが1回起きる");
  assert.equal(world.lives, 2, "ライフが1減る");
  assert.equal(world.detection, 0, "検知ゲージがリセットされる");
  assert.equal(world.isAiming, false, "発見されるとペリスコープが強制的に下がる");
  assert.ok(world.cooldownRemaining > 0, "クールダウン中になる");

  // クールダウン中は照準を再開できない
  world.startAiming(world.width / 2);
  assert.equal(world.isAiming, false, "クールダウン中は構えられない");
});

test("ライフが尽きると終了し、リセットで最初から遊べる", () => {
  const world = new PeriscopeStrikeWorld(WIDTH, HEIGHT);

  for (let life = 0; life < 3 && !world.isOver; life++) {
    const livesBefore = world.lives;
    world.startAiming(world.width / 2);
    for (let i = 0; i < 200 && world.lives === livesBefore && !world.isOver; i++) {
      world.updateAim(world.width / 2);
      world.step(0.1);
    }
    world.cooldownRemaining = 0; // 次のラウンドをすぐ試せるようにする
  }

  assert.equal(world.isOver, true, "3回発見されるとゲームオーバーになる");
  assert.equal(world.lives, 0);

  world.reset();
  assert.equal(world.isOver, false);
  assert.equal(world.lives, 3);
  assert.equal(world.score, 0);
  assert.equal(world.detection, 0);
});

test("画面サイズが変わってもレーンと照準位置が画面内に収まる", () => {
  const world = new PeriscopeStrikeWorld(WIDTH, HEIGHT);

  // PC横長 → スマホ縦長
  world.resize(375, 720);
  assert.ok(world.aimX >= 0 && world.aimX <= 375, "照準位置が画面内に収まる");
  for (const ship of world.ships) {
    assert.ok(Number.isFinite(ship.y), "艦のy座標が有限値");
    assert.equal(ship.y, world.height * LANE_RATIOS[ship.lane], "艦が新しいレーン高さに移る");
  }

  for (let i = 0; i < 60; i++) world.step(1 / 60);
  for (const ship of world.ships) {
    assert.ok(Number.isFinite(ship.x) && Number.isFinite(ship.y), "リサイズ後も座標が有限値");
  }
});
