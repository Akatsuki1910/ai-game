import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ESCAPE_GRACE_SECONDS,
  HEALTH_MAX,
  STEM_COUNT,
  type StemBrokenEvent,
  type StemPrunedEvent,
  TopiaryTrimWorld,
} from "./world.ts";

const WIDTH = 960;
const HEIGHT = 540;
const FRAME = 1 / 60;

function assertFinite(world: TopiaryTrimWorld, label: string): void {
  assert.ok(Number.isFinite(world.health), `${label}: health`);
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.coverageRatio), `${label}: coverageRatio`);
  for (const stem of world.stems) {
    assert.ok(Number.isFinite(stem.length), `${label}: stem.length`);
  }
}

test("起動直後は枝が16本、未成長でHUDが揃っている", () => {
  const world = new TopiaryTrimWorld(WIDTH, HEIGHT);

  assert.equal(world.stems.length, STEM_COUNT);
  assert.ok(world.stems.every((stem) => stem.length === 0));
  assert.equal(world.coverageRatio, 0);
  assert.equal(world.health, HEALTH_MAX);
  assert.equal(world.score, 0);
  assert.equal(world.prunes, 0);
  assert.equal(world.isOver, false);
});

test("放置していると枝が育ち、充填率とスコアが増えていく", () => {
  const world = new TopiaryTrimWorld(WIDTH, HEIGHT);

  for (let i = 0; i < 60; i++) world.step(FRAME);

  assert.ok(world.coverageRatio > 0, "枝が育って充填率が上がる");
  assert.ok(world.score > 0, "充填率に応じてスコアが入る");
  assertFinite(world, "放置1秒後");
});

test("はみ出した枝をその位置(ピクセル座標)で剪定すると刈り戻され、得点とカウントが増える", () => {
  const world = new TopiaryTrimWorld(WIDTH, HEIGHT);
  let pruned: StemPrunedEvent | null = null;
  world.onStemPruned = (event) => {
    pruned = event;
  };

  // 境界(length=1)をわずかに超えるまで、全ての枝を同時に育てる。
  for (let i = 0; i < 6000 && world.getMostEscapedStem() === null; i++) world.step(FRAME);
  const escaped = world.getMostEscapedStem();
  assert.ok(escaped, "十分な時間が経てばはみ出す枝が現れる");
  if (!escaped) return;

  const scoreBefore = world.score;
  const prunesBefore = world.prunes;
  const tip = world.getStemTipPx(escaped);
  const didPrune = world.pruneAtPointPx(tip.x, tip.y);

  assert.equal(didPrune, true, "はみ出した枝の位置をクリックすると剪定できる");
  assert.ok(escaped.length <= 1, "剪定後は境界の内側まで刈り戻される");
  assert.ok(world.score > scoreBefore, "剪定ボーナスが加算される");
  assert.equal(world.prunes, prunesBefore + 1);
  assert.ok(pruned !== null, "剪定イベントが発火する");
});

test("まだはみ出していない枝を剪定しようとしても何も起きない", () => {
  const world = new TopiaryTrimWorld(WIDTH, HEIGHT);
  const stem = world.stems[0];
  const tip = world.getStemTipPx(stem);

  const didPrune = world.pruneAtPointPx(tip.x, tip.y);

  assert.equal(didPrune, false, "境界に達していない枝は剪定できない");
  assert.equal(world.prunes, 0);
});

test("はみ出した枝をESCAPE_GRACE_SECONDS秒放置すると折れて体力が減り、長さ0から生え直す", () => {
  const world = new TopiaryTrimWorld(WIDTH, HEIGHT);
  let broken: StemBrokenEvent | null = null;
  world.onStemBroken = (event) => {
    broken = event;
  };
  const healthBefore = world.health;

  for (let i = 0; i < 6000 && world.health === healthBefore; i++) world.step(FRAME);

  assert.ok(world.health < healthBefore, "枝が折れると体力が減る");
  assert.ok(broken !== null, "破断イベントが発火する");
  const brokenAngle = (broken as StemBrokenEvent).angle;
  const brokenStem = world.stems.find((stem) => stem.angle === brokenAngle);
  assert.ok(brokenStem, "破断イベントの角度に対応する枝が見つかる");
  assert.equal(brokenStem?.length, 0, "折れた枝は長さ0から生え直す");
  assert.equal(brokenStem?.secondsSinceEscaped, 0, "折れた枝のはみ出しタイマーもリセットされる");
  assertFinite(world, "破断後");
});

test("境界内に戻ると、はみ出しタイマーはリセットされる", () => {
  const world = new TopiaryTrimWorld(WIDTH, HEIGHT);
  for (let i = 0; i < 6000 && world.getMostEscapedStem() === null; i++) world.step(FRAME);
  const escaped = world.getMostEscapedStem();
  assert.ok(escaped);
  if (!escaped) return;

  world.step(FRAME);
  assert.ok(escaped.secondsSinceEscaped > 0, "はみ出している間はタイマーが進む");

  const tip = world.getStemTipPx(escaped);
  world.pruneAtPointPx(tip.x, tip.y);
  assert.equal(escaped.secondsSinceEscaped, 0, "剪定するとタイマーがリセットされる");
});

test(`ESCAPE_GRACE_SECONDS(${ESCAPE_GRACE_SECONDS}秒)未満の一時的なはみ出しでは折れない`, () => {
  const world = new TopiaryTrimWorld(WIDTH, HEIGHT);
  for (let i = 0; i < 6000 && world.getMostEscapedStem() === null; i++) world.step(FRAME);
  const escaped = world.getMostEscapedStem();
  assert.ok(escaped);
  if (!escaped) return;

  const healthBefore = world.health;
  world.step(ESCAPE_GRACE_SECONDS * 0.5);

  assert.equal(world.health, healthBefore, "猶予時間内であれば体力は減らない");
});

test("体力が尽きると終了し、終了後は状態が変化しない", () => {
  const world = new TopiaryTrimWorld(WIDTH, HEIGHT);

  for (let i = 0; i < 20000 && !world.isOver; i++) world.step(FRAME);

  assert.equal(world.isOver, true, "体力が尽きると終了する");
  assert.equal(world.health, 0);

  const scoreAtOver = world.score;
  const coverageAtOver = world.coverageRatio;
  world.step(FRAME);
  assert.equal(world.score, scoreAtOver, "終了後はスコアが変化しない");
  assert.equal(world.coverageRatio, coverageAtOver, "終了後は充填率も変化しない");
  assert.equal(world.pruneAtAngle(0), false, "終了後は剪定もできない");
});

test("リセットすると最初からやり直せる", () => {
  const world = new TopiaryTrimWorld(WIDTH, HEIGHT);
  for (let i = 0; i < 20000 && !world.isOver; i++) world.step(FRAME);
  assert.equal(world.isOver, true);

  world.reset();

  assert.equal(world.isOver, false);
  assert.equal(world.health, HEALTH_MAX);
  assert.equal(world.score, 0);
  assert.equal(world.prunes, 0);
  assert.ok(world.stems.every((stem) => stem.length === 0));
});

test("シアーの回転入力で角度が連続的に変わる", () => {
  const world = new TopiaryTrimWorld(WIDTH, HEIGHT);
  const startAngle = world.shearsAngle;

  world.setShearsRotationInput(1);
  world.step(FRAME);
  assert.notEqual(world.shearsAngle, startAngle, "右回転で角度が変わる");

  const angleAfterRight = world.shearsAngle;
  world.setShearsRotationInput(0);
  world.step(FRAME);
  assert.equal(world.shearsAngle, angleAfterRight, "入力0では角度が変わらない");

  world.setShearsRotationInput(-1);
  world.step(FRAME);
  assert.notEqual(world.shearsAngle, angleAfterRight, "左回転で角度が変わる");
});

test("シアーの角度をはみ出した枝に重ねると剪定できる", () => {
  const world = new TopiaryTrimWorld(WIDTH, HEIGHT);
  for (let i = 0; i < 6000 && world.getMostEscapedStem() === null; i++) world.step(FRAME);
  const escaped = world.getMostEscapedStem();
  assert.ok(escaped, "十分な時間が経てばはみ出す枝が現れる");
  if (!escaped) return;

  world.shearsAngle = escaped.angle;
  const didPrune = world.pruneAtShears();

  assert.equal(didPrune, true, "シアーを重ねてから剪定すると成功する");
});

test("画面サイズが変わっても座標が破綻しない。不正なサイズは無視される", () => {
  const world = new TopiaryTrimWorld(WIDTH, HEIGHT);
  for (let i = 0; i < 60; i++) world.step(FRAME);

  world.resize(375, 720);
  assertFinite(world, "リサイズ後");
  for (const stem of world.stems) {
    const tip = world.getStemTipPx(stem);
    assert.ok(Number.isFinite(tip.x) && Number.isFinite(tip.y));
  }
  assert.ok(world.getBoundaryRadiusPx() > 0);

  world.resize(0, 0);
  assert.equal(world.width, 375);
  assert.equal(world.height, 720);
});
