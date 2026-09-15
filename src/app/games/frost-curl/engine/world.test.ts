import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type EndCompleteEvent,
  FrostCurlWorld,
  STONES_PER_END,
  type StoneBurnedEvent,
  TOTAL_ENDS,
} from "./world.ts";

const WIDTH = 960;
const HEIGHT = 540;
const FRAME = 1 / 60;

function assertFinite(world: FrostCurlWorld, label: string): void {
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.houseX) && Number.isFinite(world.houseY), `${label}: house`);
  for (const stone of world.stones) {
    assert.ok(Number.isFinite(stone.x) && Number.isFinite(stone.y), `${label}: stone position`);
    assert.ok(Number.isFinite(stone.vx) && Number.isFinite(stone.vy), `${label}: stone velocity`);
  }
}

test("起動直後は石が置かれておらず、投球準備ができている", () => {
  const world = new FrostCurlWorld(WIDTH, HEIGHT);

  assert.equal(world.stones.length, 0, "初エンドはガードがなく盤面が空");
  assert.equal(world.isReadyToThrow, true);
  assert.equal(world.score, 0);
  assert.equal(world.endIndex, 0);
  assert.equal(world.isOver, false);
});

test("投げると石が生成され、静止すると再び投球準備が整う", () => {
  const world = new FrostCurlWorld(WIDTH, HEIGHT);

  world.launch(0, -world.maxSpeed * 0.5, 1);
  assert.equal(world.stones.length, 1, "投球で石が1個生成される");
  assert.equal(world.isReadyToThrow, false, "飛んでいる間は次を投げられない");

  for (let i = 0; i < 600 && world.stones.some((s) => s.isMoving); i++) {
    world.step(FRAME);
  }

  assert.ok(
    world.stones.every((s) => !s.isMoving),
    "十分な時間で必ず静止する",
  );
  // 2投目がまだなのでエンドはまだ終わらず、次の投球を受け付ける
  assert.equal(world.isReadyToThrow, true, "静止後は次の石を投げられる");
  assertFinite(world, "1投目静止後");
});

test("準備が整っていないのに投げても無視される", () => {
  const world = new FrostCurlWorld(WIDTH, HEIGHT);
  world.launch(0, -world.maxSpeed * 0.5, 1);
  const countAfterFirst = world.stones.length;

  // 飛行中の2投目は無視されるべき
  world.launch(0, -world.maxSpeed * 0.5, 1);
  assert.equal(world.stones.length, countAfterFirst, "飛行中の追加投球は無視される");
});

test("ハウス内の石を集計してエンドの得点が入る", () => {
  const world = new FrostCurlWorld(WIDTH, HEIGHT);
  const events: EndCompleteEvent[] = [];
  world.onEndComplete = (event) => events.push(event);

  world.launch(0, -1, 1);
  const first = world.stones[world.stones.length - 1];
  Object.assign(first, {
    x: world.houseX,
    y: world.houseY,
    vx: 0,
    vy: 0,
    isMoving: false,
    hasBeenHit: true,
  });

  world.launch(0, -1, -1);
  const second = world.stones[world.stones.length - 1];
  Object.assign(second, {
    x: world.houseX + world.houseOuterRadius * 2,
    y: world.houseY,
    vx: 0,
    vy: 0,
    isMoving: false,
    hasBeenHit: true,
  });

  for (let i = 0; i < 200 && events.length === 0; i++) world.step(0.1);

  assert.equal(events.length, 1, "2投とも静止したらエンドが確定する");
  assert.equal(events[0].points, 6, "ボタン(中心)の石だけが加点(6点)される");
  assert.equal(world.score, 6);
});

test("ホグラインを越えられなかった石はバーンされて0点になる", () => {
  const world = new FrostCurlWorld(WIDTH, HEIGHT);
  const burned: StoneBurnedEvent[] = [];
  world.onStoneBurned = (event) => burned.push(event);

  // 静止しきい値を下回る極小速度で投げ、ハックのすぐ手前で止まらせる
  world.launch(0, -world.maxSpeed * 0.02, 1);
  world.step(FRAME);

  assert.equal(burned.length, 1, "ホグライン未達でバーンされる");
  assert.equal(burned[0].reason, "hogline");
  assert.equal(world.stones.length, 0, "バーンされた石は盤面から消える");
});

test("サイドラインを割った石はバーンされる", () => {
  const world = new FrostCurlWorld(WIDTH, HEIGHT);
  const burned: StoneBurnedEvent[] = [];
  world.onStoneBurned = (event) => burned.push(event);

  world.launch(2000, -50, 1);
  for (let i = 0; i < 120 && burned.length === 0; i++) world.step(FRAME);

  assert.equal(burned.length, 1, "サイドラインの外に出ればバーンされる");
  assert.equal(burned[0].reason, "boundary");
});

test("他の石に衝突済みの石はホグライン未達でもバーンされない", () => {
  const world = new FrostCurlWorld(WIDTH, HEIGHT);
  const burned: StoneBurnedEvent[] = [];
  world.onStoneBurned = (event) => burned.push(event);

  const stationaryY = world.hackY - 5;
  world.stones.push({
    id: 90001,
    x: world.hackX,
    y: stationaryY,
    vx: 0,
    vy: 0,
    spin: 1,
    owner: "guard",
    isMoving: false,
    hasBeenHit: false,
  });
  world.stones.push({
    id: 90002,
    x: world.hackX + world.stoneRadius * 1.5,
    y: stationaryY,
    // 停止しきい値を上回る速度で実際にぶつけ、衝突による速度交換(hasBeenHit)を発生させる。
    vx: -world.maxSpeed * 0.15,
    vy: 0,
    spin: 1,
    owner: "player",
    isMoving: true,
    hasBeenHit: false,
  });

  for (let i = 0; i < 300; i++) world.step(FRAME);

  const playerStone = world.stones.find((s) => s.owner === "player");
  assert.ok(playerStone, "衝突した石はホグライン手前でも除去されない");
  assert.equal(playerStone?.hasBeenHit, true);
  assert.equal(
    burned.filter((b) => b.reason === "hogline").length,
    0,
    "衝突済みの石にホグライン判定は適用されない",
  );
});

test("previewTrajectory はスピン方向に応じて左右対称にカールする", () => {
  const world = new FrostCurlWorld(WIDTH, HEIGHT);
  const vy = -world.maxSpeed * 0.6;

  const curlLeft = world.previewTrajectory(0, vy, -1);
  const curlRight = world.previewTrajectory(0, vy, 1);

  assert.ok(curlLeft.length > 0 && curlRight.length > 0, "軌道が計算される");

  const leftOffset = curlLeft[curlLeft.length - 1].x - world.hackX;
  const rightOffset = curlRight[curlRight.length - 1].x - world.hackX;

  assert.ok(Math.abs(leftOffset) > 1, "カールで横方向にずれる");
  assert.ok(Math.abs(leftOffset + rightOffset) < 1e-6, "スピンが逆なら左右対称にカールする");
});

test("全エンドを終えるとゲームが終了し、リセットで最初から遊べる", () => {
  const world = new FrostCurlWorld(WIDTH, HEIGHT);
  const endEvents: EndCompleteEvent[] = [];
  const guardCountByEnd = new Map<number, number>();
  world.onEndComplete = (event) => endEvents.push(event);

  let safety = 0;
  while (!world.isOver && safety < 20000) {
    if (world.isReadyToThrow) {
      if (!guardCountByEnd.has(world.endIndex)) {
        guardCountByEnd.set(world.endIndex, world.stones.filter((s) => s.owner === "guard").length);
      }
      const spin = world.stonesThrownThisEnd % 2 === 0 ? 1 : -1;
      world.launch(0, -world.maxSpeed * 0.5, spin);
    }
    world.step(1 / 30);
    assertFinite(world, "全エンド進行中");
    safety++;
  }

  assert.equal(world.isOver, true, "規定エンドをすべて終えるとゲームが終わる");
  assert.equal(endEvents.length, TOTAL_ENDS, "エンド数ぶんの結果イベントが発火する");
  assert.equal(guardCountByEnd.get(0), 0, "初エンドはガードなし");
  assert.equal(guardCountByEnd.get(1), 1, "2エンド目はガードが1個増える");
  assert.equal(guardCountByEnd.get(TOTAL_ENDS - 1), TOTAL_ENDS - 1, "最終エンドが一番混み合う");

  // 終了後に進めても壊れない
  world.step(FRAME);
  assertFinite(world, "ゲーム終了後");

  world.reset();
  assert.equal(world.isOver, false);
  assert.equal(world.score, 0);
  assert.equal(world.endIndex, 0);
  assert.equal(world.isReadyToThrow, true);
  assert.equal(world.stonesThrownThisEnd, 0);
});

test("画面サイズが変わってもハウス/ハックと石が画面内に収まる範囲で追従する", () => {
  const world = new FrostCurlWorld(WIDTH, HEIGHT);
  world.launch(0, -world.maxSpeed * 0.3, 1);
  const stone = world.stones[world.stones.length - 1];
  Object.assign(stone, { vx: 0, vy: 0, isMoving: false });

  world.resize(375, 720); // スマホ縦持ち
  assert.ok(world.houseX >= 0 && world.houseX <= 375, "ハウスが画面内(横)");
  assert.ok(world.houseY >= 0 && world.houseY <= 720, "ハウスが画面内(縦)");
  assert.ok(world.hackX >= 0 && world.hackX <= 375, "ハックが画面内(横)");
  assert.ok(world.hackY >= 0 && world.hackY <= 720, "ハックが画面内(縦)");
  assertFinite(world, "スマホ縦へのリサイズ後");

  world.resize(780, 390); // 横長
  assertFinite(world, "横長へのリサイズ後");
  for (let i = 0; i < STONES_PER_END * 30; i++) world.step(FRAME);
  assertFinite(world, "リサイズ後の進行");
});
