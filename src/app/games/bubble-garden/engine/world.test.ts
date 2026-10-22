import assert from "node:assert/strict";
import { test } from "node:test";
import { BubbleGardenWorld, type BubbleLostEvent, START_VITALITY } from "./world.ts";

const FRAME = 1 / 60;

/** 泡を指定した charge で確実に放つ(実時間の長押しを待たない)。 */
function releaseWithCharge(world: BubbleGardenWorld, charge: number): void {
  world.startCharging();
  world.charge = charge;
  world.releaseBubble();
}

/** 的を狙った内容で固定する(ランダム配置に依存したくない検証向け)。 */
function pinTarget(
  world: BubbleGardenWorld,
  overrides: Partial<{ x: number; size: "small" | "medium" | "large"; bandHalfWidth: number }>,
): void {
  world.target = { ...world.target, ...overrides };
}

/** 虫(hazard)を安全な位置に固定し、しばらく巻き戻って来ないようにする。 */
function parkHazardAway(world: BubbleGardenWorld): void {
  world.hazard = { x: 0.97, y: world.hazard.y, vx: 0, radius: world.hazard.radius };
}

function assertFinite(world: BubbleGardenWorld, label: string): void {
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.vitality), `${label}: vitality`);
  if (world.bubble) {
    assert.ok(
      Number.isFinite(world.bubble.x) && Number.isFinite(world.bubble.y),
      `${label}: bubble`,
    );
  }
  assert.ok(Number.isFinite(world.hazard.x), `${label}: hazard`);
}

test("起動直後は満タンの元気・得点0・的と虫が配置されている", () => {
  const world = new BubbleGardenWorld();

  assert.equal(world.score, 0);
  assert.equal(world.vitality, START_VITALITY);
  assert.equal(world.combo, 0);
  assert.equal(world.bloomed, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.bubble, null);
  assert.ok(["small", "medium", "large"].includes(world.target.size));
  assert.ok(world.target.x >= 0 && world.target.x <= 1);
  assert.ok(world.hazard.x >= 0 && world.hazard.x <= 1);
});

test("長押しの長さでサイズが決まり、離すと泡が放たれる", () => {
  const small = new BubbleGardenWorld();
  releaseWithCharge(small, 0.1);
  assert.equal(small.bubble?.size, "small");

  const medium = new BubbleGardenWorld();
  releaseWithCharge(medium, 0.5);
  assert.equal(medium.bubble?.size, "medium");

  const large = new BubbleGardenWorld();
  releaseWithCharge(large, 0.95);
  assert.equal(large.bubble?.size, "large");

  // 泡は蔓(へた)の位置から上向きに動き出す。
  assert.equal(large.bubble?.x, 0.5);
  assert.ok((large.bubble?.vy ?? 0) < 0, "泡は上昇する(yは減る方向)");
});

test("長押し中に泡が飛んでいる間は新しい泡を吹けない", () => {
  const world = new BubbleGardenWorld();
  releaseWithCharge(world, 0.5);
  assert.ok(world.bubble);

  world.startCharging();
  assert.equal(world.isCharging, false, "泡が飛んでいる間は長押しを開始できない");
});

test("長押しせずに離しても何も起きない", () => {
  const world = new BubbleGardenWorld();
  world.releaseBubble();
  assert.equal(world.bubble, null);
  assert.equal(world.charge, 0);
});

test("サイズと位置が合った花に届くと開花して得点・最大コンボが伸びる", () => {
  const world = new BubbleGardenWorld();
  parkHazardAway(world);
  pinTarget(world, { x: 0.5, size: "medium", bandHalfWidth: 0.2 });
  releaseWithCharge(world, 0.5);
  assert.equal(world.bubble?.size, "medium");
  // 風で流されるため、的の真下(x=0.5)へ寄せ続けるよう操作する。
  world.setPointerSteerTarget(0.5);

  const matched: { points: number; isPerfect: boolean }[] = [];
  world.onFlowerMatched = (event) => matched.push(event);

  for (let i = 0; i < 600 && world.bubble; i++) {
    world.step(FRAME);
    assertFinite(world, "上昇中");
  }

  assert.equal(matched.length, 1, "的に届いて開花した");
  assert.ok(matched[0].points > 0, "得点が入っている");
  assert.ok(matched[0].isPerfect, "蔓の真上から狙うとセンター判定(perfect)になる");
  assert.equal(world.score, matched[0].points);
  assert.equal(world.bloomed, 1, "開花数が進む");
  assert.equal(world.combo, 1);
  assert.equal(world.maxCombo, 1);
  assert.equal(world.bubble, null, "開花すると泡は消える");
});

test("サイズが合わない泡が届くと失敗して元気が減る", () => {
  const world = new BubbleGardenWorld();
  parkHazardAway(world);
  pinTarget(world, { x: 0.5, size: "large", bandHalfWidth: 0.2 });
  releaseWithCharge(world, 0.1); // small
  assert.equal(world.bubble?.size, "small");

  const lost: BubbleLostEvent[] = [];
  world.onBubbleLost = (event) => lost.push(event);
  const vitalityBefore = world.vitality;

  for (let i = 0; i < 600 && world.bubble; i++) world.step(FRAME);

  assert.equal(lost.length, 1);
  assert.equal(lost[0].reason, "wrong-size");
  assert.ok(world.vitality < vitalityBefore, "失敗すると元気が減る");
  assert.equal(world.combo, 0);
  assert.equal(world.bubble, null);
});

test("サイズは合っていても中心からズレて届くと失敗になる", () => {
  const world = new BubbleGardenWorld();
  parkHazardAway(world);
  // 的の当たり帯(0.5±0.1)から確実に外れる位置に泡が真っ直ぐ届くようにする。
  pinTarget(world, { x: 0.9, size: "medium", bandHalfWidth: 0.1 });
  releaseWithCharge(world, 0.5);

  const lost: BubbleLostEvent[] = [];
  world.onBubbleLost = (event) => lost.push(event);

  for (let i = 0; i < 600 && world.bubble; i++) world.step(FRAME);

  assert.equal(lost.length, 1);
  assert.equal(lost[0].reason, "off-center");
});

test("ドラッグ(ポインタ)で狙いを左右に寄せられる", () => {
  const world = new BubbleGardenWorld();
  parkHazardAway(world);
  pinTarget(world, { x: 0.5, size: "medium", bandHalfWidth: 0.2 });
  releaseWithCharge(world, 0.5);

  world.setPointerSteerTarget(0.85);
  for (let i = 0; i < 30; i++) world.step(FRAME);

  assert.ok((world.bubble?.x ?? 0) > 0.5, "ポインタで指した側へ寄っていく");
});

test("キーボードの左右指定でも狙いを寄せられる", () => {
  const world = new BubbleGardenWorld();
  parkHazardAway(world);
  pinTarget(world, { x: 0.5, size: "medium", bandHalfWidth: 0.2 });
  releaseWithCharge(world, 0.5);

  world.setSteerKey(-1);
  for (let i = 0; i < 30; i++) world.step(FRAME);

  assert.ok((world.bubble?.x ?? 0) < 0.5, "左キーで左へ寄っていく");
});

test("虫(hazard)に触れると失敗して元気が減る", () => {
  const world = new BubbleGardenWorld();
  releaseWithCharge(world, 0.5);
  const bubble = world.bubble;
  assert.ok(bubble);
  if (!bubble) return;
  world.hazard = { x: bubble.x, y: bubble.y, vx: 0, radius: 0.05 };

  const lost: BubbleLostEvent[] = [];
  world.onBubbleLost = (event) => lost.push(event);
  const vitalityBefore = world.vitality;

  world.step(FRAME);

  assert.equal(lost.length, 1);
  assert.equal(lost[0].reason, "hazard");
  assert.ok(world.vitality < vitalityBefore);
  assert.equal(world.bubble, null);
});

test("長押しを粘りすぎる(オーバーチャージ)と暴発して失敗する", () => {
  const world = new BubbleGardenWorld();
  world.startCharging();
  world.charge = 1;

  const lost: BubbleLostEvent[] = [];
  world.onBubbleLost = (event) => lost.push(event);
  const vitalityBefore = world.vitality;

  world.step(0.6); // オーバーチャージの猶予(0.5秒)を超える

  assert.equal(lost.length, 1);
  assert.equal(lost[0].reason, "overcharge");
  assert.equal(world.isCharging, false);
  assert.ok(world.vitality < vitalityBefore);
});

test("失敗を繰り返して元気が尽きるとゲームオーバーになり、リセットで最初から遊べる", () => {
  const world = new BubbleGardenWorld();
  const wilted: { score: number; maxCombo: number; bloomed: number }[] = [];
  world.onGardenWilted = (event) => wilted.push(event);

  for (let i = 0; i < 20 && !world.isOver; i++) {
    releaseWithCharge(world, 0.5);
    const bubble = world.bubble;
    if (!bubble) break;
    world.hazard = { x: bubble.x, y: bubble.y, vx: 0, radius: 0.05 };
    world.step(FRAME);
    assertFinite(world, "失敗を繰り返す間");
  }

  assert.equal(world.isOver, true, "元気が尽きてゲームオーバーになる");
  assert.equal(wilted.length, 1);
  assert.equal(world.vitality, 0);

  // 終了後に進めても壊れない。
  world.step(FRAME);
  assertFinite(world, "ゲームオーバー後");

  world.reset();
  assert.equal(world.isOver, false);
  assert.equal(world.score, 0);
  assert.equal(world.vitality, START_VITALITY);
  assert.equal(world.bloomed, 0);
  assert.equal(world.bubble, null);
});

test("泡は画面の左右端をはみ出さない", () => {
  const world = new BubbleGardenWorld();
  parkHazardAway(world);
  pinTarget(world, { x: 0.02, size: "medium", bandHalfWidth: 0.4 });
  releaseWithCharge(world, 0.5);
  world.setSteerKey(-1);

  for (let i = 0; i < 300 && world.bubble; i++) {
    world.step(FRAME);
    if (world.bubble) {
      assert.ok(world.bubble.x >= 0, "泡のxが0未満にならない");
    }
  }
});

test("的は開花するたびに当たり帯が狭くなっていく(難易度上昇)", () => {
  const world = new BubbleGardenWorld();
  parkHazardAway(world);
  const widths: number[] = [world.target.bandHalfWidth];

  for (let round = 0; round < 4; round++) {
    pinTarget(world, { x: 0.5, bandHalfWidth: world.target.bandHalfWidth });
    world.target.size = "medium";
    releaseWithCharge(world, 0.5);
    for (let i = 0; i < 600 && world.bubble; i++) world.step(FRAME);
    widths.push(world.target.bandHalfWidth);
  }

  assert.ok(widths[widths.length - 1] < widths[0], "開花を重ねると当たり帯が狭くなる");
});
