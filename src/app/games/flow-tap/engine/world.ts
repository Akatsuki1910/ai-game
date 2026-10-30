import {
  type Direction,
  EAST,
  type GridCoord,
  generateLevel,
  getPorts,
  isWithinGrid,
  opposite,
  type PipeCell,
  rotatePipe,
  stepCoord,
} from "./grid.ts";

export const GRID_COLS = 6;
export const GRID_ROWS = 5;
export const INITIAL_LIVES = 3;
export const DELIVERIES_PER_WAVE = 5;

export const BASE_DROPLET_SPEED = 0.85;
export const MAX_DROPLET_SPEED = 2.2;
export const SPEED_GROWTH_PER_WAVE = 1.12;

export const BASE_SPAWN_INTERVAL = 2.4;
export const MIN_SPAWN_INTERVAL = 0.9;
export const SPAWN_SHRINK_PER_WAVE = 0.92;

export const BASE_JAM_INTERVAL = 5.5;
export const MIN_JAM_INTERVAL = 1.6;
export const JAM_SHRINK_PER_WAVE = 0.88;

const INITIAL_SPAWN_DELAY = 0.8;

export const SOURCE: GridCoord = { col: 0, row: 0 };
export const SOURCE_DIR: Direction = EAST;
export const SINK: GridCoord = { col: GRID_COLS - 1, row: GRID_ROWS - 1 };
export const SINK_DIR: Direction = EAST;

export interface Droplet {
  id: number;
  col: number;
  row: number;
  travelDir: Direction;
  progress: number;
}

export interface FlowEvent {
  col: number;
  row: number;
  scoreGained: number;
  combo: number;
}

export interface JamEvent {
  col: number;
  row: number;
}

/**
 * パイプを回転させて水流を source から sink へ届け続けるリアルタイムパズル。
 * 経路は毎ウェーブ再生成され、一定間隔で無関係な1マスが自動的に回転してしまう
 * 「ジャム」が起きるため、一度正解に合わせても油断すると漏水してライフが減る。
 */
export class FlowTapWorld {
  readonly cols = GRID_COLS;
  readonly rows = GRID_ROWS;
  readonly source = SOURCE;
  readonly sourceDir = SOURCE_DIR;
  readonly sink = SINK;
  readonly sinkDir = SINK_DIR;

  grid: PipeCell[][] = [];
  path: readonly GridCoord[] = [];
  droplets: Droplet[] = [];
  score = 0;
  lives = INITIAL_LIVES;
  combo = 0;
  wave = 1;
  deliveriesInWave = 0;
  isOver = false;

  dropletSpeed = BASE_DROPLET_SPEED;
  spawnInterval = BASE_SPAWN_INTERVAL;
  jamInterval = BASE_JAM_INTERVAL;

  onDelivered: ((event: FlowEvent) => void) | null = null;
  onLeak: ((event: FlowEvent) => void) | null = null;
  onJam: ((event: JamEvent) => void) | null = null;
  onWaveAdvance: ((wave: number) => void) | null = null;

  private spawnTimer = INITIAL_SPAWN_DELAY;
  private jamTimer = BASE_JAM_INTERVAL;
  private nextDropletId = 1;
  private readonly random: () => number;

  constructor(random: () => number = Math.random) {
    this.random = random;
    this.reset();
  }

  reset(): void {
    this.score = 0;
    this.lives = INITIAL_LIVES;
    this.combo = 0;
    this.wave = 1;
    this.deliveriesInWave = 0;
    this.isOver = false;
    this.dropletSpeed = BASE_DROPLET_SPEED;
    this.spawnInterval = BASE_SPAWN_INTERVAL;
    this.jamInterval = BASE_JAM_INTERVAL;
    this.spawnTimer = INITIAL_SPAWN_DELAY;
    this.jamTimer = this.jamInterval;
    this.droplets = [];
    this.nextDropletId = 1;
    this.regenerateGrid();
  }

  rotateCellAt(col: number, row: number): void {
    if (this.isOver) return;
    if (!isWithinGrid({ col, row }, this.cols, this.rows)) return;
    this.grid[row][col] = rotatePipe(this.grid[row][col]);
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    this.jamTimer -= deltaSeconds;
    if (this.jamTimer <= 0) {
      this.triggerJam();
      this.jamTimer = this.jamInterval;
    }

    this.spawnTimer -= deltaSeconds;
    if (this.spawnTimer <= 0) {
      this.spawnDroplet();
      this.spawnTimer = this.spawnInterval;
    }

    const remaining: Droplet[] = [];
    for (const droplet of this.droplets) {
      if (this.advanceDroplet(droplet, deltaSeconds)) remaining.push(droplet);
    }
    this.droplets = remaining;
  }

  private regenerateGrid(): void {
    const level = generateLevel(
      this.cols,
      this.rows,
      this.source,
      this.sourceDir,
      this.sink,
      this.sinkDir,
      this.random,
    );
    this.grid = level.cells;
    this.path = level.path;
  }

  private spawnDroplet(): void {
    this.droplets = [
      ...this.droplets,
      {
        id: this.nextDropletId++,
        col: this.source.col,
        row: this.source.row,
        travelDir: this.sourceDir,
        progress: 0,
      },
    ];
  }

  private triggerJam(): void {
    const col = Math.floor(this.random() * this.cols);
    const row = Math.floor(this.random() * this.rows);
    const steps = 1 + Math.floor(this.random() * 3);
    for (let i = 0; i < steps; i++) {
      this.grid[row][col] = rotatePipe(this.grid[row][col]);
    }
    this.onJam?.({ col, row });
  }

  /** true を返す間はそのドロップレットがまだ生きている（配列に残す）。 */
  private advanceDroplet(droplet: Droplet, deltaSeconds: number): boolean {
    droplet.progress += deltaSeconds * this.dropletSpeed;

    let guard = 0;
    const maxSteps = this.cols + this.rows + 4;
    while (droplet.progress >= 1 && guard < maxSteps) {
      guard++;
      const cell = this.grid[droplet.row]?.[droplet.col];
      if (!cell) {
        this.resolveLeak(droplet);
        return false;
      }

      const entryPort = opposite(droplet.travelDir);
      const ports = getPorts(cell);
      if (!ports.includes(entryPort)) {
        this.resolveLeak(droplet);
        return false;
      }

      const exitPort = ports[0] === entryPort ? ports[1] : ports[0];
      const next = stepCoord({ col: droplet.col, row: droplet.row }, exitPort);

      if (!isWithinGrid(next, this.cols, this.rows)) {
        const isSinkExit =
          droplet.col === this.sink.col &&
          droplet.row === this.sink.row &&
          exitPort === this.sinkDir;
        if (isSinkExit) {
          this.resolveDelivered(droplet);
        } else {
          this.resolveLeak(droplet);
        }
        return false;
      }

      droplet.col = next.col;
      droplet.row = next.row;
      droplet.travelDir = exitPort;
      droplet.progress -= 1;
    }

    return true;
  }

  private resolveDelivered(droplet: Droplet): void {
    this.combo += 1;
    const scoreGained = 10 + this.combo * 3;
    this.score += scoreGained;
    this.deliveriesInWave += 1;
    this.onDelivered?.({ col: droplet.col, row: droplet.row, scoreGained, combo: this.combo });
    if (this.deliveriesInWave >= DELIVERIES_PER_WAVE) this.advanceWave();
  }

  private resolveLeak(droplet: Droplet): void {
    this.combo = 0;
    this.lives -= 1;
    this.onLeak?.({ col: droplet.col, row: droplet.row, scoreGained: 0, combo: 0 });
    if (this.lives <= 0) this.isOver = true;
  }

  private advanceWave(): void {
    this.wave += 1;
    this.deliveriesInWave = 0;
    this.dropletSpeed = Math.min(MAX_DROPLET_SPEED, this.dropletSpeed * SPEED_GROWTH_PER_WAVE);
    this.spawnInterval = Math.max(MIN_SPAWN_INTERVAL, this.spawnInterval * SPAWN_SHRINK_PER_WAVE);
    this.jamInterval = Math.max(MIN_JAM_INTERVAL, this.jamInterval * JAM_SHRINK_PER_WAVE);
    this.droplets = [];
    this.regenerateGrid();
    this.onWaveAdvance?.(this.wave);
  }
}
