import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COLLISION_DISTANCE,
  FUEL_MAX,
  HoldingPatternWorld,
  type IncidentEvent,
  MAX_PLANES,
  MAX_STRIKES,
  PLANE_SPEED,
  RUNWAY_HEADING_TOLERANCE,
} from "./world.ts";

const WIDTH = 800;
const HEIGHT = 600;

/** テストを決定的にするための固定乱数(常に同じ値を返す)。 */
function fixedRandom(value: number): () => number {
  return () => value;
}

function forceSpawn(world: HoldingPatternWorld): void {
  // step()は内部のspawnTimerが尽きたときだけスポーンするため、十分大きいdtで必ず1つ出す。
  world.step(10);
}

test("初期状態は機体無し・スコア0・ストリーク0・警告0", () => {
  const world = new HoldingPatternWorld(WIDTH, HEIGHT);

  assert.equal(world.planes.length, 0);
  assert.equal(world.score, 0);
  assert.equal(world.streak, 0);
  assert.equal(world.strikes, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.runways.length, 2);
});

test("時間経過で機体が出現し、速度と燃料が初期値になる", () => {
  const world = new HoldingPatternWorld(WIDTH, HEIGHT);
  forceSpawn(world);

  assert.equal(world.planes.length, 1);
  const plane = world.planes[0];
  assert.equal(plane.speed, PLANE_SPEED);
  assert.equal(plane.fuel, FUEL_MAX);
  assert.equal(plane.heading, plane.targetHeading, "出現直後は目標方位=現在方位");
});

test("目標方位を設定しても即座には向きが変わらず、旋回速度の上限ぶんだけ近づく", () => {
  const world = new HoldingPatternWorld(WIDTH, HEIGHT);
  forceSpawn(world);
  const plane = world.planes[0];
  const initialHeading = plane.heading;

  world.setPlaneTargetHeading(plane.id, initialHeading + Math.PI);
  world.step(1 / 60);

  assert.notEqual(plane.heading, initialHeading, "方位は変化し始める");
  assert.notEqual(plane.heading, initialHeading + Math.PI, "1フレームでは目標に到達しない");
});

test("十分な時間stepすると目標方位に一致する", () => {
  // 乱数次第では滑走路のすぐ脇に湧いて旋回し終える前に着陸(=ワールドから除去)してしまい、
  // 方位が更新されなくなるため、乱数を固定して上端の左寄り(滑走路から遠い位置)に出す。
  const world = new HoldingPatternWorld(WIDTH, HEIGHT, fixedRandom(0.1));
  forceSpawn(world);
  const plane = world.planes[0];
  const target = plane.heading + Math.PI * 0.7;

  world.setPlaneTargetHeading(plane.id, target);
  for (let i = 0; i < 300; i++) world.step(1 / 60);

  const normalizedTarget = Math.atan2(Math.sin(target), Math.cos(target));
  assert.ok(
    Math.abs(plane.heading - normalizedTarget) < 1e-6,
    `十分な時間が経つと目標方位に一致する(heading=${plane.heading}, target=${normalizedTarget})`,
  );
});

test("rotatePlaneTargetHeadingで目標方位を相対的に回せる", () => {
  const world = new HoldingPatternWorld(WIDTH, HEIGHT);
  forceSpawn(world);
  const plane = world.planes[0];
  const before = plane.targetHeading;

  world.rotatePlaneTargetHeading(plane.id, 0.3);

  const expected = Math.atan2(Math.sin(before + 0.3), Math.cos(before + 0.3));
  assert.ok(Math.abs(plane.targetHeading - expected) < 1e-9);
});

test("滑走路の軸に位置・方位を合わせて進入すると着地し、スコアとストリークが増える", () => {
  const world = new HoldingPatternWorld(WIDTH, HEIGHT);
  forceSpawn(world);
  const plane = world.planes[0];
  const runway = world.runways[0];

  plane.x = runway.x;
  plane.y = runway.y;
  plane.heading = runway.heading;
  plane.targetHeading = runway.heading;

  let landed: { planeId: number; runwayLabel: string } | null = null;
  world.onLand = (event) => {
    landed = event;
  };

  world.step(1 / 60);

  assert.ok(landed, "onLandが発火する");
  assert.equal(world.planes.length, 0, "着地した機体は消える");
  assert.equal(world.score, 160);
  assert.equal(world.streak, 1);
});

test("滑走路の軸から方位が許容量を超えてずれていると着地しない", () => {
  const world = new HoldingPatternWorld(WIDTH, HEIGHT);
  forceSpawn(world);
  const plane = world.planes[0];
  const runway = world.runways[0];

  plane.x = runway.x;
  plane.y = runway.y;
  plane.heading = runway.heading + RUNWAY_HEADING_TOLERANCE + 0.3;
  plane.targetHeading = plane.heading;

  world.step(1 / 60);

  assert.equal(world.planes.length, 1, "方位が揃っていないと着地しない");
  assert.equal(world.score, 0);
});

test("逆向き(軸合わせだが180度反対)でも着地できる", () => {
  const world = new HoldingPatternWorld(WIDTH, HEIGHT);
  forceSpawn(world);
  const plane = world.planes[0];
  const runway = world.runways[0];

  plane.x = runway.x;
  plane.y = runway.y;
  plane.heading = runway.heading + Math.PI;
  plane.targetHeading = plane.heading;

  world.step(1 / 60);

  assert.equal(world.planes.length, 0, "滑走路の軸に乗っていれば反対向きでも着地する");
});

test("機体同士が接近すると衝突し、両方消えて警告が増え、ストリークがリセットされる", () => {
  const world = new HoldingPatternWorld(WIDTH, HEIGHT);
  forceSpawn(world);
  forceSpawn(world);
  const [a, b] = world.planes;

  // 1フレーム分の移動(速度×dt)で閾値をまたいでしまわないよう、十分な余裕を持たせて接近させる。
  a.x = 400;
  a.y = 300;
  a.heading = 0;
  a.targetHeading = 0;
  b.x = 400 + COLLISION_DISTANCE * 0.5;
  b.y = 300;
  b.heading = Math.PI;
  b.targetHeading = Math.PI;

  const incidents: IncidentEvent[] = [];
  world.onIncident = (event) => {
    incidents.push(event);
  };

  world.step(1 / 60);

  assert.equal(incidents.length, 1, "onIncidentが1回発火する");
  assert.equal(incidents[0].reason, "collision");
  assert.equal(world.planes.length, 0, "衝突した機体は両方消える");
  assert.equal(world.strikes, 1);
  assert.equal(world.streak, 0);
});

test("燃料が尽きると機体が失われ、警告が増える", () => {
  const world = new HoldingPatternWorld(WIDTH, HEIGHT);
  forceSpawn(world);
  const plane = world.planes[0];
  plane.fuel = 0.001;

  const incidents: IncidentEvent[] = [];
  world.onIncident = (event) => {
    incidents.push(event);
  };

  world.step(1 / 60);

  assert.equal(incidents.length, 1, "onIncidentが1回発火する");
  assert.equal(incidents[0].reason, "fuel");
  assert.equal(world.planes.length, 0);
  assert.equal(world.strikes, 1);
});

test("警告がMAX_STRIKESに達するとゲームオーバーになり、以降は状態が変化しない", () => {
  const world = new HoldingPatternWorld(WIDTH, HEIGHT);

  for (let i = 0; i < MAX_STRIKES; i++) {
    forceSpawn(world);
    const plane = world.planes[world.planes.length - 1];
    plane.fuel = 0.001;
    world.step(1 / 60);
  }

  assert.equal(world.isOver, true);
  assert.equal(world.strikes, MAX_STRIKES);

  const scoreBefore = world.score;
  world.step(5);
  assert.equal(world.planes.length, 0, "ゲームオーバー後はstepしてもスポーンしない");
  assert.equal(world.score, scoreBefore);
});

test("ゲームオーバー後はsetPlaneTargetHeading/rotatePlaneTargetHeadingも無視される", () => {
  // 乱数次第では後から湧いた機体とsurvivorが異常接近して両方消えてしまうため、
  // 乱数を固定して出現位置を揃える(survivorはその間に出現位置から遠く離れている)。
  const world = new HoldingPatternWorld(WIDTH, HEIGHT, fixedRandom(0.1));
  forceSpawn(world);
  const survivor = world.planes[0];
  const survivorTargetBefore = survivor.targetHeading;

  // survivorとは別の機体を2回燃料切れにして、3回目でゲームオーバーにする。
  for (let i = 0; i < MAX_STRIKES; i++) {
    forceSpawn(world);
    const victim = world.planes[world.planes.length - 1];
    victim.fuel = 0.001;
    world.step(1 / 60);
  }
  assert.equal(world.isOver, true);
  assert.equal(world.planes.length, 1, "survivorは燃料切れにしていないので残っている");
  assert.equal(world.planes[0].id, survivor.id);

  world.setPlaneTargetHeading(survivor.id, survivorTargetBefore + 1);
  world.rotatePlaneTargetHeading(survivor.id, 1);

  assert.equal(
    survivor.targetHeading,
    survivorTargetBefore,
    "ゲームオーバー後の方位指定操作は無視される",
  );
});

test("reset()で最初の状態に戻る", () => {
  const world = new HoldingPatternWorld(WIDTH, HEIGHT);
  forceSpawn(world);
  const plane = world.planes[0];
  const runway = world.runways[0];
  plane.x = runway.x;
  plane.y = runway.y;
  plane.heading = runway.heading;
  plane.targetHeading = runway.heading;
  world.step(1 / 60);
  assert.ok(world.score > 0);

  world.reset();

  assert.equal(world.planes.length, 0);
  assert.equal(world.score, 0);
  assert.equal(world.streak, 0);
  assert.equal(world.strikes, 0);
  assert.equal(world.isOver, false);
});

test("連続着陸で出現間隔が短くなる", () => {
  const world = new HoldingPatternWorld(WIDTH, HEIGHT);
  const initialSpawnInterval = world.spawnInterval;

  for (let i = 0; i < 6; i++) {
    forceSpawn(world);
    const plane = world.planes[world.planes.length - 1];
    const runway = world.runways[0];
    plane.x = runway.x;
    plane.y = runway.y;
    plane.heading = runway.heading;
    plane.targetHeading = runway.heading;
    world.step(1 / 60);
  }

  assert.ok(world.spawnInterval < initialSpawnInterval, "出現間隔が短くなる");
});

test("出現する機体数には上限があり、無限に増え続けない", () => {
  const world = new HoldingPatternWorld(WIDTH, HEIGHT);
  const dt = world.spawnInterval;

  for (let i = 0; i < 20; i++) world.step(dt);

  assert.ok(world.planes.length > 0, "そもそも出現はしている");
  assert.ok(world.planes.length <= MAX_PLANES, `上限(${MAX_PLANES}機)を超えて増えない`);
});

test("mostUrgentPlaneIdは燃料が最も少ない機体を返す", () => {
  const world = new HoldingPatternWorld(WIDTH, HEIGHT);
  forceSpawn(world);
  const first = world.planes[0];
  forceSpawn(world);
  const second = world.planes[1];
  first.fuel = 10;
  second.fuel = 5;

  assert.equal(world.mostUrgentPlaneId(), second.id);
});

test("機体が1つも無いときmostUrgentPlaneIdはnullを返す", () => {
  const world = new HoldingPatternWorld(WIDTH, HEIGHT);
  assert.equal(world.mostUrgentPlaneId(), null);
});

test("resizeすると機体とランウェイの位置が比率を保って再スケールされる", () => {
  const world = new HoldingPatternWorld(WIDTH, HEIGHT);
  forceSpawn(world);
  const plane = world.planes[0];
  plane.x = WIDTH / 2;
  plane.y = HEIGHT / 2;
  const runwayBefore = world.runways[0];
  const ratioXBefore = runwayBefore.x / WIDTH;

  world.resize(WIDTH * 2, HEIGHT * 2);

  assert.equal(plane.x, WIDTH, "機体のx座標も倍率に合わせて再スケールされる");
  assert.equal(plane.y, HEIGHT);
  const runwayAfter = world.runways[0];
  assert.ok(
    Math.abs(runwayAfter.x / (WIDTH * 2) - ratioXBefore) < 1e-9,
    "ランウェイの位置比率は変わらない",
  );
});
