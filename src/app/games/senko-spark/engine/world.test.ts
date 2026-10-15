import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SEPARATION_SAFE_RADIUS,
  SenkoSparkWorld,
  SPARK_CATCH_RADIUS,
  STABILITY_MAX,
} from "./world.ts";

const WIDTH = 960;
const HEIGHT = 540;
const FRAME = 1 / 60;

function assertFinite(world: SenkoSparkWorld, label: string): void {
  assert.ok(Number.isFinite(world.handX) && Number.isFinite(world.handY), `${label}: hand`);
  assert.ok(Number.isFinite(world.emberX) && Number.isFinite(world.emberY), `${label}: ember`);
  assert.ok(Number.isFinite(world.stability), `${label}: stability`);
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  for (const spark of world.sparks) {
    assert.ok(Number.isFinite(spark.x) && Number.isFinite(spark.y), `${label}: spark`);
  }
}

test("起動直後は安定度満タンでスコア0、火球は持ち手と同じ位置にある", () => {
  const world = new SenkoSparkWorld(WIDTH, HEIGHT);

  assert.equal(world.stability, STABILITY_MAX);
  assert.equal(world.score, 0);
  assert.equal(world.sparksCaught, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.emberX, world.handX);
  assert.equal(world.emberY, world.handY);
  assertFinite(world, "起動直後");
});

test("持ち手を動かさずにいると安定度はほぼ満タンのまま、時間経過でスコアが増える", () => {
  const world = new SenkoSparkWorld(WIDTH, HEIGHT);

  for (let i = 0; i < 90; i++) world.step(FRAME);

  assert.ok(
    world.stability > STABILITY_MAX - 1,
    "揺らしていなければ、短時間では自然減衰もごくわずかで安定度はほぼ満タンのまま",
  );
  assert.ok(world.score > 0, "生存時間ぶんスコアが入っている");
  assert.equal(world.isOver, false);
  assertFinite(world, "静止後");
});

test("完全に静止していても、線香花火のように時間経過だけで最終的には安定度が尽きる", () => {
  const world = new SenkoSparkWorld(WIDTH, HEIGHT);

  let seconds = 0;
  while (!world.isOver && seconds < 240) {
    world.step(FRAME);
    seconds += FRAME;
  }

  assert.equal(world.isOver, true, "何もしなくても自然減衰でいつか火が消える");
  assert.ok(seconds > 30, "序盤ですぐには終わらない(猶予がある)");
  assertFinite(world, "自然減衰で終了した後");
});

test("持ち手を急に大きく動かすと火球との距離が開き、安定度が減る", () => {
  const world = new SenkoSparkWorld(WIDTH, HEIGHT);
  world.setHandPosition(world.width - 10, world.height - 10);

  world.step(FRAME);

  assert.ok(world.separation > SEPARATION_SAFE_RADIUS, "安全距離を超えて離れている");
  assert.ok(world.stability < STABILITY_MAX, "急な移動で安定度が減る");
  assertFinite(world, "急な移動直後");
});

test("安全距離の範囲内の小さな移動では安定度がほぼ減らない", () => {
  const world = new SenkoSparkWorld(WIDTH, HEIGHT);
  world.setHandPosition(world.handX + 5, world.handY + 5);

  world.step(FRAME);

  assert.ok(
    world.stability > STABILITY_MAX - 0.1,
    "安全距離内の移動では、自然減衰以外の罰則を受けない",
  );
  assertFinite(world, "小さな移動後");
});

test("持ち手を離れた位置へ揺さぶり続けると安定度が尽きて終了し、以後状態が変化しない", () => {
  const world = new SenkoSparkWorld(WIDTH, HEIGHT);

  let steps = 0;
  while (!world.isOver && steps < 600) {
    // 毎フレーム対角の端へ飛ばし続け、火球が追いつく前に常に大きく離しておく。
    const corner = steps % 2 === 0 ? { x: 0, y: 0 } : { x: world.width, y: world.height };
    world.setHandPosition(corner.x, corner.y);
    world.step(FRAME);
    steps += 1;
  }

  assert.equal(world.isOver, true, "揺さぶり続けると安定度が尽きて終了する");
  assert.equal(world.stability, 0);
  assertFinite(world, "終了直後");

  const frozenScore = world.score;
  const frozenEmberX = world.emberX;
  world.setHandPosition(world.width / 2, world.height / 2);
  world.step(FRAME);

  assert.equal(world.score, frozenScore, "終了後はスコアが変化しない");
  assert.equal(world.emberX, frozenEmberX, "終了後は火球が動かない");
});

test("火花が掬える範囲にあるときに requestFlick すると、掬われて得点とイベントが発生する", () => {
  const world = new SenkoSparkWorld(WIDTH, HEIGHT);
  const caught: Array<{ points: number }> = [];
  world.onSparkCaught = (event) => caught.push({ points: event.points });

  const spark = {
    id: 999_001,
    x: world.emberX + SPARK_CATCH_RADIUS - 5,
    y: world.emberY,
    age: 0,
    bobPhase: 0,
  };
  world.sparks.push(spark);

  world.requestFlick();
  world.step(FRAME);

  assert.equal(world.sparksCaught, 1, "近くの火花を掬う");
  assert.equal(caught.length, 1);
  assert.ok(caught[0].points > 0, "得点が入っている");
  assert.ok(
    world.sparks.every((s) => s.id !== spark.id),
    "掬った火花はワールドから取り除かれる",
  );
  assertFinite(world, "火花を掬った後");
});

test("掬える範囲外で requestFlick しても何も起きない", () => {
  const world = new SenkoSparkWorld(WIDTH, HEIGHT);
  world.sparks.push({
    id: 999_002,
    x: world.emberX + SPARK_CATCH_RADIUS + 50,
    y: world.emberY,
    age: 0,
    bobPhase: 0,
  });

  world.requestFlick();
  world.step(FRAME);

  assert.equal(world.sparksCaught, 0, "範囲外の火花は掬われない");
  assert.equal(world.sparks.length, 1, "火花は取り除かれない");
});

test("掬われなかった火花は寿命が尽きると自然に消える", () => {
  const world = new SenkoSparkWorld(WIDTH, HEIGHT);
  world.sparks.push({
    id: 999_003,
    x: world.width - 5,
    y: world.height - 5,
    age: 10,
    bobPhase: 0,
  });

  world.step(FRAME);

  assert.equal(world.sparks.length, 0, "寿命切れの火花は消える");
  assert.equal(world.sparksCaught, 0, "掬わずに消えた場合はカウントされない");
});

test("時間経過で火花が自動的に湧いてくる", () => {
  const world = new SenkoSparkWorld(WIDTH, HEIGHT);

  for (let i = 0; i < 60 * 6 && world.sparks.length === 0; i++) world.step(FRAME);

  assert.ok(world.sparks.length > 0, "6秒もあれば少なくとも1つは火花が出現する");
  assertFinite(world, "火花出現後");
});

test("reset() で安定度・スコア・火球・火花が初期状態に戻る", () => {
  const world = new SenkoSparkWorld(WIDTH, HEIGHT);
  for (let i = 0; i < 400 && !world.isOver; i++) {
    world.setHandPosition(i % 2 === 0 ? 0 : world.width, i % 2 === 0 ? 0 : world.height);
    world.step(FRAME);
  }
  assert.equal(world.isOver, true, "前提: 一度終了させておく");

  world.reset();

  assert.equal(world.stability, STABILITY_MAX);
  assert.equal(world.score, 0);
  assert.equal(world.sparksCaught, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.sparks.length, 0);
  assert.equal(world.emberX, world.handX);
  assert.equal(world.emberY, world.handY);
});

test("画面サイズが変わっても持ち手・火球・火花が画面内に収まる", () => {
  const world = new SenkoSparkWorld(WIDTH, HEIGHT);
  world.setHandPosition(WIDTH * 0.9, HEIGHT * 0.9);
  world.step(FRAME);
  world.sparks.push({ id: 999_004, x: WIDTH * 0.8, y: HEIGHT * 0.2, age: 0, bobPhase: 0 });

  world.resize(375, 720);

  assert.ok(world.handX >= -1 && world.handX <= 376, "持ち手が画面内に収まる");
  assert.ok(world.emberX >= -1 && world.emberX <= 376, "火球が画面内に収まる");
  for (const spark of world.sparks) {
    assert.ok(spark.x >= -1 && spark.x <= 376, "火花が画面内に収まる");
  }

  // 不正なサイズを渡しても壊れない
  world.resize(0, 0);
  world.resize(-10, -10);
  assert.ok(world.width > 0 && world.height > 0, "不正なリサイズ値は無視される");
  assertFinite(world, "リサイズ後");
});

test("長時間ランダムに操作しても数値が破綻しない", () => {
  const world = new SenkoSparkWorld(WIDTH, HEIGHT);

  for (let i = 0; i < 1000; i++) {
    world.setHandPosition(Math.random() * WIDTH, Math.random() * HEIGHT);
    if (i % 7 === 0) world.requestFlick();
    world.step(FRAME);
    assert.ok(world.stability >= 0 && world.stability <= STABILITY_MAX, "安定度が範囲内に収まる");
    assertFinite(world, `ランダム操作 ${i} 回目`);
    if (world.isOver) break;
  }
});
