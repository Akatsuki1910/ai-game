/**
 * 「2つの庭(A/B)」の要素配置と、そのうちいくつかに紛れ込ませる差分を生成する純粋ロジック。
 * ラウンド番号から要素数・差分数・差分の分かりやすさが決まり、ラウンドが進むほど
 * 要素が増え、差分の見た目の変化(色/大きさ/位置のズレ)が小さくなっていく。
 */

export const ELEMENT_TYPES = ["stone", "lantern", "bush", "koi", "bridge"] as const;
export type ElementType = (typeof ELEMENT_TYPES)[number];

export const MUTATION_KINDS = ["recolor", "resize", "move", "vanish"] as const;
export type MutationKind = (typeof MUTATION_KINDS)[number];

export const PALETTES: Readonly<Record<ElementType, readonly number[]>> = {
  stone: [0x9aa0a6, 0xb8bdbf, 0x7d8286, 0xc9a66b],
  lantern: [0xffb454, 0xff8a3d, 0xffe066, 0xff6b6b],
  bush: [0x4caf6b, 0x6fbf73, 0x3f8f52, 0x8bc98f],
  koi: [0xff7043, 0xffd166, 0x2c2c2c, 0xf2f3f5],
  bridge: [0x8a5a3b, 0x6b4226, 0xa9764c, 0x5c3a21],
};

export interface GardenElement {
  id: number;
  type: ElementType;
  /** パネル内の正規化座標(0..1)。 */
  lx: number;
  ly: number;
  /** パネルの短辺に対する比率で表した大きさ。 */
  size: number;
  colorIndex: number;
  isVisible: boolean;
}

export interface DifferenceSpot {
  elementId: number;
  mutation: MutationKind;
  isFound: boolean;
}

export interface GardenScene {
  elementsA: GardenElement[];
  elementsB: GardenElement[];
  differences: DifferenceSpot[];
}

const GRID_COLS = 4;
const GRID_ROWS = 4;
const CELL_MARGIN = 0.14;
const CELL_JITTER = 0.05;

const BASE_ELEMENT_COUNT = 9;
const MAX_ELEMENT_COUNT = Math.min(14, GRID_COLS * GRID_ROWS);
const ELEMENT_COUNT_ROUND_STEP = 3;

const BASE_DIFFERENCE_COUNT = 3;
const MAX_DIFFERENCE_COUNT = 6;
const DIFFERENCE_COUNT_ROUND_STEP = 2;

export const BASE_SIZE = 0.11;
const MIN_SIZE = 0.05;
const MAX_SIZE = 0.2;

const RESIZE_DELTA_BASE = 0.42;
const RESIZE_DELTA_MIN = 0.18;
const RESIZE_DELTA_STEP = 0.02;

const MOVE_DELTA_BASE = 0.18;
const MOVE_DELTA_MIN = 0.08;
const MOVE_DELTA_STEP = 0.008;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function totalElementCount(round: number): number {
  return Math.min(
    MAX_ELEMENT_COUNT,
    BASE_ELEMENT_COUNT + Math.floor((round - 1) / ELEMENT_COUNT_ROUND_STEP),
  );
}

export function differenceCount(round: number): number {
  return Math.min(
    MAX_DIFFERENCE_COUNT,
    BASE_DIFFERENCE_COUNT + Math.floor((round - 1) / DIFFERENCE_COUNT_ROUND_STEP),
  );
}

export function resizeMagnitude(round: number): number {
  return Math.max(RESIZE_DELTA_MIN, RESIZE_DELTA_BASE - (round - 1) * RESIZE_DELTA_STEP);
}

export function moveMagnitude(round: number): number {
  return Math.max(MOVE_DELTA_MIN, MOVE_DELTA_BASE - (round - 1) * MOVE_DELTA_STEP);
}

/** グリッドのセルをシャッフルし、先頭からcount個分だけジッター付きの正規化座標を返す。 */
function pickShuffledCells(count: number): { lx: number; ly: number }[] {
  const cells: { lx: number; ly: number }[] = [];
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      cells.push({
        lx: CELL_MARGIN + (col / (GRID_COLS - 1)) * (1 - CELL_MARGIN * 2),
        ly: CELL_MARGIN + (row / (GRID_ROWS - 1)) * (1 - CELL_MARGIN * 2),
      });
    }
  }

  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }

  return cells.slice(0, count).map((cell) => ({
    lx: clamp(cell.lx + (Math.random() * 2 - 1) * CELL_JITTER, 0.02, 0.98),
    ly: clamp(cell.ly + (Math.random() * 2 - 1) * CELL_JITTER, 0.02, 0.98),
  }));
}

/** 0..exclusive-1 の中からcount個の相異なる整数を選ぶ。 */
function pickDistinctIndices(exclusive: number, count: number): number[] {
  const indices = Array.from({ length: exclusive }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices.slice(0, count);
}

function applyMutation(
  kind: MutationKind,
  original: GardenElement,
  mutated: GardenElement,
  magnitude: { resizeDelta: number; moveDelta: number },
): void {
  switch (kind) {
    case "recolor": {
      const palette = PALETTES[original.type];
      let nextIndex = original.colorIndex;
      while (nextIndex === original.colorIndex) {
        nextIndex = Math.floor(Math.random() * palette.length);
      }
      mutated.colorIndex = nextIndex;
      return;
    }
    case "resize": {
      const sign = Math.random() < 0.5 ? -1 : 1;
      mutated.size = clamp(original.size * (1 + sign * magnitude.resizeDelta), MIN_SIZE, MAX_SIZE);
      return;
    }
    case "move": {
      const angle = Math.random() * Math.PI * 2;
      mutated.lx = clamp(
        original.lx + Math.cos(angle) * magnitude.moveDelta,
        CELL_MARGIN * 0.5,
        1 - CELL_MARGIN * 0.5,
      );
      mutated.ly = clamp(
        original.ly + Math.sin(angle) * magnitude.moveDelta,
        CELL_MARGIN * 0.5,
        1 - CELL_MARGIN * 0.5,
      );
      return;
    }
    case "vanish": {
      mutated.isVisible = false;
      return;
    }
  }
}

let nextElementId = 1;

export function generateGardenScene(round: number): GardenScene {
  const total = totalElementCount(round);
  const cells = pickShuffledCells(total);

  const elementsA: GardenElement[] = cells.map((cell) => {
    const type = ELEMENT_TYPES[Math.floor(Math.random() * ELEMENT_TYPES.length)];
    const palette = PALETTES[type];
    return {
      id: nextElementId++,
      type,
      lx: cell.lx,
      ly: cell.ly,
      size: BASE_SIZE,
      colorIndex: Math.floor(Math.random() * palette.length),
      isVisible: true,
    };
  });

  const elementsB: GardenElement[] = elementsA.map((element) => ({ ...element }));

  const diffCount = Math.min(differenceCount(round), total);
  const diffElementIndexes = pickDistinctIndices(total, diffCount);
  const magnitude = { resizeDelta: resizeMagnitude(round), moveDelta: moveMagnitude(round) };

  const differences: DifferenceSpot[] = diffElementIndexes.map((index) => {
    const mutation = MUTATION_KINDS[Math.floor(Math.random() * MUTATION_KINDS.length)];
    applyMutation(mutation, elementsA[index], elementsB[index], magnitude);
    return { elementId: elementsA[index].id, mutation, isFound: false };
  });

  return { elementsA, elementsB, differences };
}
