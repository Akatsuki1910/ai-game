import assert from "node:assert/strict";
import { test } from "node:test";
import { getPanelRects, toAbsolute } from "./gardenLayout.ts";
import { GardenWorld, hitRadiusFraction, INITIAL_LIVES, roundSeconds } from "./gardenWorld.ts";

const WIDTH = 1000;
const HEIGHT = 600;

/** 現在のラウンドで、まだ見つかっていない差分をパネル座標から絶対ピクセル座標へ変換する。 */
function absolutePositionOf(
  world: GardenWorld,
  panel: "a" | "b",
  elementId: number,
): { x: number; y: number } {
  const rects = getPanelRects(world.width, world.height);
  const rect = panel === "a" ? rects.a : rects.b;
  const elements = panel === "a" ? world.scene.elementsA : world.scene.elementsB;
  const element = elements.find((e) => e.id === elementId);
  assert.ok(element, `要素id=${elementId}がパネル${panel}に存在する`);
  return toAbsolute(rect, element as { lx: number; ly: number });
}

function findFirstUnfoundDiff(world: GardenWorld) {
  const spot = world.scene.differences.find((d) => !d.isFound);
  assert.ok(spot, "未発見の差分が少なくとも1つある");
  return spot as NonNullable<typeof spot>;
}

/** どの変化の種類でもB側の座標をクリックすれば検出できる(vanishでも位置自体は変わらない)。 */
function clickDifference(world: GardenWorld, elementId: number) {
  const pos = absolutePositionOf(world, "b", elementId);
  return world.guessAt(pos.x, pos.y);
}

test("初期状態: ラウンド1・スコア0・ライフ満タンで始まる", () => {
  const world = new GardenWorld(WIDTH, HEIGHT);
  assert.equal(world.round, 1);
  assert.equal(world.score, 0);
  assert.equal(world.lives, INITIAL_LIVES);
  assert.equal(world.isOver, false);
  assert.ok(world.totalDifferenceCount > 0);
  assert.equal(world.remainingDifferenceCount, world.totalDifferenceCount);
});

test("差分の場所を当てると見つかり、スコアが入って見た目が元に戻る(リペア)", () => {
  const world = new GardenWorld(WIDTH, HEIGHT);
  const spot = findFirstUnfoundDiff(world);

  const result = clickDifference(world, spot.elementId);

  assert.ok(result === "found" || result === "cleared");
  assert.ok(world.score > 0, "得点が入っている");
  const elementA = world.scene.elementsA.find((e) => e.id === spot.elementId);
  // ラウンドがクリアされていなければ、見つけた要素はB側がA側と同じ見た目に戻っている
  if (result === "found") {
    const elementB = world.scene.elementsB.find((e) => e.id === spot.elementId);
    assert.deepEqual(elementB, elementA, "見つけた差分はA/Bで同じ見た目に修復される");
  }
});

test("差分がない場所をクリックしてもスコアは増えず、残り時間が減る(ペナルティ)", () => {
  const world = new GardenWorld(WIDTH, HEIGHT);
  const before = world.timeRemaining;

  // パネルAの中央付近 — 既知の差分要素とは十分離れていることを期待しづらいので、
  // 念のため実際に未発見の差分に当たっていないことを確認してから検証する。
  const rects = getPanelRects(world.width, world.height);
  const probe = { x: rects.a.x + rects.a.width * 0.5, y: rects.a.y + rects.a.height * 0.5 };
  const radius = hitRadiusFraction(world.round) * Math.min(rects.a.width, rects.a.height);
  const isNearAnyDiff = world.scene.differences.some((d) => {
    const el = world.scene.elementsA.find((e) => e.id === d.elementId);
    if (!el) return false;
    const abs = toAbsolute(rects.a, el);
    return Math.hypot(abs.x - probe.x, abs.y - probe.y) <= radius;
  });

  const result = world.guessAt(probe.x, probe.y);

  if (!isNearAnyDiff) {
    assert.equal(result, "miss");
    assert.equal(world.score, 0, "ハズレではスコアが増えない");
    assert.ok(world.timeRemaining < before, "ハズレは時間が減るペナルティがある");
  }
});

test("ステージ外(ガター)をクリックしてもエラーにならずミス扱いになる", () => {
  const world = new GardenWorld(WIDTH, HEIGHT);
  const rects = getPanelRects(world.width, world.height);
  const gutterX = rects.a.x + rects.a.width + (rects.b.x - (rects.a.x + rects.a.width)) / 2;

  const result = world.guessAt(gutterX, HEIGHT / 2);
  assert.equal(result, "miss");
});

test("同じ場所を連打しても二重に得点が入らない", () => {
  const world = new GardenWorld(WIDTH, HEIGHT);
  const spot = findFirstUnfoundDiff(world);
  const pos = absolutePositionOf(world, "b", spot.elementId);

  const first = world.guessAt(pos.x, pos.y);
  assert.ok(first === "found" || first === "cleared");
  const scoreAfterFirst = world.score;

  // もう一度まったく同じ場所をクリックする(連打)。
  // ラウンドがクリアされていれば盤面自体が変わっているので、変わっていないことを確認してから検証する。
  // ごく稀に同じ座標が別の未発見差分の許容半径に偶然重なるケースだけは判定対象から外す。
  if (first === "found") {
    const rects = getPanelRects(world.width, world.height);
    const radius = hitRadiusFraction(world.round) * Math.min(rects.b.width, rects.b.height);
    const coincidesWithOtherDiff = world.scene.differences.some((d) => {
      if (d.isFound) return false;
      const el = world.scene.elementsB.find((e) => e.id === d.elementId);
      if (!el) return false;
      const abs = toAbsolute(rects.b, el);
      return Math.hypot(abs.x - pos.x, abs.y - pos.y) <= radius;
    });

    if (!coincidesWithOtherDiff) {
      const second = world.guessAt(pos.x, pos.y);
      assert.equal(second, "miss", "既に修復済みの場所は見つからない");
      assert.equal(world.score, scoreAfterFirst, "連打しても得点は増えない");
    }
  }
});

test("全差分を見つけるとラウンドがクリアされ、次のラウンドの盤面に進む", () => {
  const world = new GardenWorld(WIDTH, HEIGHT);
  const firstRoundDifferenceIds = world.scene.differences.map((d) => d.elementId);

  let lastResult: ReturnType<typeof world.guessAt> = "miss";
  for (const elementId of firstRoundDifferenceIds) {
    lastResult = clickDifference(world, elementId);
  }

  assert.equal(lastResult, "cleared", "最後の1つでクリア判定になる");
  assert.equal(world.round, 2, "ラウンドが進む");
  assert.equal(
    world.remainingDifferenceCount,
    world.totalDifferenceCount,
    "新しい盤面は未発見状態",
  );
  assert.ok(world.score >= 200, "クリアボーナスが加算されている");
});

test("時間切れが続くとライフが減り、ライフが尽きるとゲームオーバーになる", () => {
  const world = new GardenWorld(WIDTH, HEIGHT);
  let timeoutCount = 0;
  world.onRoundTimedOut = () => {
    timeoutCount += 1;
  };

  for (let i = 0; i < 2000 && !world.isOver; i++) {
    world.step(1);
  }

  assert.equal(world.isOver, true, "ライフが尽きてゲームオーバーになる");
  assert.equal(world.lives, 0);
  assert.equal(timeoutCount, INITIAL_LIVES, "タイムアウトがライフの数だけ発生している");

  // ゲームオーバー後に進めても壊れない
  const scoreBefore = world.score;
  world.step(1);
  assert.equal(world.score, scoreBefore);
  assert.equal(world.guessAt(10, 10), "miss");

  world.reset();
  assert.equal(world.isOver, false);
  assert.equal(world.round, 1);
  assert.equal(world.score, 0);
  assert.equal(world.lives, INITIAL_LIVES);
});

test("ラウンドが進むほど制限時間と当たり判定の許容は下限まで厳しくなる", () => {
  assert.ok(roundSeconds(1) > roundSeconds(10));
  assert.ok(roundSeconds(1000) >= roundSeconds(10000));
  assert.ok(hitRadiusFraction(1) > hitRadiusFraction(10));
  assert.ok(hitRadiusFraction(1000) >= hitRadiusFraction(10000));
});

test("セレクターをキーボード相当で動かし、Enter相当のguessAtSelectorで当てられる", () => {
  const world = new GardenWorld(WIDTH, HEIGHT);
  const spot = findFirstUnfoundDiff(world);
  const pos = absolutePositionOf(world, "b", spot.elementId);

  world.setSelectorPosition(0, 0);
  world.moveSelectorBy(pos.x, pos.y);
  assert.ok(Math.abs(world.selectorX - pos.x) < 1e-6);
  assert.ok(Math.abs(world.selectorY - pos.y) < 1e-6);

  const result = world.guessAtSelector();
  assert.ok(result === "found" || result === "cleared");
});

test("セレクターは画面外に出ない", () => {
  const world = new GardenWorld(WIDTH, HEIGHT);
  world.moveSelectorBy(-99999, -99999);
  assert.equal(world.selectorX, 0);
  assert.equal(world.selectorY, 0);
  world.moveSelectorBy(99999999, 99999999);
  assert.equal(world.selectorX, WIDTH);
  assert.equal(world.selectorY, HEIGHT);
});

test("画面の向きが横長から縦長に変わっても、見つかっていた差分の位置は再計算して当てられる", () => {
  const world = new GardenWorld(WIDTH, HEIGHT);
  const spot = findFirstUnfoundDiff(world);

  // PC横長 → スマホ縦長
  world.resize(390, 780);
  assert.equal(world.width, 390);
  assert.equal(world.height, 780);

  const pos = absolutePositionOf(world, "b", spot.elementId);
  assert.ok(pos.x >= 0 && pos.x <= 390);
  assert.ok(pos.y >= 0 && pos.y <= 780);

  const result = world.guessAt(pos.x, pos.y);
  assert.ok(result === "found" || result === "cleared");
});
