import assert from "node:assert/strict";
import { test } from "node:test";
import { COVERAGE_COMPLETE_THRESHOLD, FerroBloomWorld, ROUND_SECONDS } from "./world.ts";

const WIDTH = 960;
const HEIGHT = 540;
const FRAME = 1 / 60;

function assertFinite(world: FerroBloomWorld, label: string): void {
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.timeRemaining), `${label}: timeRemaining`);
  assert.ok(Number.isFinite(world.target.x) && Number.isFinite(world.target.y), `${label}: target`);
  assert.ok(Number.isFinite(world.magnet.x) && Number.isFinite(world.magnet.y), `${label}: magnet`);
  for (const particle of world.particles) {
    assert.ok(
      Number.isFinite(particle.x) && Number.isFinite(particle.y),
      `${label}: particle position`,
    );
    assert.ok(
      Number.isFinite(particle.vx) && Number.isFinite(particle.vy),
      `${label}: particle velocity`,
    );
  }
}

/**
 * 磁石を常にその時点のターゲット中心へ固定して引力を有効にし、粒子を集め続ける。
 * ターゲット達成のたびに次のターゲット位置は乱数で変わるため、区間の終端で
 * たまたま次ターゲットへ移動した直後を捉えると被覆率が一時的に0に戻ることがある。
 * そのため「最終フレームの値」ではなく「区間中に一度でも閾値へ到達したか」を見る。
 */
function pullParticlesIntoTarget(
  world: FerroBloomWorld,
  seconds: number,
): { everReachedThreshold: boolean } {
  world.setMagnetMode("attract");
  let everReachedThreshold = false;
  for (let elapsed = 0; elapsed < seconds; elapsed += FRAME) {
    world.setMagnetPosition(world.target.x, world.target.y);
    world.setMagnetActive(true);
    world.step(FRAME);
    if (world.coverageRatio >= COVERAGE_COMPLETE_THRESHOLD) everReachedThreshold = true;
  }
  return { everReachedThreshold };
}

test("起動直後に粒子・ターゲット・磁石が画面内に揃っている", () => {
  const world = new FerroBloomWorld(WIDTH, HEIGHT);

  assert.ok(world.particles.length > 0, "粒子が配置されている");
  assert.ok(world.target.radius > 0, "ターゲット領域が存在する");
  assert.ok(world.target.x >= 0 && world.target.x <= WIDTH, "ターゲットが画面内");
  assert.ok(world.target.y >= 0 && world.target.y <= HEIGHT, "ターゲットが画面内");
  assert.equal(world.magnet.isActive, false, "起動直後は磁石が働いていない");
  assert.equal(world.magnet.mode, "attract", "初期モードは引力");
  assert.equal(world.score, 0);
  assert.ok(world.timeRemaining > 0);
  assert.equal(world.isOver, false);
  assert.equal(world.coverageRatio, 0);
  assertFinite(world, "起動直後");
});

test("何も操作しなくても粒子は自然に揺らいで静止画にならない", () => {
  const world = new FerroBloomWorld(WIDTH, HEIGHT);
  const before = world.particles.map((p) => ({ x: p.x, y: p.y }));

  for (let i = 0; i < 40; i++) world.step(FRAME);

  const moved = world.particles.some(
    (p, i) => Math.hypot(p.x - before[i].x, p.y - before[i].y) > 0.01,
  );
  assert.ok(moved, "無操作でも少なくとも1粒子は動いている");
  assertFinite(world, "アンビエント揺らぎ後");
});

test("引力にしてターゲットへ磁石を置き続けると粒子が集まり、被覆率が閾値を超える", () => {
  const world = new FerroBloomWorld(WIDTH, HEIGHT);

  const { everReachedThreshold } = pullParticlesIntoTarget(world, 3);

  assert.ok(everReachedThreshold, "十分な時間引き寄せれば被覆率が閾値を超える瞬間がある");
  assertFinite(world, "引力で収束後");
});

test("被覆率を維持し続けるとターゲットを達成して得点し、次のターゲットが現れる", () => {
  const world = new FerroBloomWorld(WIDTH, HEIGHT);
  const completed: number[] = [];
  world.onTargetFilled = ({ points }) => completed.push(points);

  const firstTarget = { ...world.target };
  pullParticlesIntoTarget(world, 8);

  assert.ok(completed.length >= 1, "少なくとも1回はターゲットを達成する");
  assert.ok(completed[0] > 0, "得点が入っている");
  assert.equal(world.combo, completed.length, "達成回数ぶんコンボが進む");
  assert.ok(
    world.target.x !== firstTarget.x || world.target.y !== firstTarget.y,
    "達成すると次のターゲットへ切り替わる",
  );
  assertFinite(world, "ターゲット達成後");
});

test("斥力にすると磁石の近くの粒子が遠ざかる", () => {
  const world = new FerroBloomWorld(WIDTH, HEIGHT);
  const particle = world.particles[0];
  particle.x = WIDTH / 2 - 5;
  particle.y = HEIGHT / 2;
  particle.vx = 0;
  particle.vy = 0;

  world.setMagnetMode("repel");
  world.setMagnetPosition(WIDTH / 2, HEIGHT / 2);
  world.setMagnetActive(true);

  const distanceBefore = Math.hypot(particle.x - world.magnet.x, particle.y - world.magnet.y);
  world.step(FRAME);
  const distanceAfter = Math.hypot(particle.x - world.magnet.x, particle.y - world.magnet.y);

  assert.ok(distanceAfter > distanceBefore, "反発モードでは磁石から遠ざかる");
  assertFinite(world, "反発後");
});

test("cycleMagnetMode で引力/斥力が交互に切り替わる", () => {
  const world = new FerroBloomWorld(WIDTH, HEIGHT);
  assert.equal(world.magnet.mode, "attract");
  world.cycleMagnetMode();
  assert.equal(world.magnet.mode, "repel");
  world.cycleMagnetMode();
  assert.equal(world.magnet.mode, "attract");
});

test("画面端で粒子がバウンスし、外にはみ出さない", () => {
  const world = new FerroBloomWorld(WIDTH, HEIGHT);
  const particle = world.particles[0];
  particle.x = -50;
  particle.y = HEIGHT / 2;
  particle.vx = -10;
  particle.vy = 0;

  world.step(FRAME);

  assert.ok(particle.x >= 0, "左端を突き抜けない");
  assert.ok(particle.vx >= 0, "反射して右向きの速度になる");
  assertFinite(world, "バウンド後");
});

test(`${ROUND_SECONDS}秒遊ぶとラウンドが終わり、リスタートで最初から遊べる`, () => {
  const world = new FerroBloomWorld(WIDTH, HEIGHT);

  for (let i = 0; i < ROUND_SECONDS * 20 && !world.isOver; i++) {
    world.step(0.1);
    assertFinite(world, "ラウンド中");
  }

  assert.equal(world.isOver, true, "ラウンドが終了する");
  assert.equal(world.timeRemaining, 0);

  // 終了後に進めても壊れない
  world.step(FRAME);
  assertFinite(world, "ラウンド終了後");

  world.reset();
  assert.equal(world.isOver, false);
  assert.equal(world.score, 0);
  assert.equal(world.combo, 0);
  assert.ok(world.timeRemaining > 0);
  assert.equal(world.magnet.isActive, false);
});

test("画面サイズが変わっても粒子・ターゲット・磁石が画面内に収まる", () => {
  const world = new FerroBloomWorld(WIDTH, HEIGHT);
  world.setMagnetPosition(WIDTH * 0.9, HEIGHT * 0.9);

  // PC横長 → スマホ縦長
  world.resize(375, 720);

  assert.ok(world.magnet.x >= -1 && world.magnet.x <= 376, "磁石が画面内に収まる");
  assert.ok(world.magnet.y >= -1 && world.magnet.y <= 721, "磁石が画面内に収まる");
  assert.ok(world.target.x >= -1 && world.target.x <= 376, "ターゲットが画面内に収まる");

  for (let i = 0; i < 60; i++) world.step(FRAME);
  for (const particle of world.particles) {
    assert.ok(particle.x >= -1 && particle.x <= 376, "粒子が画面内に留まる");
    assert.ok(particle.y >= -1 && particle.y <= 721, "粒子が画面内に留まる");
  }
  assertFinite(world, "リサイズ後");
});
