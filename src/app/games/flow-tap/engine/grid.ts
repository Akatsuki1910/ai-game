export type Direction = 0 | 1 | 2 | 3;

export const NORTH: Direction = 0;
export const EAST: Direction = 1;
export const SOUTH: Direction = 2;
export const WEST: Direction = 3;
export const DIRECTIONS: readonly Direction[] = [NORTH, EAST, SOUTH, WEST];

const DIRECTION_VECTORS: ReadonlyArray<{ readonly dx: number; readonly dy: number }> = [
  { dx: 0, dy: -1 }, // NORTH
  { dx: 1, dy: 0 }, // EAST
  { dx: 0, dy: 1 }, // SOUTH
  { dx: -1, dy: 0 }, // WEST
];

export interface GridCoord {
  readonly col: number;
  readonly row: number;
}

export type PipeShape = "straight" | "elbow";

export interface PipeCell {
  readonly shape: PipeShape;
  readonly rotation: 0 | 1 | 2 | 3;
}

const BASE_PORTS: Readonly<Record<PipeShape, readonly [Direction, Direction]>> = {
  straight: [NORTH, SOUTH],
  elbow: [NORTH, EAST],
};

export function opposite(direction: Direction): Direction {
  return ((direction + 2) % 4) as Direction;
}

export function directionVector(direction: Direction): { dx: number; dy: number } {
  return DIRECTION_VECTORS[direction];
}

export function stepCoord(coord: GridCoord, direction: Direction): GridCoord {
  const { dx, dy } = directionVector(direction);
  return { col: coord.col + dx, row: coord.row + dy };
}

export function isWithinGrid(coord: GridCoord, cols: number, rows: number): boolean {
  return coord.col >= 0 && coord.col < cols && coord.row >= 0 && coord.row < rows;
}

export function sameCoord(a: GridCoord, b: GridCoord): boolean {
  return a.col === b.col && a.row === b.row;
}

/** 隣接する2マス間の方角（a から見て b がある方角）。 */
export function directionBetween(a: GridCoord, b: GridCoord): Direction {
  if (b.col > a.col) return EAST;
  if (b.col < a.col) return WEST;
  if (b.row > a.row) return SOUTH;
  return NORTH;
}

function rotateDirection(direction: Direction, rotation: number): Direction {
  return ((direction + rotation) % 4) as Direction;
}

/** 現在の回転を反映した、そのパイプが実際に繋がっている2方向。 */
export function getPorts(cell: PipeCell): [Direction, Direction] {
  const [a, b] = BASE_PORTS[cell.shape];
  return [rotateDirection(a, cell.rotation), rotateDirection(b, cell.rotation)];
}

/** パイプを90°回転させた新しいセルを返す（元のセルは変更しない）。 */
export function rotatePipe(cell: PipeCell): PipeCell {
  return { shape: cell.shape, rotation: ((cell.rotation + 1) % 4) as 0 | 1 | 2 | 3 };
}

/** 入口・出口の方角の組から、それを実現できるパイプの形（直線か曲がりか）を決める。 */
export function shapeForPorts(entry: Direction, exit: Direction): PipeShape {
  return entry === opposite(exit) ? "straight" : "elbow";
}

/**
 * 経路（source から sink までのマスの並び）の index 番目のマスで、
 * 水流が入ってくる方角（entry）と出ていく方角（exit）を求める。
 * 先頭マスの entry は source からの流入方角、末尾マスの exit は sink への流出方角で決まる。
 */
export function pathEntryExitPorts(
  path: readonly GridCoord[],
  index: number,
  sourceDir: Direction,
  sinkDir: Direction,
): [Direction, Direction] {
  const coord = path[index];
  const prev = index > 0 ? path[index - 1] : null;
  const next = index < path.length - 1 ? path[index + 1] : null;
  const entry = prev ? opposite(directionBetween(prev, coord)) : opposite(sourceDir);
  const exit = next ? directionBetween(coord, next) : sinkDir;
  return [entry, exit];
}

export interface GeneratedLevel {
  readonly cells: PipeCell[][];
  readonly path: readonly GridCoord[];
}

/**
 * source から sink まで、東(East)・南(South)方向だけで進む単調な経路を1本生成し、
 * 経路上のマスには正しい形（直線/曲がり）のパイプを、それ以外のマスには完全ランダムな
 * パイプを配置する。経路上のパイプも回転は毎回ランダムなので、最初から正解の向きとは限らない。
 */
export function generateLevel(
  cols: number,
  rows: number,
  source: GridCoord,
  sourceDir: Direction,
  sink: GridCoord,
  sinkDir: Direction,
  random: () => number = Math.random,
): GeneratedLevel {
  const path: GridCoord[] = [source];
  let current = source;
  while (!sameCoord(current, sink)) {
    const canMoveEast = current.col < sink.col;
    const canMoveSouth = current.row < sink.row;
    let moveDir: Direction;
    if (canMoveEast && canMoveSouth) {
      moveDir = random() < 0.5 ? EAST : SOUTH;
    } else if (canMoveEast) {
      moveDir = EAST;
    } else {
      moveDir = SOUTH;
    }
    current = stepCoord(current, moveDir);
    path.push(current);
  }

  const cells: PipeCell[][] = [];
  for (let row = 0; row < rows; row++) {
    const line: PipeCell[] = [];
    for (let col = 0; col < cols; col++) {
      line.push({
        shape: random() < 0.5 ? "straight" : "elbow",
        rotation: Math.floor(random() * 4) as 0 | 1 | 2 | 3,
      });
    }
    cells.push(line);
  }

  for (let index = 0; index < path.length; index++) {
    const coord = path[index];
    const [entry, exit] = pathEntryExitPorts(path, index, sourceDir, sinkDir);
    cells[coord.row][coord.col] = {
      shape: shapeForPorts(entry, exit),
      rotation: Math.floor(random() * 4) as 0 | 1 | 2 | 3,
    };
  }

  return { cells, path };
}
