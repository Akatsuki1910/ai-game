import assert from "node:assert/strict";
import { test } from "node:test";
import { FALL_ANGLE, HighWireWorld } from "./world.ts";

const WIDTH = 960;
const HEIGHT = 540;
const FRAME = 1 / 60;

function assertFinite(world: HighWireWorld, label: string): void {
  assert.ok(Number.isFinite(world.theta), `${label}: theta`);
  assert.ok(Number.isFinite(world.omega), `${label}: omega`);
  assert.ok(Number.isFinite(world.distance), `${label}: distance`);
  assert.ok(Number.isFinite(world.score), `${label}: score`);
}

test("起動直後は直立でスコア0、先のジェムがあらかじめ用意されている", () => {
  const world = new HighWireWorld(WIDTH, HEIGHT);

  assert.equal(world.theta, 0);
  assert.equal(world.omega, 0);
  assert.equal(world.distance, 0);
  assert.equal(world.score, 0);
  assert.equal(world.gemsCollected, 0);
  assert.equal(world.isOver, false);
  assert.ok(world.gems.length > 0, "先のジェムがあらかじめ用意されている");
  assertFinite(world, "起動直後");
});

test("無操作でも風でわずかに揺らされるが、序盤で急に転落することはない", () => {
  const world = new HighWireWorld(WIDTH, HEIGHT);

  for (let i = 0; i < 30; i++) world.step(FRAME);

  assert.equal(world.isOver, false, "0.5秒程度では風がまだ弱く転落しない");
  assert.ok(world.distance > 0, "前進している");
  assertFinite(world, "無操作でしばらく経過した後");
});

test("傾いているときは直立時より前進が遅くなる", () => {
  const upright = new HighWireWorld(WIDTH, HEIGHT);
  const tilted = new HighWireWorld(WIDTH, HEIGHT);
  tilted.setTilt(FALL_ANGLE * 0.7);

  upright.step(FRAME);
  tilted.step(FRAME);

  assert.ok(tilted.distance < upright.distance, "傾いている分だけ前進速度にペナルティがかかる");
  assertFinite(upright, "直立の1ステップ後");
  assertFinite(tilted, "傾いた状態の1ステップ後");
});

test("限界角度に達すると転落してゲームオーバーになり、以後は状態が変化しない", () => {
  const world = new HighWireWorld(WIDTH, HEIGHT);
  world.setTilt(FALL_ANGLE * 1.2);

  world.step(FRAME);

  assert.equal(world.isOver, true, "限界角度を超えたら転落する");
  assertFinite(world, "転落直後");

  const frozenTheta = world.theta;
  const frozenDistance = world.distance;
  const frozenScore = world.score;

  world.setLean(1);
  world.step(FRAME);

  assert.equal(world.theta, frozenTheta, "ゲームオーバー後は傾きが変化しない");
  assert.equal(world.distance, frozenDistance, "ゲームオーバー後は距離が変化しない");
  assert.equal(world.score, frozenScore, "ゲームオーバー後はスコアが変化しない");
});

test("傾いた方向と逆に体重をかけると、何もしない場合より立て直せる", () => {
  const corrected = new HighWireWorld(WIDTH, HEIGHT);
  const uncorrected = new HighWireWorld(WIDTH, HEIGHT);
  corrected.setTilt(0.3);
  uncorrected.setTilt(0.3);
  corrected.setLean(-1);

  // 体重をかけ続けると立て直る力はかなり強いので、あまり長く続けると
  // 今度は反対側へ行き過ぎてしまう(それ自体は仕様通り)。ここでは
  // 「逆向きに踏ん張った直後は傾きが小さくなる」という初動だけを見る。
  for (let i = 0; i < 20; i++) {
    corrected.step(FRAME);
    uncorrected.step(FRAME);
  }

  assert.ok(!corrected.isOver, "適切に踏ん張れば転落しない");
  assert.ok(
    Math.abs(corrected.theta) < Math.abs(uncorrected.theta),
    "逆向きに体重をかけたほうが傾きが小さく収まる",
  );
  assertFinite(corrected, "立て直した後");
});

test("ジェムに近づくと自動で拾われ、得点とイベントが発生する", () => {
  const world = new HighWireWorld(WIDTH, HEIGHT);
  const nearGem = { id: 999_001, x: world.distance + 5 };
  world.gems.unshift(nearGem);

  const collected: Array<{ points: number }> = [];
  world.onGemCollected = (event) => collected.push({ points: event.points });

  world.step(FRAME);

  assert.equal(world.gemsCollected, 1, "近くのジェムを自動で拾う");
  assert.ok(world.score > 0, "得点が入っている");
  assert.equal(collected.length, 1);
  assert.ok(collected[0].points > 0);
  assert.ok(
    world.gems.every((gem) => gem.id !== nearGem.id),
    "拾ったジェムはワールドから取り除かれる",
  );
});

test("reset() で傾き・距離・得点・ジェムが初期状態に戻る", () => {
  const world = new HighWireWorld(WIDTH, HEIGHT);
  world.setTilt(FALL_ANGLE * 1.5);
  world.step(FRAME);
  assert.equal(world.isOver, true, "前提: 一度転落させておく");

  world.reset();

  assert.equal(world.theta, 0);
  assert.equal(world.omega, 0);
  assert.equal(world.distance, 0);
  assert.equal(world.score, 0);
  assert.equal(world.gemsCollected, 0);
  assert.equal(world.isOver, false);
  assert.ok(world.gems.length > 0);
  assertFinite(world, "リセット後");
});

test("画面サイズが変わっても、表示範囲の先までジェムが用意される", () => {
  const world = new HighWireWorld(320, 480);
  const narrowFurthestGemX = Math.max(...world.gems.map((g) => g.x));

  world.resize(1600, 800);
  const wideFurthestGemX = Math.max(...world.gems.map((g) => g.x));

  assert.ok(wideFurthestGemX > narrowFurthestGemX, "画面が広がった分だけ先のジェムまで補充される");
  assert.ok(
    wideFurthestGemX >= world.cameraX + world.logicalViewWidth,
    "表示範囲より手前でジェムが尽きない",
  );

  // 不正なサイズを渡しても壊れない
  world.resize(0, 0);
  world.resize(-10, -10);
  assert.ok(world.width > 0 && world.height > 0, "不正なリサイズ値は無視される");
});

test("前に進み続けるとジェム配列が際限なく伸びず、手前のものは掃除される", () => {
  const world = new HighWireWorld(WIDTH, HEIGHT);

  for (let i = 0; i < 2000 && !world.isOver; i++) {
    world.step(FRAME);
  }

  assert.ok(world.gems.length < 30, "手前のジェムが掃除され、配列が伸び続けない");
  assertFinite(world, "長距離移動後");
});
