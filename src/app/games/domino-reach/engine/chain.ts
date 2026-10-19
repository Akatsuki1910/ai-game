export interface PlacedDomino {
  readonly id: string;
  readonly x: number;
  readonly isBooster: boolean;
}

export interface ToppleEvent {
  readonly id: string;
  readonly x: number;
  readonly isBooster: boolean;
}

export interface ChainResult {
  readonly timeline: readonly ToppleEvent[];
  readonly reachedGoal: boolean;
  readonly frontier: number;
}

/** 標準/ブースタードミノが倒れたときに次のドミノへ届く射程(ワールド単位)。 */
export const DOMINO_REACH = { standard: 88, booster: 154 } as const;

/** スタート地点の起爆装置そのものが持つ射程。最初の1枚はここまで緩める。 */
export const START_REACH = 120;

export function reachOf(domino: Pick<PlacedDomino, "isBooster">): number {
  return domino.isBooster ? DOMINO_REACH.booster : DOMINO_REACH.standard;
}

/**
 * 置かれたドミノを連鎖させ、ゴール座標まで届くかを判定する純粋な物理シミュレーション。
 * x昇順に処理し、「直前に倒れたドミノの射程(frontier)の内側にあるドミノだけが倒れ続ける」
 * というルールを再帰なしで畳み込む。sorted配列はx昇順のため、射程外に出た時点で
 * それ以降のドミノも全て射程外であることが保証され、安全にループを打ち切れる。
 */
export function simulateChain(dominoes: readonly PlacedDomino[], goalX: number): ChainResult {
  const sorted = [...dominoes].sort((a, b) => a.x - b.x);
  let frontier = START_REACH;
  const timeline: ToppleEvent[] = [];

  for (const domino of sorted) {
    if (domino.x > frontier) break;
    timeline.push({ id: domino.id, x: domino.x, isBooster: domino.isBooster });
    frontier = Math.max(frontier, domino.x + reachOf(domino));
    if (frontier >= goalX) break;
  }

  return { timeline, reachedGoal: frontier >= goalX, frontier };
}
