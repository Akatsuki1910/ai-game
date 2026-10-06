import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FISH_SPECIES,
  INITIAL_DISTANCE,
  LINES_MAX,
  type LossReason,
  MAX_DISTANCE,
  SPECIES_SCORE_MULTIPLIER,
  TautLineWorld,
} from "./world.ts";

const FRAME = 1 / 60;

/** calm中に何度か巻いて、今の魚をちょうど1匹だけ釣り上げる(comboの増加を検知したら止める)。 */
function catchCurrentFish(world: TautLineWorld): void {
  const comboBefore = world.combo;
  for (let i = 0; i < 20 && world.combo === comboBefore && !world.isOver; i++) {
    world.reel(0.5);
  }
}

/** 小さいフレーム刻みでstepし、run状態に切り替わるまで進める(大きな1stepだと逃走が先に起きてしまう)。 */
function advanceUntilRunning(world: TautLineWorld): void {
  for (let i = 0; i < 400 && !world.isRunning && !world.isOver; i++) {
    world.step(FRAME);
  }
  assert.equal(world.isRunning, true, "calmの持続時間を過ぎるとrunに切り替わる");
}

test("初期状態は魚がcalmで待機しており、スコア0・ライン満タン", () => {
  const world = new TautLineWorld();

  assert.equal(world.distance, INITIAL_DISTANCE);
  assert.equal(world.tension, 0);
  assert.equal(world.isRunning, false);
  assert.ok(FISH_SPECIES.includes(world.species));
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.lines, LINES_MAX);
  assert.equal(world.isOver, false);
});

test("calm中は時間経過でゆっくり距離が伸びる(魚がのんびり泳ぐ)", () => {
  const world = new TautLineWorld();
  world.step(FRAME);
  assert.ok(world.distance > INITIAL_DISTANCE, "calm中も距離はわずかに伸びる");
  assert.ok(world.distance < INITIAL_DISTANCE + 0.01, "calm中の伸びはごく小さい");
});

test("一定時間でrun状態に切り替わり、距離が速く伸びるようになる", () => {
  const world = new TautLineWorld();
  advanceUntilRunning(world);
  const distanceAtRunStart = world.distance;

  world.step(FRAME);

  assert.ok(world.distance > distanceAtRunStart, "runでは魚が強く引いて距離が速く伸びる");
});

test("reel()で距離が縮みテンションが上がる", () => {
  const world = new TautLineWorld();
  const distanceBefore = world.distance;

  world.reel(0.3);

  assert.ok(world.distance < distanceBefore, "巻くと距離が縮む");
  assert.ok(world.tension > 0, "巻くとテンションが上がる");
});

test("力0以下のreel()は何も変化させない", () => {
  const world = new TautLineWorld();
  const before = { distance: world.distance, tension: world.tension };

  world.reel(0);
  world.reel(-1);

  assert.deepEqual({ distance: world.distance, tension: world.tension }, before);
});

test("十分に巻き切るとキャッチ成立し、スコアとコンボが増えて次の魚に切り替わる", () => {
  const world = new TautLineWorld();
  let caughtPoints: number | undefined;
  world.onCatch = (event) => {
    caughtPoints = event.points;
  };

  catchCurrentFish(world);

  assert.notEqual(caughtPoints, undefined, "onCatchが発火する");
  assert.equal(world.score, caughtPoints);
  assert.equal(world.combo, 1);
  assert.equal(world.lines, LINES_MAX, "キャッチではラインは減らない");
  assert.equal(world.distance, INITIAL_DISTANCE, "次の魚は初期距離から始まる");
  assert.equal(world.tension, 0, "次の魚はテンション0から始まる");
  assert.equal(world.isRunning, false, "次の魚はcalmから始まる");
});

test("連続でキャッチするとコンボボーナスが加点に乗る", () => {
  const world = new TautLineWorld();

  // 魚種によって得点倍率が異なる(SPECIES_SCORE_MULTIPLIER)ため、乱数で選ばれた魚種を
  // 都度読み取り、コンボボーナスを含む想定点を計算してから比較する。
  const firstSpecies = world.species;
  catchCurrentFish(world);
  const expectedFirstPoints = Math.round(100 * SPECIES_SCORE_MULTIPLIER[firstSpecies]);
  assert.equal(world.score, expectedFirstPoints, "1匹目はコンボ無しの基本点");

  const secondSpecies = world.species;
  catchCurrentFish(world);
  const expectedSecondPoints = Math.round((100 + 1 * 20) * SPECIES_SCORE_MULTIPLIER[secondSpecies]);

  assert.equal(world.combo, 2);
  assert.equal(
    world.score,
    expectedFirstPoints + expectedSecondPoints,
    "2匹目はコンボ1本分のボーナスを含む",
  );
});

test("run中に強く巻くとテンションが跳ね上がりラインが切れる(snapped)", () => {
  const world = new TautLineWorld();
  advanceUntilRunning(world);

  let lossReason: LossReason | undefined;
  world.onLoss = (event) => {
    lossReason = event.reason;
  };

  for (let i = 0; i < 20 && world.lines === LINES_MAX; i++) {
    world.reel(1);
  }

  assert.equal(lossReason, "snapped", "onLossがsnappedで発火する");
  assert.equal(world.lines, LINES_MAX - 1);
  assert.equal(world.combo, 0, "ラインが切れるとコンボはリセットされる");
});

test("何もせず放置すると距離が限界に達して魚に逃げられる(escaped)", () => {
  const world = new TautLineWorld();
  let lossReason: LossReason | undefined;
  world.onLoss = (event) => {
    lossReason = event.reason;
  };

  world.step(200);

  assert.equal(lossReason, "escaped", "onLossがescapedで発火する");
  assert.equal(world.lines, LINES_MAX - 1);
  assert.ok(world.distance <= MAX_DISTANCE, "距離はMAX_DISTANCEでクランプされる");
});

test("ラインが0になるとゲームオーバーになり、以降は状態が変化しない", () => {
  const world = new TautLineWorld();

  for (let i = 0; i < LINES_MAX; i++) {
    world.step(200); // 放置して必ず逃げられる(escaped)
  }

  assert.equal(world.isOver, true);
  assert.equal(world.lines, 0);

  const distanceBefore = world.distance;
  const tensionBefore = world.tension;
  world.step(5);
  world.reel(1);

  assert.equal(world.distance, distanceBefore, "ゲームオーバー後はstep/reelで距離が変化しない");
  assert.equal(world.tension, tensionBefore, "ゲームオーバー後はstep/reelでテンションが変化しない");
});

test("reset()で最初の状態に戻る", () => {
  const world = new TautLineWorld();
  catchCurrentFish(world);
  world.step(200);

  world.reset();

  assert.equal(world.distance, INITIAL_DISTANCE);
  assert.equal(world.tension, 0);
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.equal(world.lines, LINES_MAX);
  assert.equal(world.isOver, false);
});

test("釣果が増えるほど難易度が上がる(run時の引く速さが上昇・run持続時間は短縮)", () => {
  const world = new TautLineWorld();
  const initialRunPullSpeed = world.runPullSpeed;
  const initialRunDuration = world.runDuration;

  for (let i = 0; i < 8 && !world.isOver; i++) {
    catchCurrentFish(world);
  }

  assert.ok(world.runPullSpeed >= initialRunPullSpeed, "runで引く速さが上がる(上限あり)");
  assert.ok(world.runDuration <= initialRunDuration, "runの持続時間が短くなる(下限あり)");
});
