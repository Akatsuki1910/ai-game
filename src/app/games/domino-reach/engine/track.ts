import { DOMINO_REACH } from "./chain.ts";

export interface Pit {
  readonly start: number;
  readonly end: number;
}

export interface TrackConfig {
  readonly length: number;
  readonly pits: readonly Pit[];
}

export interface Inventory {
  readonly standard: number;
  readonly booster: number;
}

const BASE_LENGTH = 600;
const LENGTH_PER_STAGE = 80;
const MAX_LENGTH = 1400;
/** スタート/ゴール付近はピットを置かず、常に足場を確保する。 */
const SAFE_MARGIN = 80;
const PIT_MIN_WIDTH = 50;
const PIT_MAX_WIDTH = 100;
const PIT_SEGMENT_PADDING = 20;
const STANDARD_INVENTORY_SLACK = 4;
const BOOSTER_INVENTORY_SLACK = 2;

export function trackLengthForStage(stage: number): number {
  return Math.min(BASE_LENGTH + (stage - 1) * LENGTH_PER_STAGE, MAX_LENGTH);
}

/** ステージ1はピット無しのチュートリアル。以降、徐々にピットが増える。 */
export function pitCountForStage(stage: number): number {
  if (stage <= 1) return 0;
  return Math.min(2 + Math.floor((stage - 2) / 2), 6);
}

/** 決定的な疑似乱数生成器(mulberry32)。ステージ番号から種を作り再現性を持たせる。 */
export function createSeededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * ステージの溝(ピット)配置を生成する。
 * 既定の rng はステージ番号から決定的に種付けされるため、同じステージは常に同じ
 * 配置になる(真の乱数ではない)。これにより配置の再現性が保たれ、同じ難易度の
 * 再挑戦や検証がしやすくなる。rng を注入すればテストでも任意の配置を検証できる。
 */
export function createTrack(
  stage: number,
  rng: () => number = createSeededRandom(stage * 97 + 13),
): TrackConfig {
  const length = trackLengthForStage(stage);
  const pitCount = pitCountForStage(stage);
  if (pitCount <= 0) return { length, pits: [] };

  const usableStart = SAFE_MARGIN;
  const usableEnd = length - SAFE_MARGIN;
  const segment = (usableEnd - usableStart) / pitCount;

  const pits: Pit[] = [];
  for (let i = 0; i < pitCount; i++) {
    const segmentStart = usableStart + i * segment;
    const maxWidth = Math.max(10, segment - PIT_SEGMENT_PADDING * 2);
    const width = Math.min(PIT_MIN_WIDTH + rng() * (PIT_MAX_WIDTH - PIT_MIN_WIDTH), maxWidth);
    const slack = Math.max(0, segment - PIT_SEGMENT_PADDING * 2 - width);
    const start = segmentStart + PIT_SEGMENT_PADDING + rng() * slack;
    pits.push({ start, end: start + width });
  }

  return { length, pits };
}

/** そのステージを渡り切るのに配られるドミノの在庫。やや余裕を持たせてある。 */
export function inventoryFor(track: TrackConfig): Inventory {
  const standard = Math.ceil(track.length / DOMINO_REACH.standard) + STANDARD_INVENTORY_SLACK;
  const booster = track.pits.length + BOOSTER_INVENTORY_SLACK;
  return { standard, booster };
}
