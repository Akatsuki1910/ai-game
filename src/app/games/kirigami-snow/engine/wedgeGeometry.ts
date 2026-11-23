/**
 * 8分割(45度ずつ)に折った正方形の紙の、1ウェッジ(扇形の1/8)ぶんの幾何計算。
 * 半径は 0(中心)〜1(外周) に正規化してあるため、描画側はこの値に
 * 好きなピクセル半径を掛けるだけで済み、当たり判定もこの正規化座標系で行える。
 */

/** ウェッジの開き角(ラジアン)。360度 / 8分割 = 45度。 */
export const SECTOR_ANGLE = Math.PI / 4;

/** 折り目の中心にできる、セルを置かない小さな穴の半径比率。 */
export const INNER_RADIUS_RATIO = 0.12;

export interface CellBounds {
  innerRadius: number;
  outerRadius: number;
  angleStart: number;
  angleEnd: number;
}

/** 行数(リング数)から、リング1本あたりの半径の厚みを求める。 */
export function ringHeight(rowCount: number): number {
  return (1 - INNER_RADIUS_RATIO) / rowCount;
}

/**
 * セル(row, col)の境界を求める。row は中心から外周へ 0 始まりのリング番号、
 * col はそのリングを (row + 1) 等分したときの角度方向のスロット番号。
 * リングが外側になるほどスロット数が増えるため、各セルの弧の長さがおおよそ揃う。
 */
export function cellBounds(row: number, col: number, rowCount: number): CellBounds {
  const rh = ringHeight(rowCount);
  const innerRadius = INNER_RADIUS_RATIO + row * rh;
  const outerRadius = innerRadius + rh;
  const slots = row + 1;
  const angleStart = (col / slots) * SECTOR_ANGLE;
  const angleEnd = ((col + 1) / slots) * SECTOR_ANGLE;
  return { innerRadius, outerRadius, angleStart, angleEnd };
}

/**
 * 正規化ローカル座標(原点=折り目の中心、x軸方向が角度0)から、
 * 対応するセルの row/col を求める。ウェッジの外側(穴の中・外周の外・角度の外)なら null。
 */
export function findCellAtPoint(
  x: number,
  y: number,
  rowCount: number,
): { row: number; col: number } | null {
  const radius = Math.hypot(x, y);
  if (radius < INNER_RADIUS_RATIO || radius > 1) return null;

  let angle = Math.atan2(y, x);
  if (angle < 0) angle += Math.PI * 2;
  if (angle > SECTOR_ANGLE) return null;

  const rh = ringHeight(rowCount);
  const row = Math.min(rowCount - 1, Math.floor((radius - INNER_RADIUS_RATIO) / rh));
  const slots = row + 1;
  const col = Math.min(slots - 1, Math.floor((angle / SECTOR_ANGLE) * slots));
  return { row, col };
}

/** セルの境界の中点(ローカル座標)。テストや当たり判定の確認に使う。 */
export function cellMidpoint(row: number, col: number, rowCount: number): { x: number; y: number } {
  const b = cellBounds(row, col, rowCount);
  const radius = (b.innerRadius + b.outerRadius) / 2;
  const angle = (b.angleStart + b.angleEnd) / 2;
  return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
}
