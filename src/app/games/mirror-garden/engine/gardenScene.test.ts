import assert from "node:assert/strict";
import { test } from "node:test";
import {
  differenceCount,
  generateGardenScene,
  moveMagnitude,
  PALETTES,
  resizeMagnitude,
  totalElementCount,
} from "./gardenScene.ts";

test("ラウンド1は要素9個・差分3個で生成される", () => {
  const scene = generateGardenScene(1);
  assert.equal(scene.elementsA.length, 9);
  assert.equal(scene.elementsB.length, 9);
  assert.equal(scene.differences.length, 3);
  assert.ok(scene.differences.every((d) => d.isFound === false));
});

test("ラウンドが進むほど要素数・差分数は上限まで増える", () => {
  assert.equal(totalElementCount(1), 9);
  assert.equal(totalElementCount(100), 14);
  assert.ok(totalElementCount(50) <= 14);

  assert.equal(differenceCount(1), 3);
  assert.equal(differenceCount(100), 6);
  assert.ok(differenceCount(50) <= 6);
});

test("ラウンドが進むほど差分の変化量(大きさ/位置のズレ)は下限まで小さくなる", () => {
  assert.ok(resizeMagnitude(1) > resizeMagnitude(10));
  assert.ok(resizeMagnitude(1000) >= resizeMagnitude(10000));
  assert.ok(moveMagnitude(1) > moveMagnitude(10));
  assert.ok(moveMagnitude(1000) >= moveMagnitude(10000));
});

test("差分として選ばれた要素は種類ごとにA/Bで実際に異なり、座標は0〜1の範囲内", () => {
  for (let round = 1; round <= 8; round++) {
    const scene = generateGardenScene(round);
    const byIdA = new Map(scene.elementsA.map((e) => [e.id, e]));
    const byIdB = new Map(scene.elementsB.map((e) => [e.id, e]));

    for (const element of [...scene.elementsA, ...scene.elementsB]) {
      assert.ok(element.lx >= 0 && element.lx <= 1, "lxが範囲内");
      assert.ok(element.ly >= 0 && element.ly <= 1, "lyが範囲内");
      assert.ok(PALETTES[element.type].length > element.colorIndex, "colorIndexがパレット内");
    }

    for (const diff of scene.differences) {
      const a = byIdA.get(diff.elementId);
      const b = byIdB.get(diff.elementId);
      assert.ok(a && b, "差分要素はA/B双方に存在する");
      if (!a || !b) continue;

      switch (diff.mutation) {
        case "recolor":
          assert.notEqual(b.colorIndex, a.colorIndex, "色が変わっている");
          break;
        case "resize":
          assert.notEqual(b.size, a.size, "大きさが変わっている");
          break;
        case "move":
          assert.ok(Math.hypot(b.lx - a.lx, b.ly - a.ly) > 1e-6, "位置が変わっている");
          break;
        case "vanish":
          assert.equal(a.isVisible, true, "Aには存在する");
          assert.equal(b.isVisible, false, "Bでは消えている");
          break;
      }
    }

    // 差分として選ばれていない要素はA/Bで完全に一致している
    const diffIds = new Set(scene.differences.map((d) => d.elementId));
    for (const a of scene.elementsA) {
      if (diffIds.has(a.id)) continue;
      const b = byIdB.get(a.id);
      assert.deepEqual(b, a, "差分でない要素はA/Bで同一");
    }
  }
});

test("要素数より多い差分は要求できない(差分数が要素数でクランプされる)", () => {
  // 低いラウンドでは要素数(9) > 差分数(3)なので重複はしないはずだが、
  // 将来の調整ミスで差分数が要素数を超えないことを保証しておく。
  for (let round = 1; round <= 40; round++) {
    const scene = generateGardenScene(round);
    assert.ok(scene.differences.length <= scene.elementsA.length);
    const ids = scene.differences.map((d) => d.elementId);
    assert.equal(new Set(ids).size, ids.length, "差分の対象要素は重複しない");
  }
});
