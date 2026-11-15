import assert from "node:assert/strict";
import { test } from "node:test";
import { SkippingStonesWorld } from "./world.ts";

const WIDTH = 960;
const HEIGHT = 540;
const FRAME = 1 / 60;
const MAX_FRAMES = 3000;

/** predicate が真になるまでフレームを進める。前提が崩れている場合は明示的に失敗させる。 */
function stepUntil(world: SkippingStonesWorld, predicate: () => boolean): void {
  for (let i = 0; i < MAX_FRAMES && !predicate(); i++) {
    world.step(FRAME);
  }
  assert.ok(predicate(), "想定した条件に到達せずタイムアウトした(テストの前提が崩れている)");
}

/** 投げて最初に着水(スキップ)する位置(x, z)を観測する。軌道は決定的なので再現できる。 */
function captureFirstSkipPoint(world: SkippingStonesWorld): { x: number; z: number } {
  let captured: { x: number; z: number } | null = null;
  world.onSkip = (event) => {
    captured ??= { x: event.x, z: event.z };
  };
  world.releaseThrow();
  stepUntil(world, () => captured !== null);
  if (!captured) throw new Error("スキップが発生しなかった");
  return captured;
}

test("起動直後はねらう状態で、石の数・スコアが初期値になっている", () => {
  const world = new SkippingStonesWorld(WIDTH, HEIGHT);

  assert.equal(world.phase, "aiming");
  assert.equal(world.isOver, false);
  assert.equal(world.score, 0);
  assert.equal(world.stonesRemaining, 8);
  assert.equal(world.skipCount, 0);
  assert.equal(world.hazards.length, 0, "最初の投げは障害物なしで安全に遊べる");
});

test("ドラッグ量からパワー・左右の狙いが更新される(範囲内にクランプされる)", () => {
  const world = new SkippingStonesWorld(WIDTH, HEIGHT);

  world.setAimFromDrag(0, 10_000);
  assert.equal(world.aimPower, 1, "大きく引くとパワーは最大でクランプされる");

  world.setAimFromDrag(0, -10_000);
  assert.ok(world.aimPower > 0, "逆方向に引いてもパワーは0にならない(最小値でクランプ)");

  world.setAimFromDrag(10_000, 100);
  assert.ok(world.aimLateral < 0, "右へ引くと逆方向(左)へ投げる狙いになる");
  assert.ok(world.aimLateral >= -1, "左右の狙いも範囲内にクランプされる");
});

test("投げると飛行状態になり石が1つ減る。飛行中に再度投げても減らない", () => {
  const world = new SkippingStonesWorld(WIDTH, HEIGHT);

  world.releaseThrow();
  assert.equal(world.phase, "flying");
  assert.equal(world.stonesRemaining, 7);

  world.releaseThrow();
  assert.equal(world.stonesRemaining, 7, "飛行中は新しい投げを受け付けない");
});

test("十分なパワーで投げると水面で跳ね、スコアが増えてやがて自然に沈む", () => {
  const world = new SkippingStonesWorld(WIDTH, HEIGHT);
  const skipPoints: number[] = [];
  world.onSkip = (event) => skipPoints.push(event.points);
  let endedReason: string | null = null;
  world.onThrowEnded = (event) => {
    endedReason = event.reason;
  };

  world.releaseThrow();
  stepUntil(world, () => world.phase === "aiming");

  assert.ok(skipPoints.length >= 3, "既定のパワーなら複数回跳ねる");
  assert.ok(world.score > 0, "跳ねるたびに得点が入る");
  assert.equal(endedReason, "slow", "障害物がない状態では速度不足で自然に終わる");
  assert.equal(world.stonesRemaining, 7);
  assert.equal(
    world.skipCount,
    skipPoints.length,
    "投げ終了後もその投げで跳ねた回数が結果として残る",
  );

  world.releaseThrow();
  assert.equal(world.skipCount, 0, "次に投げるとスキップ数は0に戻る");
});

test("障害物に当たるとその場で投げが終わり、得点が増えない", () => {
  // まず障害物なしで1回投げ、最初の着水位置(x, z)を観測する。
  const contact = captureFirstSkipPoint(new SkippingStonesWorld(WIDTH, HEIGHT));

  // 同じ条件で投げ直し、今度はその着水位置にちょうど重なる障害物を手動で配置する。
  const world = new SkippingStonesWorld(WIDTH, HEIGHT);
  const scoreBefore = world.score;
  let endedReason: string | null = null;
  world.onThrowEnded = (event) => {
    endedReason = event.reason;
  };
  let skipped = false;
  world.onSkip = () => {
    skipped = true;
  };
  world.hazards = [
    {
      id: 9001,
      zStart: contact.z - 0.3,
      zEnd: contact.z + 0.3,
      x: contact.x,
      radius: 1,
    },
  ];

  world.releaseThrow();
  stepUntil(world, () => world.phase === "aiming");

  assert.equal(skipped, false, "障害物に当たった投げはスキップしない");
  assert.equal(endedReason, "hazard");
  assert.equal(world.score, scoreBefore, "障害物に当たると得点は増えない");
});

test("ボーナスの浮き草を踏むと追加得点が入り、消費される", () => {
  const contact = captureFirstSkipPoint(new SkippingStonesWorld(WIDTH, HEIGHT));

  const world = new SkippingStonesWorld(WIDTH, HEIGHT);
  world.bonusPads = [
    {
      id: 9002,
      zStart: contact.z - 0.3,
      zEnd: contact.z + 0.3,
      x: contact.x,
      radius: 1,
    },
  ];
  let bonusPoints = 0;
  world.onBonus = (event) => {
    bonusPoints = event.points;
  };
  let skipPoints = 0;
  world.onSkip = (event) => {
    skipPoints = event.points;
  };

  world.releaseThrow();
  stepUntil(world, () => skipPoints > 0);

  assert.ok(bonusPoints > 0, "ボーナスパッドの上で跳ねると追加得点が入る");
  assert.equal(world.score, skipPoints + bonusPoints);
  assert.equal(world.bonusPads.length, 0, "踏んだボーナスは消費される");
});

test("着水直前にフリックすると、完璧なはじき判定になりボーナス得点が入る", () => {
  const withoutFlick = new SkippingStonesWorld(WIDTH, HEIGHT);
  let pointsWithoutFlick = 0;
  withoutFlick.onSkip = (event) => {
    pointsWithoutFlick = event.points;
  };
  withoutFlick.releaseThrow();
  stepUntil(withoutFlick, () => pointsWithoutFlick > 0);

  const withFlick = new SkippingStonesWorld(WIDTH, HEIGHT);
  let pointsWithFlick = 0;
  let flickTier = "none";
  withFlick.onSkip = (event) => {
    pointsWithFlick = event.points;
    flickTier = event.flickTier;
  };
  withFlick.releaseThrow();
  stepUntil(withFlick, () => {
    const eta = withFlick.timeToNextContact;
    if (eta !== null && eta <= 0.05) withFlick.requestFlick();
    return pointsWithFlick > 0;
  });

  assert.equal(flickTier, "perfect", "着水直前のタップは完璧なはじき判定になる");
  assert.ok(pointsWithFlick > pointsWithoutFlick, "完璧なはじきはボーナス得点が乗る");
});

test("石を使い切るとゲームオーバーになり、リセットで最初から遊べる", () => {
  const world = new SkippingStonesWorld(WIDTH, HEIGHT);

  for (let i = 0; i < 8; i++) {
    world.releaseThrow();
    stepUntil(world, () => world.phase === "aiming" || world.isOver);
  }

  assert.equal(world.isOver, true);
  assert.equal(world.stonesRemaining, 0);

  world.reset();
  assert.equal(world.isOver, false);
  assert.equal(world.stonesRemaining, 8);
  assert.equal(world.score, 0);
  assert.equal(world.phase, "aiming");
});

test("飛行中は左右の連続入力やドラッグ目標で石を操作できる", () => {
  const world = new SkippingStonesWorld(WIDTH, HEIGHT);
  world.releaseThrow();

  world.setSteeringInput(1);
  for (let i = 0; i < 10; i++) world.step(FRAME);
  assert.ok(world.x > 0, "右入力を続けると右へ動く");

  world.setSteerTarget(-5);
  for (let i = 0; i < 60; i++) world.step(FRAME);
  assert.ok(world.x < 0, "ドラッグ目標を設定すると、そちらへ寄っていく");
});

test("画面サイズが変わるとドラッグ感度(パワーへの変換)も追従する", () => {
  const world = new SkippingStonesWorld(WIDTH, HEIGHT);
  world.setAimFromDrag(0, 50);
  const powerAtLargeScreen = world.aimPower;

  world.resize(200, 150);
  world.setAimFromDrag(0, 50);
  const powerAtSmallScreen = world.aimPower;

  assert.ok(
    powerAtSmallScreen > powerAtLargeScreen,
    "画面が小さいほど同じドラッグ量でもパワーが大きく出る",
  );

  // 不正なサイズは無視される
  world.resize(-1, -1);
  assert.ok(world.width > 0 && world.height > 0);
});
