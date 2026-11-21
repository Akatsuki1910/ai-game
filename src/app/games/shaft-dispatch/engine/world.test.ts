import assert from "node:assert/strict";
import { test } from "node:test";
import { CAR_CAPACITY, FLOOR_COUNT, ROUND_SECONDS, ShaftDispatchWorld } from "./world.ts";

const FRAME = 1 / 60;

function stepUntil(
  world: ShaftDispatchWorld,
  predicate: (world: ShaftDispatchWorld) => boolean,
  maxFrames = 600,
): void {
  for (let i = 0; i < maxFrames && !predicate(world); i++) {
    world.step(FRAME);
  }
  assert.ok(predicate(world), "期待する状態に到達しないままタイムアウトした");
}

function assertFinite(world: ShaftDispatchWorld, label: string): void {
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.timeRemaining), `${label}: timeRemaining`);
  assert.ok(Number.isFinite(world.carFloor), `${label}: carFloor`);
  for (const queue of world.waitingByFloor) {
    for (const passenger of queue) {
      assert.ok(Number.isFinite(passenger.patience), `${label}: waiting passenger patience`);
    }
  }
  for (const passenger of world.onboard) {
    assert.ok(
      Number.isFinite(passenger.boardedPatienceFraction),
      `${label}: onboard passenger fraction`,
    );
  }
}

test("起動直後に初期状態が整っている", () => {
  const world = new ShaftDispatchWorld();

  assert.equal(world.carFloor, FLOOR_COUNT - 1, "車は最上階からスタートする");
  assert.equal(world.score, 0);
  assert.equal(world.deliveredCount, 0);
  assert.equal(world.missedCount, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.timeRemaining, ROUND_SECONDS);
  assert.equal(world.waitingByFloor[0].length, 1, "1Fに最初の乗客が必ず待っている");
  assert.notEqual(world.waitingByFloor[0][0].destinationFloor, 0, "行き先は出発階と異なる");
});

test("階を呼ぶと車が移動して到着し、扉が開いて乗客を乗せる", () => {
  const world = new ShaftDispatchWorld();

  world.requestCar(0);
  stepUntil(world, (w) => w.isDoorOpen);

  assert.equal(world.carFloor, 0, "1Fに到着している");
  assert.equal(world.onboard.length, 1, "待っていた乗客を乗せた");
  assert.equal(world.waitingByFloor[0].length, 0, "乗せた分は待ち行列から消える");
});

test("扉が開いている間は新しい呼び出しを無視する", () => {
  const world = new ShaftDispatchWorld();
  world.requestCar(0);
  stepUntil(world, (w) => w.isDoorOpen);

  world.requestCar(FLOOR_COUNT - 1);
  assert.equal(world.targetFloor, null, "扉が開いている間の呼び出しは無視される");

  stepUntil(world, (w) => !w.isDoorOpen);
  assert.equal(world.targetFloor, null, "無視された呼び出しは扉が閉じても復活しない");
});

test("降車階に着くと得点が入り、乗客は降りる", () => {
  const world = new ShaftDispatchWorld();
  world.requestCar(0);
  stepUntil(world, (w) => w.isDoorOpen);

  const passengerId = world.onboard[0].id;
  const destinationFloor = world.onboard[0].destinationFloor;
  stepUntil(world, (w) => !w.isDoorOpen);

  world.requestCar(destinationFloor);
  stepUntil(world, (w) => w.isDoorOpen && w.carFloor === destinationFloor);

  // 移動中に別の乗客が同じ階でたまたま湧いて乗り込むこともあるので、
  // 車内が空であることではなく「目的の乗客がちゃんと降りたか」で検証する。
  assert.equal(world.deliveredCount, 1, "1人運び終えた");
  assert.ok(
    world.onboard.every((p) => p.id !== passengerId),
    "対象の乗客は降りている",
  );
  assert.ok(world.score > 0, "得点が入っている");
});

test("すでにいる階を呼ぶと移動せずに即座に扉が開く", () => {
  const world = new ShaftDispatchWorld();

  world.requestCar(FLOOR_COUNT - 1);

  assert.equal(world.isDoorOpen, true, "移動不要なら即座に扉が開く");
  assert.equal(world.carFloor, FLOOR_COUNT - 1);
});

test("待ちきれない乗客は忍耐が尽きるとミスになり、スコアは0未満にならない", () => {
  const world = new ShaftDispatchWorld();
  const missed: number[] = [];
  world.onMissed = ({ floor }) => missed.push(floor);

  // 自然な経過を待たず、直接忍耐をゼロ近くまで減らして決定的に検証する。
  world.waitingByFloor[0][0].patience = 0.01;

  world.step(FRAME);

  assert.equal(missed.length, 1, "ミスイベントが1件発生する");
  assert.equal(missed[0], 0, "ミスした階が記録される");
  assert.equal(world.missedCount, 1);
  assert.equal(world.waitingByFloor[0].length, 0, "見切られた乗客は待ち行列から消える");
  assert.equal(world.score, 0, "スコアは負にならずクランプされる");
});

test("乗車定員を超える人数が待っていても、定員までしか乗らず残りは待ち続ける", () => {
  const world = new ShaftDispatchWorld();
  const floor = 2;
  world.waitingByFloor[floor] = Array.from({ length: CAR_CAPACITY + 2 }, (_, i) => ({
    id: 1000 + i,
    destinationFloor: (floor + 1) % FLOOR_COUNT,
    patience: 999,
  }));

  world.requestCar(floor);
  stepUntil(world, (w) => w.isDoorOpen);

  assert.equal(world.onboard.length, CAR_CAPACITY, "定員までしか乗せない");
  assert.equal(world.waitingByFloor[floor].length, 2, "乗り切れなかった乗客はその階に残って待つ");
});

test("範囲外の階やラウンド終了後の呼び出しは無視される", () => {
  const world = new ShaftDispatchWorld();

  world.requestCar(-1);
  assert.equal(world.targetFloor, null);
  world.requestCar(FLOOR_COUNT);
  assert.equal(world.targetFloor, null);

  world.isOver = true;
  world.requestCar(0);
  assert.equal(world.targetFloor, null, "ラウンド終了後は呼び出しを受け付けない");
});

test("90秒遊ぶとラウンドが終わり、リスタートで最初から遊べる", () => {
  const world = new ShaftDispatchWorld();

  for (let i = 0; i < 2000 && !world.isOver; i++) {
    world.requestCar(i % FLOOR_COUNT);
    world.step(0.1);
    assertFinite(world, "ラウンド中");
  }

  assert.equal(world.isOver, true, "ラウンドが終了する");
  assert.equal(world.timeRemaining, 0);

  // 終了後に進めても壊れない
  world.step(FRAME);
  assertFinite(world, "ラウンド終了後");

  world.reset();
  assert.equal(world.isOver, false);
  assert.equal(world.score, 0);
  assert.equal(world.carFloor, FLOOR_COUNT - 1);
  assert.equal(world.waitingByFloor[0].length, 1);
  assert.equal(world.onboard.length, 0);
});

test("長時間のランダムな運行でも値が破綻しない", () => {
  const world = new ShaftDispatchWorld();

  for (let i = 0; i < 1800; i++) {
    if (i % 37 === 0) world.requestCar(Math.floor(Math.random() * FLOOR_COUNT));
    world.step(FRAME);
    assertFinite(world, `frame ${i}`);
    if (world.isOver) break;
  }
});
