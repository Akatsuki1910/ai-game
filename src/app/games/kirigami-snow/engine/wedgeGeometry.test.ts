import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cellBounds,
  cellMidpoint,
  findCellAtPoint,
  INNER_RADIUS_RATIO,
  ringHeight,
  SECTOR_ANGLE,
} from "./wedgeGeometry.ts";

test("ringHeight: 行数で等分したリングの厚みになる", () => {
  assert.equal(ringHeight(4), (1 - INNER_RADIUS_RATIO) / 4);
});

test("cellBounds: 最内リング(row=0)は中心の穴からリング1本分の厚みを持つ", () => {
  const bounds = cellBounds(0, 0, 3);
  assert.equal(bounds.innerRadius, INNER_RADIUS_RATIO);
  assert.equal(bounds.outerRadius, INNER_RADIUS_RATIO + ringHeight(3));
  assert.equal(bounds.angleStart, 0);
  assert.equal(bounds.angleEnd, SECTOR_ANGLE);
});

test("cellBounds: 外側のリングほどスロット数が増え、角度を等分する", () => {
  const first = cellBounds(2, 0, 3);
  const second = cellBounds(2, 1, 3);
  const third = cellBounds(2, 2, 3);

  assert.equal(first.angleStart, 0);
  assert.equal(first.angleEnd, SECTOR_ANGLE / 3);
  assert.equal(second.angleStart, SECTOR_ANGLE / 3);
  assert.equal(second.angleEnd, (SECTOR_ANGLE / 3) * 2);
  assert.equal(third.angleStart, (SECTOR_ANGLE / 3) * 2);
  assert.equal(third.angleEnd, SECTOR_ANGLE);
});

test("findCellAtPoint: セルの中点はそのセル自身に当たる", () => {
  const rowCount = 4;
  for (let row = 0; row < rowCount; row++) {
    for (let col = 0; col <= row; col++) {
      const mid = cellMidpoint(row, col, rowCount);
      assert.deepEqual(
        findCellAtPoint(mid.x, mid.y, rowCount),
        { row, col },
        `row=${row}, col=${col} の中点が自分自身に当たる`,
      );
    }
  }
});

test("findCellAtPoint: 中心の穴の中は null", () => {
  assert.equal(findCellAtPoint(0, 0, 3), null);
  assert.equal(findCellAtPoint(0.01, 0.01, 3), null);
});

test("findCellAtPoint: 外周より外は null", () => {
  assert.equal(findCellAtPoint(1.2, 0.1, 3), null);
});

test("findCellAtPoint: 開き角の外(負の角度・開き角を超える角度)は null", () => {
  assert.equal(findCellAtPoint(0.5, -0.1, 3), null, "開き角の手前(角度が負)");
  const angle = SECTOR_ANGLE + 0.1;
  const outside = { x: 0.5 * Math.cos(angle), y: 0.5 * Math.sin(angle) };
  assert.equal(findCellAtPoint(outside.x, outside.y, 3), null, "開き角の先");
});

test("findCellAtPoint: 外周ちょうど(半径1)は有効なセルとして扱う", () => {
  const mid = cellMidpoint(2, 1, 3);
  const angle = Math.atan2(mid.y, mid.x);
  assert.deepEqual(findCellAtPoint(Math.cos(angle), Math.sin(angle), 3), { row: 2, col: 1 });
});
