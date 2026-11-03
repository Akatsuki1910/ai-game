import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compareGlyphPaths,
  generateGlyphPath,
  type Point,
  pathLength,
  resamplePath,
  trimPathToLength,
} from "./path.ts";

test("pathLength: 点が2つなら辺の長さそのもの", () => {
  const points: Point[] = [
    { x: 0, y: 0 },
    { x: 3, y: 4 },
  ];
  assert.equal(pathLength(points), 5);
});

test("pathLength: 点が1つ以下なら0", () => {
  assert.equal(pathLength([]), 0);
  assert.equal(pathLength([{ x: 1, y: 1 }]), 0);
});

test("resamplePath: 直線を等間隔に再標本化できる", () => {
  const points: Point[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
  ];
  const resampled = resamplePath(points, 5);
  assert.equal(resampled.length, 5);
  assert.deepEqual(resampled[0], { x: 0, y: 0 });
  assert.deepEqual(resampled[resampled.length - 1], { x: 10, y: 0 });
  assert.ok(Math.abs(resampled[2].x - 5) < 1e-6, "中点が弧長の中央に来る");
});

test("resamplePath: 折れ線でも全長を保ったまま等間隔に割れる", () => {
  const points: Point[] = [
    { x: 0, y: 0 },
    { x: 0, y: 10 },
    { x: 10, y: 10 },
  ];
  const resampled = resamplePath(points, 3);
  assert.equal(resampled.length, 3);
  assert.deepEqual(resampled[0], { x: 0, y: 0 });
  assert.deepEqual(resampled[2], { x: 10, y: 10 });
  // 全長20の中間地点(弧長10)はちょうど折れ目の (0, 10)
  assert.ok(Math.abs(resampled[1].x - 0) < 1e-6);
  assert.ok(Math.abs(resampled[1].y - 10) < 1e-6);
});

test("resamplePath: 退化した(長さ0の)経路は同じ点を返す", () => {
  const points: Point[] = [
    { x: 5, y: 5 },
    { x: 5, y: 5 },
  ];
  const resampled = resamplePath(points, 4);
  assert.equal(resampled.length, 4);
  for (const p of resampled) assert.deepEqual(p, { x: 5, y: 5 });
});

test("compareGlyphPaths: 完全に一致する軌跡は高得点になる", () => {
  const target: Point[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ];
  const score = compareGlyphPaths(target, target, 200);
  assert.ok(score > 95, `同じ形はほぼ満点になるはず: ${score}`);
});

test("compareGlyphPaths: 全く違う場所になぞると低得点になる", () => {
  const target: Point[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ];
  const farAway: Point[] = [
    { x: 900, y: 900 },
    { x: 905, y: 900 },
  ];
  const score = compareGlyphPaths(target, farAway, 200);
  assert.ok(score < 20, `かけ離れた位置の線は低得点になるはず: ${score}`);
});

test("compareGlyphPaths: なぞった長さが短すぎると減点される", () => {
  const target: Point[] = [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
  ];
  const full: Point[] = [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
  ];
  const short: Point[] = [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
  ];
  const fullScore = compareGlyphPaths(target, full, 200);
  const shortScore = compareGlyphPaths(target, short, 200);
  assert.ok(shortScore < fullScore, "途中で終わるなぞりはフルになぞるより低得点");
});

test("compareGlyphPaths: 点が足りない/幅0は0点（壊れない）", () => {
  assert.equal(compareGlyphPaths([], [], 200), 0);
  assert.equal(compareGlyphPaths([{ x: 0, y: 0 }], [{ x: 0, y: 0 }], 200), 0);
  assert.equal(
    compareGlyphPaths(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      0,
    ),
    0,
  );
});

test("generateGlyphPath: 指定した辺数ぶんの点が、余白内に収まって生成される", () => {
  const width = 800;
  const height = 400;
  const path = generateGlyphPath(width, height, 6);

  assert.equal(path.length, 7, "開始点 + セグメント数ぶんの点がある");
  for (const p of path) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), "座標が有限値");
    assert.ok(p.x >= 0 && p.x <= width, "横方向が画面内");
    assert.ok(p.y >= 0 && p.y <= height, "縦方向が画面内");
  }
  assert.ok(pathLength(path) > 0, "長さを持った形になっている");
});

test("trimPathToLength: 途中の弧長でちょうど切り出せる", () => {
  const points: Point[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ];
  const trimmed = trimPathToLength(points, 15);
  assert.deepEqual(trimmed, [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 5 },
  ]);
});

test("trimPathToLength: 0以下なら空、全長以上なら元の形のまま", () => {
  const points: Point[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
  ];
  assert.deepEqual(trimPathToLength(points, 0), []);
  assert.deepEqual(trimPathToLength(points, 1000), points);
});

test("generateGlyphPath: セグメント数を増やすと複雑な(点数の多い)形になる", () => {
  const simple = generateGlyphPath(800, 400, 3);
  const complex = generateGlyphPath(800, 400, 8);
  assert.ok(complex.length > simple.length);
});
