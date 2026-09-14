import assert from "node:assert/strict";
import { test } from "node:test";
import { PulseLockWorld, START_LIVES } from "./world.ts";

const FRAME = 1 / 60;
const TAU = Math.PI * 2;

/** アクティブなタンブラーのターゲットゾーンの中心に、指針をぴったり合わせる。 */
function alignActiveTumblerToCenter(world: PulseLockWorld): void {
  const tumbler = world.activeTumbler;
  assert.ok(tumbler, "アクティブなタンブラーが存在する");
  if (!tumbler) return;
  tumbler.angle = (tumbler.targetStart + tumbler.targetWidth / 2) % TAU;
}

/** アクティブなタンブラーの指針を、ターゲットゾーンの正反対(確実に外れる位置)へ動かす。 */
function moveActiveTumblerOffTarget(world: PulseLockWorld): void {
  const tumbler = world.activeTumbler;
  assert.ok(tumbler, "アクティブなタンブラーが存在する");
  if (!tumbler) return;
  tumbler.angle = (tumbler.targetStart + Math.PI) % TAU;
}

test("起動直後にレベル1・満タンのライフ・タンブラーが揃っている", () => {
  const world = new PulseLockWorld();

  assert.equal(world.level, 1);
  assert.equal(world.lives, START_LIVES);
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.activeTumblerIndex, 0);
  assert.ok(world.tumblers.length >= 2, "タンブラーが2つ以上配置されている");
  for (const tumbler of world.tumblers) {
    assert.equal(tumbler.isSolved, false);
  }
});

test("ターゲットゾーンに指針が重なった瞬間にタップすると解錠され、次のタンブラーへ進む", () => {
  const world = new PulseLockWorld();
  const solvedEvents: number[] = [];
  world.onTumblerSolved = (event) => solvedEvents.push(event.points);

  const tumblerCount = world.tumblers.length;
  alignActiveTumblerToCenter(world);
  world.attemptLock();

  assert.equal(solvedEvents.length, 1, "解錠イベントが発火する");
  assert.ok(solvedEvents[0] > 0, "得点が入っている");
  assert.equal(world.score, solvedEvents[0]);
  assert.equal(world.combo, 1);
  assert.equal(world.tumblers[0].isSolved, true);
  assert.equal(
    world.activeTumblerIndex,
    tumblerCount > 1 ? 1 : 0,
    "2番目以降のタンブラーがあれば進む(1つしかなければロード済み次レベルの0番目)",
  );
});

test("中心にぴったり合わせるほど得点が高い", () => {
  const world = new PulseLockWorld();
  const tumbler = world.activeTumbler;
  assert.ok(tumbler);
  if (!tumbler) return;

  // ゾーンの端ギリギリ(精度が低い)でタップ
  tumbler.angle = (tumbler.targetStart + tumbler.targetWidth * 0.02) % TAU;
  let edgePoints = 0;
  world.onTumblerSolved = (event) => {
    edgePoints = event.points;
  };
  world.attemptLock();
  assert.ok(edgePoints > 0, "端でも解錠はできる");

  const world2 = new PulseLockWorld();
  alignActiveTumblerToCenter(world2);
  let centerPoints = 0;
  world2.onTumblerSolved = (event) => {
    centerPoints = event.points;
  };
  world2.attemptLock();

  assert.ok(centerPoints > edgePoints, "中心の方が端より高得点");
});

test("ターゲットゾーンを外してタップするとコンボが切れてライフが減る", () => {
  const world = new PulseLockWorld();
  alignActiveTumblerToCenter(world);
  world.attemptLock();
  assert.equal(world.combo, 1);

  const missedEvents: number[] = [];
  world.onLockMissed = (event) => missedEvents.push(event.livesRemaining);

  moveActiveTumblerOffTarget(world);
  world.attemptLock();

  assert.equal(missedEvents.length, 1, "ミスイベントが発火する");
  assert.equal(world.combo, 0, "コンボがリセットされる");
  assert.equal(world.lives, START_LIVES - 1);
  assert.equal(missedEvents[0], world.lives);
  assert.equal(world.isOver, false, "ライフが残っていればまだ続く");
});

test("ライフが尽きるとゲームオーバーになり、以降の入力を無視する", () => {
  const world = new PulseLockWorld();

  for (let i = 0; i < START_LIVES; i++) {
    moveActiveTumblerOffTarget(world);
    world.attemptLock();
  }

  assert.equal(world.lives, 0);
  assert.equal(world.isOver, true);

  const scoreBefore = world.score;
  const activeIndexBefore = world.activeTumblerIndex;
  world.step(FRAME);
  alignActiveTumblerToCenter(world);
  world.attemptLock();

  assert.equal(world.score, scoreBefore, "ゲームオーバー後はタップしても得点が変わらない");
  assert.equal(world.activeTumblerIndex, activeIndexBefore);
  assert.equal(world.lives, 0, "ライフはマイナスにならない");
});

test("すべてのタンブラーを解錠するとレベルが上がり、新しいロックが生成される", () => {
  const world = new PulseLockWorld();
  const levelBefore = world.level;
  const completedEvents: number[] = [];
  world.onLockCompleted = (event) => completedEvents.push(event.level);

  // レベル1のタンブラーを全部解錠する
  while (world.level === levelBefore && !world.isOver) {
    alignActiveTumblerToCenter(world);
    world.attemptLock();
  }

  assert.equal(completedEvents.length, 1, "ロード完了イベントが1回発火する");
  assert.equal(completedEvents[0], levelBefore);
  assert.equal(world.level, levelBefore + 1);
  assert.equal(world.activeTumblerIndex, 0, "新しいロックの最初のタンブラーに戻る");
  assert.ok(world.tumblers.length >= 2, "新しいロックにもタンブラーが配置されている");
  for (const tumbler of world.tumblers) {
    assert.equal(tumbler.isSolved, false, "新しいロックのタンブラーは未解錠");
  }
});

test("step() はアクティブなタンブラーの指針だけを進め、待機中のタンブラーは動かさない", () => {
  const world = new PulseLockWorld();
  if (world.tumblers.length < 2) return; // レベル1は常に2つ以上なので通常は入らない

  const waitingAngleBefore = world.tumblers[1].angle;
  for (let i = 0; i < 30; i++) world.step(FRAME);

  assert.notEqual(world.tumblers[0].angle, undefined);
  assert.equal(world.tumblers[1].angle, waitingAngleBefore, "待機中のタンブラーは静止している");
});

test("指針が2πをまたいでもターゲット判定が正しく機能する(角度の正規化)", () => {
  const world = new PulseLockWorld();
  const tumbler = world.activeTumbler;
  assert.ok(tumbler);
  if (!tumbler) return;

  // ターゲットゾーンが0付近をまたぐケースを作る
  tumbler.targetStart = TAU - 0.4;
  tumbler.targetWidth = 0.8;
  // ゾーン中心(TAU - 0.4 + 0.4 = TAU ≡ 0)をまたいだ直後の角度
  tumbler.angle = 0.05;

  const solvedEvents: number[] = [];
  world.onTumblerSolved = (event) => solvedEvents.push(event.points);
  world.attemptLock();

  assert.equal(solvedEvents.length, 1, "2πをまたぐターゲットゾーンでも解錠できる");
});

test("ライフが尽きたあとに reset() すると最初から遊べる", () => {
  const world = new PulseLockWorld();
  for (let i = 0; i < START_LIVES; i++) {
    moveActiveTumblerOffTarget(world);
    world.attemptLock();
  }
  assert.equal(world.isOver, true);

  world.reset();

  assert.equal(world.isOver, false);
  assert.equal(world.level, 1);
  assert.equal(world.lives, START_LIVES);
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.activeTumblerIndex, 0);
});
