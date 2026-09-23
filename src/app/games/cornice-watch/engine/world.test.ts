import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CHAIN_THRESHOLD,
  CorniceWatchWorld,
  INITIAL_LOAD_MAX,
  LANE_COUNT,
  LOAD_MAX,
  STORM_INTERVAL_SECONDS,
  VILLAGE_HEALTH_MAX,
} from "./world.ts";

// このテストはクライアント完結のミニゲームであり、権限拒否の観点は対象外(認可を持たないため)。
// 境界値(レーン端の隣接なし)・空/ゼロ件(積雪0のレーンをrelease)・エラー/失敗(自然崩落による
// ダメージ・ゲームオーバー)・操作の中断(isOverによるstep/releaseの早期リターン)・再入
// (ゲームオーバー後のreset)はそれぞれ以下でカバーする。非同期の競合はゲームループが単一
// スレッドの同期stepのみのため対象外。キャッシュの陳腐化はサーバー通信を持たないため対象外。

function assertFinite(world: CorniceWatchWorld, label: string): void {
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.villageHealth), `${label}: villageHealth`);
  for (const lane of world.lanes) {
    assert.ok(Number.isFinite(lane.load), `${label}: lane load`);
  }
}

test("起動直後は集落が満タン・スコアも0で、各レーンの初期積雪はわずかにばらついている", () => {
  const world = new CorniceWatchWorld();

  assert.equal(world.lanes.length, LANE_COUNT);
  assert.equal(world.villageHealth, VILLAGE_HEALTH_MAX);
  assert.equal(world.score, 0);
  assert.equal(world.isOver, false);
  for (const lane of world.lanes) {
    assert.ok(lane.load >= 0 && lane.load <= INITIAL_LOAD_MAX, "初期積雪は範囲内");
    assert.ok(lane.rate > 0, "積雪ペースは正の値");
  }
  assertFinite(world, "起動直後");
});

test("空のレーンをreleaseしても何も起きない", () => {
  const world = new CorniceWatchWorld();
  world.lanes[0].load = 0;

  world.release(0);

  assert.equal(world.score, 0);
  assert.equal(world.villageHealth, VILLAGE_HEALTH_MAX);
});

test("低い積雪量で解放すると積雪量に応じた得点だけが入り、隣には飛び火しない", () => {
  const world = new CorniceWatchWorld();
  world.lanes[1].load = 0;
  world.lanes[2].load = 0.3;
  world.lanes[3].load = 0;
  let released: { points: number; isClutch: boolean } | null = null;
  world.onRelease = (event) => {
    released = event;
  };

  world.release(2);

  assert.equal(world.lanes[2].load, 0, "解放したレーンは0に戻る");
  assert.equal(world.score, 30, "得点は積雪量*100");
  assert.ok(released !== null);
  assert.equal((released as { isClutch: boolean }).isClutch, false);
  assert.equal(world.lanes[1].load, 0, "隣のレーンは無傷");
  assert.equal(world.lanes[3].load, 0, "隣のレーンは無傷");
});

test("しきい値以上で解放すると際どいボーナスが付き、両隣に雪が飛び火する", () => {
  const world = new CorniceWatchWorld();
  world.lanes[1].load = 0;
  world.lanes[2].load = CHAIN_THRESHOLD;
  world.lanes[3].load = 0;

  world.release(2);

  assert.equal(world.score, Math.round(CHAIN_THRESHOLD * 100) + 50, "際どいボーナスが加算される");
  assert.ok(world.lanes[1].load > 0, "左隣に雪が飛び火する");
  assert.ok(world.lanes[3].load > 0, "右隣に雪が飛び火する");
});

test("端のレーン(index 0)を解放しても存在しない隣には何も起きず、片側だけに飛び火する", () => {
  const world = new CorniceWatchWorld();
  world.lanes[0].load = CHAIN_THRESHOLD;
  world.lanes[1].load = 0;

  assert.doesNotThrow(() => world.release(0));

  assert.equal(world.lanes[0].load, 0);
  assert.ok(world.lanes[1].load > 0, "右隣にだけ飛び火する");
});

test("積雪がLOAD_MAXへ達すると自然崩落して集落にダメージが入る", () => {
  const world = new CorniceWatchWorld();
  world.lanes[3].load = LOAD_MAX - 0.001;
  world.lanes[3].rate = 1; // 1秒でMAXに到達させる
  let collapsed: { laneIndex: number; isChained: boolean } | null = null;
  world.onCollapse = (event) => {
    collapsed = event;
  };

  world.step(1);

  assert.equal(world.lanes[3].load, 0, "崩落したレーンは0に戻る");
  assert.equal(world.villageHealth, VILLAGE_HEALTH_MAX - 15, "自然崩落でダメージが入る");
  assert.ok(collapsed !== null);
  assert.equal((collapsed as { laneIndex: number }).laneIndex, 3);
  assert.equal((collapsed as { isChained: boolean }).isChained, false);
  assertFinite(world, "自然崩落後");
});

test("自然崩落が隣のレーンをしきい値超えに押し上げると連鎖崩落してさらにダメージが入る", () => {
  const world = new CorniceWatchWorld();
  world.lanes[2].load = LOAD_MAX - 0.001;
  world.lanes[2].rate = 1;
  world.lanes[3].load = LOAD_MAX - 0.01; // 飛び火だけでMAXを超える程度に積もらせておく
  world.lanes[3].rate = 0; // このレーン自身は自然には増えない

  world.step(1);

  assert.equal(world.villageHealth, VILLAGE_HEALTH_MAX - 30, "2連鎖でダメージが2回分入る");
});

test("集落の体力が尽きるとゲームオーバーになり、以降はstep/releaseが状態を変えない", () => {
  const world = new CorniceWatchWorld();
  for (const lane of world.lanes) lane.rate = 0;
  let gameOverScore: number | null = null;
  world.onGameOver = (event) => {
    gameOverScore = event.score;
  };

  // 1回の自然崩落で必ずダメージが入るので、十分な回数繰り返せば体力は必ず尽きる
  // (隣への飛び火で連鎖崩落が起きれば、それより早く尽きることもある)。
  for (let i = 0; i < 20 && !world.isOver; i++) {
    world.lanes[0].load = LOAD_MAX - 0.001;
    world.lanes[0].rate = 1;
    world.step(1);
    world.lanes[0].rate = 0;
  }

  assert.equal(world.isOver, true);
  assert.equal(world.villageHealth, 0);
  assert.ok(gameOverScore !== null);

  const scoreBefore = world.score;
  const healthBefore = world.villageHealth;
  world.lanes[1].load = 0.9;
  world.step(1);
  world.release(1);
  assert.equal(world.score, scoreBefore, "ゲームオーバー後はscoreが変化しない");
  assert.equal(world.villageHealth, healthBefore, "ゲームオーバー後はvillageHealthが変化しない");
});

test("積雪は時間経過とともに自動的に増えていく", () => {
  const world = new CorniceWatchWorld();
  const initialLoad = world.lanes[0].load;

  world.step(1);

  assert.ok(world.lanes[0].load > initialLoad, "何もしなくても積雪が進む");
  assertFinite(world, "経過後");
});

test("一定間隔で吹雪が起き、全レーンの積雪が一斉に底上げされる", () => {
  const world = new CorniceWatchWorld();
  for (const lane of world.lanes) lane.rate = 0; // 通常の積雪と混ざらないようにする
  let stormBoost = -1;
  world.onStorm = (event) => {
    stormBoost = event.boost;
  };

  world.step(STORM_INTERVAL_SECONDS);

  assert.ok(stormBoost > 0, "吹雪イベントが発火する");
  for (const lane of world.lanes) {
    assert.ok(lane.load > 0, "吹雪で全レーンの積雪が増える");
  }
});

test("resetで最初の状態に戻り、再入しても壊れない", () => {
  const world = new CorniceWatchWorld();
  world.lanes[0].load = 0.9;
  world.score = 500;
  world.villageHealth = 20;

  world.reset();

  assert.equal(world.score, 0);
  assert.equal(world.villageHealth, VILLAGE_HEALTH_MAX);
  assert.equal(world.isOver, false);
  for (const lane of world.lanes) {
    assert.ok(lane.load >= 0 && lane.load <= INITIAL_LOAD_MAX, "初期積雪は範囲内に戻る");
  }
  assertFinite(world, "リセット後");
});
