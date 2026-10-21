import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GOOD_WINDOW_SECONDS,
  generateChart,
  type NoteType,
  START_LIVES,
  TaikoPulseWorld,
} from "./world.ts";

/** 現在の対象音符の判定時刻ちょうどまで時間を進める(PERFECT判定を狙うため)。 */
function advanceToCurrentNoteTime(world: TaikoPulseWorld): void {
  const note = world.currentNote;
  assert.ok(note, "対象音符が存在する");
  if (!note) return;
  const delta = note.time - world.elapsed;
  if (delta > 0) world.step(delta);
}

function oppositeType(type: NoteType): NoteType {
  return type === "don" ? "katsu" : "don";
}

test("起動直後はステージ1・満タンのライフで譜面が組まれている", () => {
  const world = new TaikoPulseWorld();

  assert.equal(world.stage, 1);
  assert.equal(world.lives, START_LIVES);
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.noteIndex, 0);
  assert.ok(world.chart.length > 0, "譜面に音符がある");
  assert.ok(world.currentNote !== null);
});

test("ちょうどの瞬間に正しいボタンを叩くとPERFECT判定で得点とコンボが増える", () => {
  const world = new TaikoPulseWorld();
  const judged: { judgement: string; points: number }[] = [];
  world.onNoteJudged = (event) => judged.push(event);

  const type = world.currentNote?.type;
  assert.ok(type);
  if (!type) return;
  advanceToCurrentNoteTime(world);
  world.hit(type);

  assert.equal(judged.length, 1);
  assert.equal(judged[0].judgement, "perfect");
  assert.ok(judged[0].points > 0);
  assert.equal(world.score, judged[0].points);
  assert.equal(world.combo, 1);
  assert.equal(world.noteIndex, 1);
  assert.equal(world.lives, START_LIVES, "正解してもライフは減らない");
});

test("連続で正解するほどコンボボーナスにより得点が高くなる", () => {
  const world = new TaikoPulseWorld();
  const points: number[] = [];
  world.onNoteJudged = (event) => points.push(event.points);

  for (let i = 0; i < 3; i++) {
    const type = world.currentNote?.type;
    assert.ok(type);
    if (!type) return;
    advanceToCurrentNoteTime(world);
    world.hit(type);
  }

  assert.equal(points.length, 3);
  assert.ok(points[1] > points[0], "2連続目の方が1回目より高得点");
  assert.ok(points[2] > points[1], "3連続目の方が2回目より高得点");
});

test("違うボタンを叩くとミスになりライフが減りコンボがリセットされる", () => {
  const world = new TaikoPulseWorld();
  const type = world.currentNote?.type;
  assert.ok(type);
  if (!type) return;
  advanceToCurrentNoteTime(world);
  world.hit(type);
  assert.equal(world.combo, 1);

  const missed: string[] = [];
  world.onNoteMissed = (event) => missed.push(event.reason);

  const nextType = world.currentNote?.type;
  assert.ok(nextType);
  if (!nextType) return;
  advanceToCurrentNoteTime(world);
  world.hit(oppositeType(nextType));

  assert.deepEqual(missed, ["wrong"]);
  assert.equal(world.combo, 0);
  assert.equal(world.lives, START_LIVES - 1);
  assert.equal(world.noteIndex, 2);
});

test("ボタンは正しくてもタイミングが窓を超えるほどずれているとミスになる", () => {
  const world = new TaikoPulseWorld();
  const type = world.currentNote?.type;
  assert.ok(type);
  if (!type) return;

  const missed: string[] = [];
  world.onNoteMissed = (event) => missed.push(event.reason);

  // 判定窓よりはっきり早いタイミングで叩く(窓そのものは越えないよう step はしない)。
  world.hit(type);

  assert.deepEqual(missed, ["timing"]);
  assert.equal(world.lives, START_LIVES - 1);
});

test("何も押さずに判定窓を過ぎるとタイムアウトでミスになる", () => {
  const world = new TaikoPulseWorld();
  const note = world.currentNote;
  assert.ok(note);
  if (!note) return;

  const missed: string[] = [];
  world.onNoteMissed = (event) => missed.push(event.reason);

  world.step(note.time - world.elapsed + GOOD_WINDOW_SECONDS + 0.01);

  assert.deepEqual(missed, ["timeout"]);
  assert.equal(world.lives, START_LIVES - 1);
  assert.equal(world.noteIndex, 1);
});

test("ステージの音符をすべて捌き切ると次のステージへ進みボーナス得点が入る", () => {
  const world = new TaikoPulseWorld();
  const cleared: { stage: number; bonus: number }[] = [];
  world.onStageCleared = (event) => cleared.push(event);

  const noteCount = world.chart.length;
  for (let i = 0; i < noteCount; i++) {
    const type = world.currentNote?.type;
    assert.ok(type, `${i}番目の音符が存在する`);
    if (!type) return;
    advanceToCurrentNoteTime(world);
    world.hit(type);
  }

  assert.equal(cleared.length, 1);
  assert.equal(cleared[0].stage, 1);
  assert.ok(cleared[0].bonus > 0);
  assert.equal(world.stage, 2);
  assert.equal(world.noteIndex, 0);
  assert.ok(world.chart.length > 0, "次のステージの譜面が組まれている");
  assert.equal(world.lives, START_LIVES, "ミスなく捌き切ればライフは減らない");
});

test("ライフが尽きるとゲームオーバーになり、以降の操作を無視する", () => {
  const world = new TaikoPulseWorld();

  for (let i = 0; i < START_LIVES; i++) {
    const type = world.currentNote?.type;
    assert.ok(type);
    if (!type) return;
    advanceToCurrentNoteTime(world);
    world.hit(oppositeType(type));
    if (world.isOver) break;
  }

  assert.equal(world.lives, 0);
  assert.equal(world.isOver, true);

  const scoreBefore = world.score;
  const noteIndexBefore = world.noteIndex;
  world.step(1);
  world.hit("don");
  world.hit("katsu");

  assert.equal(world.score, scoreBefore, "ゲームオーバー後は得点が変わらない");
  assert.equal(world.noteIndex, noteIndexBefore, "ゲームオーバー後は譜面が進まない");
  assert.equal(world.lives, 0, "ライフはマイナスにならない");
});

test("ライフが尽きたあとにreset()すると最初から遊べる", () => {
  const world = new TaikoPulseWorld();
  for (let i = 0; i < START_LIVES; i++) {
    const type = world.currentNote?.type;
    assert.ok(type);
    if (!type) return;
    advanceToCurrentNoteTime(world);
    world.hit(oppositeType(type));
    if (world.isOver) break;
  }
  assert.equal(world.isOver, true);

  world.reset();

  assert.equal(world.isOver, false);
  assert.equal(world.stage, 1);
  assert.equal(world.lives, START_LIVES);
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.noteIndex, 0);
});

test("getVisibleNotes は先読み秒数の範囲内にある未判定の音符だけを時間順に返す", () => {
  const world = new TaikoPulseWorld();
  const note = world.currentNote;
  assert.ok(note);
  if (!note) return;
  // 最初の音符が先読み秒数の範囲に入るところまで時間を進める。
  world.step(Math.max(0, note.time - world.elapsed - 0.5));
  const visible = world.getVisibleNotes();

  assert.ok(visible.length > 0);
  for (let i = 1; i < visible.length; i++) {
    assert.ok(visible[i].time >= visible[i - 1].time, "時間順に並んでいる");
  }
  for (const note of visible) {
    assert.ok(note.secondsUntilHit <= 1.6 + 1e-9);
  }
});

test("generateChart はステージが進むほど音符数が増え、間隔が詰まっていく", () => {
  const earlyChart = generateChart(1);
  const laterChart = generateChart(8);

  assert.ok(laterChart.length > earlyChart.length, "ステージが進むと音符数が増える");

  const earlyAverageInterval =
    (earlyChart[earlyChart.length - 1].time - earlyChart[0].time) / (earlyChart.length - 1);
  const laterAverageInterval =
    (laterChart[laterChart.length - 1].time - laterChart[0].time) / (laterChart.length - 1);
  assert.ok(
    laterAverageInterval < earlyAverageInterval,
    "ステージが進むとテンポが上がり音符の平均間隔が狭くなる",
  );

  for (const note of earlyChart) {
    assert.ok(note.type === "don" || note.type === "katsu");
  }
});
