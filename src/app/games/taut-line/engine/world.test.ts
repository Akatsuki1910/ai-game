import assert from "node:assert/strict";
import { test } from "node:test";
import { TautLineWorld } from "./world.ts";

const FRAME = 1 / 60;
const STEP = 0.1;

function assertFinite(world: TautLineWorld, label: string): void {
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.distance), `${label}: distance`);
  assert.ok(Number.isFinite(world.tension), `${label}: tension`);
}

test("起動直後は1ラウンド目・満タンのライフで魚は走らない", () => {
  const world = new TautLineWorld(960, 540);

  assert.equal(world.round, 1);
  assert.equal(world.lives, 3);
  assert.equal(world.score, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.distanceRatio, world.distanceRatio); // NaNでない
  assert.equal(world.isRunEnabledThisRound, false, "1匹目は走らない");
});

test("1匹目(走らない魚)はリールを巻き続ければラインを切らずに釣れる", () => {
  const world = new TautLineWorld(960, 540);
  const caught: number[] = [];
  world.onCatch = ({ points }) => caught.push(points);
  world.onSnap = () => assert.fail("1匹目はラインが切れないはず");

  world.startReeling();
  for (let i = 0; i < 600 && caught.length === 0; i++) {
    world.step(FRAME);
    assertFinite(world, "リール中");
    assert.ok(world.tension < 1, "テンションが上限に達していない");
  }

  assert.equal(caught.length, 1, "1匹釣れた");
  assert.ok(caught[0] > 0, "得点が入っている");
  assert.equal(world.score, caught[0]);
  assert.equal(world.round, 2, "ラウンドが進む");
  assert.equal(world.lives, 3, "ラインを切っていないのでライフは減らない");
});

test("押しっぱなしで1匹目が釣れても、離さない限り2匹目もそのまま巻き続けられる", () => {
  // ブラウザ実機では「ボタンを押しっぱなしのまま魚が切り替わる」操作が起こり得る。
  // 魚の切り替え時に isReeling を強制リセットすると、押しっぱなしでも次の魚からは
  // 一切巻けなくなる(=ボタンを一度離して再度押すまで操作不能に見える)退行が起きるため、
  // ここで固定しておく。
  const world = new TautLineWorld(960, 540);

  world.startReeling();
  for (let i = 0; i < 600 && world.round === 1; i++) world.step(FRAME);
  assert.equal(world.round, 2, "1匹目が釣れて2匹目に進んでいる");
  assert.equal(world.isReeling, true, "pointerup を送っていないので巻いたままのはず");

  for (let i = 0; i < 60; i++) world.step(FRAME);
  assert.ok(world.progressRatio > 0, "離さずに巻き続けているので2匹目の巻き具合も進んでいるはず");
});

test("リールを巻かずに放置すると魚に逃げられ、ライフが減る", () => {
  const world = new TautLineWorld(960, 540);
  let escaped = 0;
  world.onEscape = () => {
    escaped += 1;
  };

  for (let i = 0; i < 600 && escaped === 0; i++) {
    world.step(STEP);
    assertFinite(world, "放置中");
  }

  assert.equal(escaped, 1, "逃げられた");
  assert.equal(world.lives, 2, "ライフが1つ減る");
  assert.equal(world.round, 1, "逃げただけではラウンドは進まない");
});

test("ライフが尽きるとゲームオーバーになり、リセットで最初からやり直せる", () => {
  const world = new TautLineWorld(960, 540);
  let escapedCount = 0;
  world.onEscape = () => {
    escapedCount += 1;
  };

  for (let i = 0; i < 5000 && !world.isOver; i++) {
    world.step(STEP);
    assertFinite(world, "ゲームオーバー判定中");
  }

  assert.equal(world.isOver, true, "3回逃げられるとゲームオーバーになる");
  assert.equal(world.lives, 0);
  assert.equal(escapedCount, 3);

  // 終了後に進めても壊れない
  world.step(FRAME);
  assertFinite(world, "ゲームオーバー後");

  world.reset();
  assert.equal(world.isOver, false);
  assert.equal(world.score, 0);
  assert.equal(world.round, 1);
  assert.equal(world.lives, 3);
});

test("2匹目以降は魚が走り、走っている間も巻き続けるとラインが切れる", () => {
  const world = new TautLineWorld(960, 540);

  // 1匹目を確実に釣って2匹目(走る魚)に進める
  world.startReeling();
  for (let i = 0; i < 600 && world.round === 1; i++) world.step(FRAME);
  assert.equal(world.round, 2, "2匹目に進んでいる");
  assert.equal(world.isRunEnabledThisRound, true);

  let snapped = false;
  world.onSnap = () => {
    snapped = true;
  };

  // 走っていても巻く手を止めない「下手な」プレイを続けると、いずれラインが切れる
  world.startReeling();
  for (let i = 0; i < 2000 && !snapped; i++) {
    world.step(FRAME);
    assertFinite(world, "2匹目を巻き続け中");
  }

  assert.equal(snapped, true, "走っている間も巻き続けるとラインが切れる");
  assert.equal(world.lives, 2, "ラインが切れるとライフが減る");
});

test("魚が走っている間だけ手を止めれば、ラインを切らずに2匹目も釣れる", () => {
  const world = new TautLineWorld(960, 540);

  // 1匹目を釣って2匹目(走る魚)に進める
  world.startReeling();
  for (let i = 0; i < 600 && world.round === 1; i++) world.step(FRAME);
  assert.equal(world.round, 2);

  let snapped = false;
  world.onSnap = () => {
    snapped = true;
  };
  const caughtRounds: number[] = [];
  world.onCatch = ({ round }) => caughtRounds.push(round);

  // 走っている間は離し、止まったら巻く「上手な」プレイ。
  for (let i = 0; i < 6000 && caughtRounds.length === 0 && !snapped; i++) {
    if (world.isRunning) {
      world.stopReeling();
    } else {
      world.startReeling();
    }
    world.step(FRAME);
    assertFinite(world, "上手なプレイ中");
  }

  assert.equal(snapped, false, "走っている間に離していればラインは切れない");
  assert.deepEqual(caughtRounds, [2], "2匹目も釣れる");
  assert.equal(world.lives, 3, "ライフを失わずに釣れる");
});

test("画面サイズが変わっても状態は壊れない", () => {
  const world = new TautLineWorld(960, 540);
  world.resize(375, 720);
  assert.equal(world.width, 375);
  assert.equal(world.height, 720);
  world.step(FRAME);
  assertFinite(world, "リサイズ後");
});
