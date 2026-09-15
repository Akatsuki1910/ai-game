import assert from "node:assert/strict";
import { test } from "node:test";
import { DOT_HOLD_THRESHOLD_MS, SignalLanternWorld, START_LIVES } from "./world.ts";

const FRAME = 1 / 60;
const DOT_HOLD_MS = DOT_HOLD_THRESHOLD_MS - 100;
const DASH_HOLD_MS = DOT_HOLD_THRESHOLD_MS + 200;

/** holdMs をそのシンボルの分類(点/線)に応じて選ぶ。 */
function holdMsFor(symbol: "dot" | "dash"): number {
  return symbol === "dot" ? DOT_HOLD_MS : DASH_HOLD_MS;
}

/** 反対のシンボルとして分類される holdMs を返す(わざと外すテスト用)。 */
function wrongHoldMsFor(symbol: "dot" | "dash"): number {
  return symbol === "dot" ? DASH_HOLD_MS : DOT_HOLD_MS;
}

/** showing フェーズを抜けて input フェーズに入るまで、十分な時間ぶん step する。 */
function advanceToInputPhase(world: SignalLanternWorld): void {
  for (let i = 0; i < 120; i++) {
    if (world.phase !== "showing") return;
    world.step(FRAME);
  }
  assert.equal(world.phase, "input", "十分な時間内にinputフェーズへ切り替わる");
}

test("起動直後はレベル1・満タンのライフでshowingフェーズから始まる", () => {
  const world = new SignalLanternWorld();

  assert.equal(world.level, 1);
  assert.equal(world.lives, START_LIVES);
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.phase, "showing");
  assert.equal(world.roundIndex, 0);
  assert.ok(world.currentSymbol === "dot" || world.currentSymbol === "dash");
});

test("showingフェーズはstepで一定時間経過するとinputフェーズに切り替わる", () => {
  const world = new SignalLanternWorld();
  advanceToInputPhase(world);
  assert.equal(world.phase, "input");
});

test("正しい長さでレバーを離すと得点が入り、次のコールへ進む", () => {
  const world = new SignalLanternWorld();
  const answered: number[] = [];
  world.onCallAnswered = (event) => answered.push(event.points);

  advanceToInputPhase(world);
  const target = world.currentSymbol;
  world.releaseLever(holdMsFor(target));

  assert.equal(answered.length, 1, "正解イベントが発火する");
  assert.ok(answered[0] > 0, "得点が入っている");
  assert.equal(world.score, answered[0]);
  assert.equal(world.combo, 1);
  assert.equal(world.roundIndex, 1);
  assert.equal(world.phase, "showing", "次のコールのshowingへ戻る");
  assert.equal(world.lives, START_LIVES);
});

test("コンボを継続するほど得点が高くなる", () => {
  const world = new SignalLanternWorld();
  const points: number[] = [];
  world.onCallAnswered = (event) => points.push(event.points);

  for (let i = 0; i < 3; i++) {
    advanceToInputPhase(world);
    world.releaseLever(holdMsFor(world.currentSymbol));
  }

  assert.equal(points.length, 3);
  assert.ok(points[1] > points[0], "2連続目の方が1回目より高得点");
  assert.ok(points[2] > points[1], "3連続目の方が2回目より高得点");
});

test("違う長さでレバーを離すとミスになりライフが減りコンボが切れる", () => {
  const world = new SignalLanternWorld();
  advanceToInputPhase(world);
  world.releaseLever(holdMsFor(world.currentSymbol));
  assert.equal(world.combo, 1);

  const missed: string[] = [];
  world.onCallMissed = (event) => missed.push(event.reason);

  advanceToInputPhase(world);
  world.releaseLever(wrongHoldMsFor(world.currentSymbol));

  assert.deepEqual(missed, ["wrong"]);
  assert.equal(world.combo, 0, "コンボがリセットされる");
  assert.equal(world.lives, START_LIVES - 1);
  assert.equal(world.isOver, false, "ライフが残っていればまだ続く");
  assert.equal(world.phase, "showing", "ミス後も次のコールへ進む");
});

test("応答時間内にレバーを離さないとタイムアウトでミスになる", () => {
  const world = new SignalLanternWorld();
  advanceToInputPhase(world);

  const missed: string[] = [];
  world.onCallMissed = (event) => missed.push(event.reason);

  const limit = world.inputTimeLimitSeconds;
  for (let t = 0; t < limit + 1; t += FRAME) {
    if (world.isOver || missed.length > 0) break;
    world.step(FRAME);
  }

  assert.deepEqual(missed, ["timeout"]);
  assert.equal(world.lives, START_LIVES - 1);
});

test("ライフが尽きるとゲームオーバーになり、以降の入力を無視する", () => {
  const world = new SignalLanternWorld();

  for (let i = 0; i < START_LIVES; i++) {
    advanceToInputPhase(world);
    world.releaseLever(wrongHoldMsFor(world.currentSymbol));
  }

  assert.equal(world.lives, 0);
  assert.equal(world.isOver, true);
  assert.equal(world.phase, "gameOver");

  const scoreBefore = world.score;
  const roundIndexBefore = world.roundIndex;
  world.step(FRAME);
  world.releaseLever(DOT_HOLD_MS);

  assert.equal(world.score, scoreBefore, "ゲームオーバー後は得点が変わらない");
  assert.equal(world.roundIndex, roundIndexBefore);
  assert.equal(world.lives, 0, "ライフはマイナスにならない");
});

test("レベルに必要な回数を正解し切るとレベルが上がりボーナス得点が入る", () => {
  const world = new SignalLanternWorld();
  const levelBefore = world.level;
  const cleared: number[] = [];
  world.onLevelCleared = (event) => cleared.push(event.level);

  const required = world.callsRequired;
  for (let i = 0; i < required; i++) {
    advanceToInputPhase(world);
    world.releaseLever(holdMsFor(world.currentSymbol));
  }

  assert.deepEqual(cleared, [levelBefore]);
  assert.equal(world.level, levelBefore + 1);
  assert.equal(world.roundIndex, 0, "新しいレベルの正解カウントは0から");
  assert.equal(world.lives, START_LIVES, "レベルクリアまでにライフは減っていない");
});

test("ライフが尽きたあとにreset()すると最初から遊べる", () => {
  const world = new SignalLanternWorld();
  for (let i = 0; i < START_LIVES; i++) {
    advanceToInputPhase(world);
    world.releaseLever(wrongHoldMsFor(world.currentSymbol));
  }
  assert.equal(world.isOver, true);

  world.reset();

  assert.equal(world.isOver, false);
  assert.equal(world.level, 1);
  assert.equal(world.lives, START_LIVES);
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.roundIndex, 0);
  assert.equal(world.phase, "showing");
});

test("showingフェーズ中にレバーを離しても判定されない(input中のみ有効)", () => {
  const world = new SignalLanternWorld();
  assert.equal(world.phase, "showing");

  const answered: number[] = [];
  const missed: string[] = [];
  world.onCallAnswered = (event) => answered.push(event.points);
  world.onCallMissed = (event) => missed.push(event.reason);

  world.releaseLever(DOT_HOLD_MS);

  assert.equal(answered.length, 0);
  assert.equal(missed.length, 0);
  assert.equal(world.score, 0);
});
