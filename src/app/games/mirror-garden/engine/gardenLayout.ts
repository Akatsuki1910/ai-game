/**
 * 2枚の庭パネル(A/B)をステージの寸法から配置するための純粋な幾何ロジック。
 * 横長なら左右に並べ、縦長(スマホ縦持ち)なら上下に重ねることで
 * 画面の向きが変わっても両方のパネルが常に見える形を保つ。
 */

export type PanelId = "a" | "b";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LocalPoint {
  lx: number;
  ly: number;
}

/** パネル間の隙間。短辺に対する比率。 */
const GUTTER_FRACTION = 0.04;

const EMPTY_RECT: Rect = { x: 0, y: 0, width: 0, height: 0 };

export function getPanelRects(width: number, height: number): Record<PanelId, Rect> {
  if (width <= 0 || height <= 0) {
    return { a: EMPTY_RECT, b: EMPTY_RECT };
  }

  if (width >= height) {
    const gutter = width * GUTTER_FRACTION;
    const panelWidth = (width - gutter) / 2;
    return {
      a: { x: 0, y: 0, width: panelWidth, height },
      b: { x: panelWidth + gutter, y: 0, width: panelWidth, height },
    };
  }

  const gutter = height * GUTTER_FRACTION;
  const panelHeight = (height - gutter) / 2;
  return {
    a: { x: 0, y: 0, width, height: panelHeight },
    b: { x: 0, y: panelHeight + gutter, width, height: panelHeight },
  };
}

/** パネル内の正規化座標(0..1)をステージ絶対座標に変換する。 */
export function toAbsolute(rect: Rect, point: LocalPoint): { x: number; y: number } {
  return { x: rect.x + point.lx * rect.width, y: rect.y + point.ly * rect.height };
}

/** ステージ絶対座標がパネル内にあれば正規化座標を返す。範囲外は null。 */
export function toLocalIfInside(rect: Rect, x: number, y: number): LocalPoint | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  if (x < rect.x || x > rect.x + rect.width) return null;
  if (y < rect.y || y > rect.y + rect.height) return null;
  return { lx: (x - rect.x) / rect.width, ly: (y - rect.y) / rect.height };
}
