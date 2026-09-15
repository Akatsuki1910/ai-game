import assert from "node:assert/strict";
import { test } from "node:test";
import { JACK_COLORS, LIVES_MAX, SwitchboardWorld } from "./world.ts";

function liveIndex(world: SwitchboardWorld): number {
  const jack = world.sourceJacks.find((j) => j.state === "live");
  assert.ok(jack, "live状態のジャックが存在する");
  return jack?.index ?? -1;
}

function correctDestinationIndex(world: SwitchboardWorld, sourceIndex: number): number {
  const color = world.sourceJacks[sourceIndex].color;
  const destination = world.destinationJacks.find((d) => d.color === color);
  assert.ok(destination, "対応する受信ジャックが存在する");
  return destination?.index ?? -1;
}

function wrongDestinationIndex(world: SwitchboardWorld, sourceIndex: number): number {
  const correct = correctDestinationIndex(world, sourceIndex);
  const wrong = world.destinationJacks.find((d) => d.index !== correct);
  assert.ok(wrong, "不一致の受信ジャックが存在する");
  return wrong?.index ?? -1;
}

test("起動直後は発信側が固定順・受信側がシャッフルされた配色になっている", () => {
  const world = new SwitchboardWorld();

  assert.equal(world.sourceJacks.length, JACK_COLORS.length);
  assert.equal(world.destinationJacks.length, JACK_COLORS.length);
  assert.deepEqual(
    world.sourceJacks.map((jack) => jack.color),
    [...JACK_COLORS],
    "発信側の色順は常に固定",
  );
  assert.deepEqual(
    [...world.destinationJacks.map((jack) => jack.color)].sort(),
    [...JACK_COLORS].sort(),
    "受信側は同じ色の集合を持つ(順序はシャッフル)",
  );
  assert.ok(
    world.sourceJacks.every((jack) => jack.state === "idle"),
    "開始時は全て待機中",
  );
  assert.equal(world.score, 0);
  assert.equal(world.lives, LIVES_MAX);
  assert.equal(world.isOver, false);
});

test("時間経過で発信ジャックが点灯する", () => {
  const world = new SwitchboardWorld();

  world.step(1 / 60);
  const liveCount = world.sourceJacks.filter((jack) => jack.state === "live").length;
  assert.equal(liveCount, 1, "初期の同時点灯数は1つ");
});

test("正しい色の受信ジャックに繋ぐとスコアが増え、冷却を経て待機に戻る", () => {
  const world = new SwitchboardWorld();
  world.step(1 / 60);
  const sourceIndex = liveIndex(world);
  const destinationIndex = correctDestinationIndex(world, sourceIndex);

  const result = world.attemptConnect(sourceIndex, destinationIndex);

  assert.equal(result, "correct");
  assert.equal(world.score, 100);
  assert.equal(world.lives, LIVES_MAX, "正解ではライフは減らない");
  assert.equal(world.sourceJacks[sourceIndex].state, "cooldown");

  // 冷却(0.35秒)だけ経過させる。出現間隔(spawnInterval)まで進めると同じ
  // step内で再点灯し得るため、そこには届かない幅で止める。
  world.step(0.4);
  assert.equal(world.sourceJacks[sourceIndex].state, "idle", "冷却後は待機に戻る");
});

test("間違った色の受信ジャックに繋ぐとライフが減る", () => {
  const world = new SwitchboardWorld();
  world.step(1 / 60);
  const sourceIndex = liveIndex(world);
  const destinationIndex = wrongDestinationIndex(world, sourceIndex);

  const result = world.attemptConnect(sourceIndex, destinationIndex);

  assert.equal(result, "wrong");
  assert.equal(world.score, 0);
  assert.equal(world.lives, LIVES_MAX - 1);
  assert.equal(world.sourceJacks[sourceIndex].state, "cooldown");
});

test("待機中/冷却中のジャックや範囲外indexへの接続は無効で状態を変えない", () => {
  const world = new SwitchboardWorld();

  assert.equal(world.attemptConnect(0, 0), "invalid", "点灯していない発信ジャックは無効");
  assert.equal(world.attemptConnect(99, 0), "invalid", "範囲外のsourceIndex");
  assert.equal(world.attemptConnect(0, 99), "invalid", "範囲外のdestinationIndex");
  assert.equal(world.score, 0);
  assert.equal(world.lives, LIVES_MAX);
});

test("放置して光ったジャックがタイムアウトするとライフが減る", () => {
  const world = new SwitchboardWorld();
  world.step(1 / 60);
  const sourceIndex = liveIndex(world);
  let timedOut = false;
  world.onTimeout = (event) => {
    if (event.sourceIndex === sourceIndex) timedOut = true;
  };

  world.step(world.liveDuration + 1);

  assert.equal(timedOut, true, "onTimeoutが発火する");
  assert.equal(world.lives, LIVES_MAX - 1);
  assert.equal(world.sourceJacks[sourceIndex].state, "cooldown");
});

test("ライフが0になるとゲームオーバーになり、以降は状態が変化しない", () => {
  const world = new SwitchboardWorld();

  for (let i = 0; i < LIVES_MAX; i++) {
    for (let guard = 0; guard < 50 && world.sourceJacks.every((j) => j.state !== "live"); guard++) {
      world.step(world.spawnInterval);
    }
    const sourceIndex = liveIndex(world);
    const destinationIndex = wrongDestinationIndex(world, sourceIndex);
    world.attemptConnect(sourceIndex, destinationIndex);
  }

  assert.equal(world.isOver, true);
  assert.equal(world.lives, 0);

  const scoreBefore = world.score;
  world.step(5);
  assert.equal(world.score, scoreBefore, "ゲームオーバー後はstepしても変化しない");
  assert.equal(world.attemptConnect(0, 0), "invalid", "ゲームオーバー後の接続は常に無効");
});

test("reset()で最初の状態に戻る", () => {
  const world = new SwitchboardWorld();
  world.step(1 / 60);
  const sourceIndex = liveIndex(world);
  const destinationIndex = correctDestinationIndex(world, sourceIndex);
  world.attemptConnect(sourceIndex, destinationIndex);

  world.reset();

  assert.equal(world.score, 0);
  assert.equal(world.lives, LIVES_MAX);
  assert.equal(world.isOver, false);
  assert.ok(world.sourceJacks.every((jack) => jack.state === "idle"));
});

test("連続成功で難易度が上がる(点灯時間短縮・出現間隔短縮・同時点灯数増加)", () => {
  const world = new SwitchboardWorld();
  const initialLiveDuration = world.liveDuration;
  const initialSpawnInterval = world.spawnInterval;
  const initialMaxConcurrent = world.maxConcurrent;

  for (let i = 0; i < 6; i++) {
    // 同時点灯数の上限まで達している可能性があるため、点灯が無ければ待機してから接続する。
    for (let guard = 0; guard < 50 && world.sourceJacks.every((j) => j.state !== "live"); guard++) {
      world.step(world.spawnInterval);
    }
    const sourceIndex = liveIndex(world);
    const destinationIndex = correctDestinationIndex(world, sourceIndex);
    world.attemptConnect(sourceIndex, destinationIndex);
  }

  assert.ok(world.liveDuration < initialLiveDuration, "点灯時間が短くなる");
  assert.ok(world.spawnInterval < initialSpawnInterval, "出現間隔が短くなる");
  assert.ok(world.maxConcurrent > initialMaxConcurrent, "同時点灯数が増える");
});

test("同時点灯数が増えると複数のジャックが同時に点灯し得る", () => {
  const world = new SwitchboardWorld();

  for (let i = 0; i < 5; i++) {
    for (let guard = 0; guard < 50 && world.sourceJacks.every((j) => j.state !== "live"); guard++) {
      world.step(world.spawnInterval);
    }
    const sourceIndex = liveIndex(world);
    const destinationIndex = correctDestinationIndex(world, sourceIndex);
    world.attemptConnect(sourceIndex, destinationIndex);
  }

  assert.ok(world.maxConcurrent >= 2, "5回成功でmaxConcurrentが2以上になっている前提");

  // 冷却が終わるまで待ってから、複数の待機ジャックを同時に点灯させる。
  world.step(1);
  world.step(0.0001);
  const liveCount = world.sourceJacks.filter((jack) => jack.state === "live").length;
  assert.ok(liveCount >= 1, "少なくとも1つは点灯している");
  assert.ok(liveCount <= world.maxConcurrent, "同時点灯数の上限を超えない");
});
