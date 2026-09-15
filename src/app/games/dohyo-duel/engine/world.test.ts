import assert from "node:assert/strict";
import { test } from "node:test";
import { DOHYO_DUEL_START_LIVES, DohyoDuelWorld } from "./world.ts";

const WIDTH = 480;
const HEIGHT = 800;
const TINY_FRAME = 1 / 240;

function assertFinite(world: DohyoDuelWorld, label: string): void {
  assert.ok(Number.isFinite(world.displacement), `${label}: displacement`);
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.round), `${label}: round`);
  assert.ok(Number.isFinite(world.opponentTimer), `${label}: opponentTimer`);
}

/** 相手の次の一押しを即座に発生させる(タイマーを0にしてから1フレーム進める)。 */
function forceOpponentShove(world: DohyoDuelWorld): void {
  world.opponentTimer = 0;
  world.step(TINY_FRAME);
}

test("開始直後は土俵の中央にいて、ラウンド1・満タンのライフで始まる", () => {
  const world = new DohyoDuelWorld(WIDTH, HEIGHT);

  assert.equal(world.displacement, 0);
  assert.equal(world.round, 1);
  assert.equal(world.score, 0);
  assert.equal(world.winStreak, 0);
  assert.equal(world.lives, DOHYO_DUEL_START_LIVES);
  assert.equal(world.isOver, false);
  assert.ok(world.ringRadius > 0, "土俵の半径が正");
  assertFinite(world, "開始直後");
});

test("ためている時間はチャージ最大値でクランプされる", () => {
  const world = new DohyoDuelWorld(WIDTH, HEIGHT);
  world.opponentTimer = 1000; // 相手の割り込みを止め、ため動作だけを見る(テストのループ時間より十分大きい値)
  world.startCharging();
  for (let i = 0; i < 600; i++) world.step(TINY_FRAME);

  assert.equal(world.chargeRatio, 1, "チャージ割合は1を超えない");
  assertFinite(world, "チャージ最大時");
});

test("満タンまでためて離すと最大威力で相手を押し返す", () => {
  const world = new DohyoDuelWorld(WIDTH, HEIGHT);
  world.opponentTimer = 1000; // 相手の割り込みを止め、ため動作だけを見る(テストのループ時間より十分大きい値)
  world.startCharging();
  for (let i = 0; i < 600; i++) world.step(TINY_FRAME);

  const shoves: Array<{ power: number; isPoke: boolean; isCounterBonus: boolean }> = [];
  world.onPlayerShove = (event) => shoves.push(event);
  world.releaseCharge();

  assert.equal(shoves.length, 1, "押し込みイベントが1回発火する");
  assert.equal(shoves[0].isPoke, false, "十分ためたので突きではない");
  assert.equal(shoves[0].isCounterBonus, false, "反撃猶予の外なのでボーナスなし");
  assert.equal(world.displacement, -shoves[0].power, "自分が押した分だけ相手側へ位置が動く");
  assertFinite(world, "満タン押し込み後");
});

test("ほぼ間を置かずに離すと軽い突きになる", () => {
  const world = new DohyoDuelWorld(WIDTH, HEIGHT);
  world.startCharging();

  const shoves: Array<{ power: number; isPoke: boolean }> = [];
  world.onPlayerShove = (event) => shoves.push(event);
  world.releaseCharge();

  assert.equal(shoves.length, 1);
  assert.equal(shoves[0].isPoke, true, "ためが短いので突き扱い");
  assertFinite(world, "突き後");
});

test("ためていないときにリリースしても何も起きない", () => {
  const world = new DohyoDuelWorld(WIDTH, HEIGHT);
  const shoves: unknown[] = [];
  world.onPlayerShove = (event) => shoves.push(event);
  world.releaseCharge();

  assert.equal(shoves.length, 0, "ためていない状態でのリリースはイベントを発火しない");
  assert.equal(world.displacement, 0);
});

test("相手の突き直後の猶予内に押し返すと反撃ボーナスが乗る", () => {
  const world = new DohyoDuelWorld(WIDTH, HEIGHT);
  forceOpponentShove(world);
  assert.ok(world.counterWindowSeconds > 0, "前提: 反撃猶予が発生している");

  world.startCharging();
  for (let i = 0; i < 60; i++) world.step(TINY_FRAME); // MIN_CHARGE_FOR_SHOVE_SECONDS を超える程度ためる

  const shoves: Array<{ power: number; isCounterBonus: boolean }> = [];
  world.onPlayerShove = (event) => shoves.push(event);
  world.releaseCharge();

  assert.equal(shoves.length, 1);
  assert.equal(shoves[0].isCounterBonus, true, "猶予内の押し込みは反撃ボーナス扱い");
  assertFinite(world, "反撃ボーナス後");
});

test("ため中に相手の突きを受けると構えが崩れて余計に押し込まれる", () => {
  const worldCaught = new DohyoDuelWorld(WIDTH, HEIGHT);
  worldCaught.startCharging();
  const caughtEvents: Array<{ power: number; caughtPlayerCharging: boolean }> = [];
  worldCaught.onOpponentShove = (event) => caughtEvents.push(event);
  forceOpponentShove(worldCaught);

  const worldFree = new DohyoDuelWorld(WIDTH, HEIGHT);
  const freeEvents: Array<{ power: number; caughtPlayerCharging: boolean }> = [];
  worldFree.onOpponentShove = (event) => freeEvents.push(event);
  forceOpponentShove(worldFree);

  assert.equal(caughtEvents.length, 1);
  assert.equal(freeEvents.length, 1);
  assert.equal(caughtEvents[0].caughtPlayerCharging, true);
  assert.equal(freeEvents[0].caughtPlayerCharging, false);
  assert.ok(
    caughtEvents[0].power > freeEvents[0].power,
    "ため中に受けた方が押し込まれる量が大きい",
  );
});

test("相手を土俵際まで押し切ると勝ちになり、ラウンドと得点が進む", () => {
  const world = new DohyoDuelWorld(WIDTH, HEIGHT);
  const results: Array<{ didPlayerWin: boolean; round: number }> = [];
  world.onBoutEnd = (event) => results.push(event);

  // 勝ち判定ぎりぎり手前まで押し込んでおき、最後の一押しで決着させる
  world.displacement = -world.ringRadius + 1;
  world.startCharging();
  for (let i = 0; i < 600; i++) world.step(TINY_FRAME);
  world.releaseCharge();

  assert.equal(results.length, 1, "決着イベントが1回発火する");
  assert.equal(results[0].didPlayerWin, true);
  assert.equal(results[0].round, 1, "決着したのはラウンド1");
  assert.equal(world.round, 2, "勝つと次のラウンドへ進む");
  assert.equal(world.winStreak, 1);
  assert.equal(world.score, 100, "初勝利の得点はベーススコア分");
  assert.equal(world.displacement, 0, "次の取組へ向けて位置がリセットされる");
  assert.equal(world.lives, DOHYO_DUEL_START_LIVES, "勝った場合はライフが減らない");
  assertFinite(world, "勝利後");
});

test("押し出されると負けになりライフが減るが、ライフが残っていれば続けられる", () => {
  const world = new DohyoDuelWorld(WIDTH, HEIGHT);
  const results: Array<{ didPlayerWin: boolean }> = [];
  world.onBoutEnd = (event) => results.push(event);

  world.displacement = world.ringRadius - 1;
  forceOpponentShove(world);

  assert.equal(results.length, 1);
  assert.equal(results[0].didPlayerWin, false);
  assert.equal(world.lives, DOHYO_DUEL_START_LIVES - 1, "ライフが1減る");
  assert.equal(world.winStreak, 0, "連勝が途切れる");
  assert.equal(world.isOver, false, "ライフが残っていれば試合は続く");
  assert.equal(world.displacement, 0, "次の取組へ向けて位置がリセットされる");
  assertFinite(world, "敗北後");
});

test("ライフが尽きるとゲームオーバーになり、以降は状態が変化しない", () => {
  const world = new DohyoDuelWorld(WIDTH, HEIGHT);

  for (let i = 0; i < DOHYO_DUEL_START_LIVES; i++) {
    world.displacement = world.ringRadius - 1;
    forceOpponentShove(world);
  }

  assert.equal(world.isOver, true);
  assert.equal(world.lives, 0);

  const displacementBefore = world.displacement;
  world.step(TINY_FRAME);
  world.startCharging();
  world.releaseCharge();
  assert.equal(world.displacement, displacementBefore, "ゲームオーバー後は位置が変化しない");
  assertFinite(world, "ゲームオーバー後");

  world.reset();
  assert.equal(world.isOver, false);
  assert.equal(world.round, 1);
  assert.equal(world.score, 0);
  assert.equal(world.lives, DOHYO_DUEL_START_LIVES);
  assert.equal(world.displacement, 0);
});

test("画面サイズが変わっても土俵の半径は正の値を保ち、位置の比率も維持される", () => {
  const world = new DohyoDuelWorld(WIDTH, HEIGHT);
  world.displacement = world.ringRadius * 0.5;
  const ratioBefore = world.displacement / world.ringRadius;

  world.resize(1200, 900);
  assert.ok(world.ringRadius > 0, "リサイズ後も半径は正");
  assert.ok(
    Math.abs(world.displacement / world.ringRadius - ratioBefore) < 1e-9,
    "せめぎ合いの位置の比率が保たれる",
  );

  world.resize(4, 4);
  assert.ok(world.ringRadius > 0, "極端に小さい画面でも半径は下限を下回らない");
  assertFinite(world, "極端なリサイズ後");
});

test("ランダムな操作パターンを続けても状態が破綻しない", () => {
  const world = new DohyoDuelWorld(WIDTH, HEIGHT);

  for (let i = 0; i < 2000; i++) {
    if (i % 37 === 0) world.startCharging();
    if (i % 53 === 0) world.releaseCharge();
    world.step(TINY_FRAME * 4);
    if (world.isOver) world.reset();
    assertFinite(world, `${i}フレーム目`);
  }
});
