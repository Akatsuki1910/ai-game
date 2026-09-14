export interface EnemyState {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface CaptureEvent {
  gainedCells: number;
  points: number;
  capturedRatio: number;
}

const COLS = 26;
const ROWS = 26;
const TOTAL_CELLS = COLS * ROWS;
const INITIAL_OWNED_RADIUS = 2.4;
/** 正方形のプレイフィールドをステージ内に収めるための余白係数。 */
const PLAYFIELD_MARGIN = 0.92;
const SPEED_FRAC = 0.46;
/** 1秒あたりの旋回角速度(rad)。大きいほど急旋回できる。 */
const TURN_RATE = 6.5;
const ENEMY_COUNT = 3;
const ENEMY_SPEED_FRAC = 0.24;
/** 制圧率に応じて敵の速度がどれだけ上がるか。 */
const ENEMY_SPEED_GROWTH = 0.9;
const PLAYER_RADIUS_FRAC = 0.34;
const ENEMY_RADIUS_FRAC = 0.4;
const WIN_RATIO = 0.75;
const START_LIVES = 3;
const POINTS_PER_CELL = 12;
/** 軌跡をセルに焼き込む際のサンプリング間隔（セルサイズに対する比率）。粗いと当たり判定に穴が空く。 */
const TRAIL_SAMPLE_FRAC = 0.5;

function wrapAngleDiff(from: number, to: number): number {
  let diff = (to - from) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * 中央の陣地から外へ軌跡を伸ばし、自陣に戻ってループを閉じると囲んだ領域を制圧するワールド。
 * 制圧率はセル単位のグリッドで管理し、移動や見た目は連続座標で扱う。
 */
export class GridBreachWorld {
  width = 0;
  height = 0;
  playfieldSize = 0;
  offsetX = 0;
  offsetY = 0;
  cellSize = 0;
  readonly cols = COLS;
  readonly rows = ROWS;

  /** 1マスにつき1バイト。0=未制圧 / 1=制圧済み。 */
  ownership = new Uint8Array(TOTAL_CELLS);
  /** ownership が変化するたびに増える版数。描画側の再構築要否判定に使う。 */
  territoryVersion = 0;

  player = { x: 0, y: 0, angle: 0, desiredAngle: 0, isTrailing: false };
  trail: { x: number; y: number }[] = [];
  private readonly trailCells = new Set<number>();
  private lastSampledPoint = { x: 0, y: 0 };

  enemies: EnemyState[] = [];

  score = 0;
  lives = START_LIVES;
  capturedRatio = 0;
  isOver = false;
  isClear = false;

  playerRadius = 0;
  enemyRadius = 0;

  onCapture: ((event: CaptureEvent) => void) | null = null;
  onLifeLost: (() => void) | null = null;

  constructor(width: number, height: number) {
    this.resize(width, height);
    this.reset();
  }

  reset(): void {
    this.ownership.fill(0);
    const centerCol = (COLS - 1) / 2;
    const centerRow = (ROWS - 1) / 2;
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        if (Math.hypot(col - centerCol, row - centerRow) <= INITIAL_OWNED_RADIUS) {
          this.ownership[row * COLS + col] = 1;
        }
      }
    }
    this.territoryVersion++;

    this.player.x = this.playfieldSize / 2;
    this.player.y = this.playfieldSize / 2;
    this.player.angle = 0;
    this.player.desiredAngle = 0;
    this.player.isTrailing = false;
    this.trail = [];
    this.trailCells.clear();
    this.lastSampledPoint = { x: this.player.x, y: this.player.y };

    this.enemies = [];
    for (let i = 0; i < ENEMY_COUNT; i++) {
      const orbitAngle = (Math.PI * 2 * i) / ENEMY_COUNT + randRange(-0.3, 0.3);
      const orbitRadius = this.playfieldSize * randRange(0.32, 0.46);
      const speed = this.playfieldSize * ENEMY_SPEED_FRAC;
      const heading = randRange(0, Math.PI * 2);
      this.enemies.push({
        x: this.playfieldSize / 2 + Math.cos(orbitAngle) * orbitRadius,
        y: this.playfieldSize / 2 + Math.sin(orbitAngle) * orbitRadius,
        vx: Math.cos(heading) * speed,
        vy: Math.sin(heading) * speed,
      });
    }

    this.score = 0;
    this.lives = START_LIVES;
    this.isOver = false;
    this.isClear = false;
    this.updateCapturedRatio();
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const newPlayfieldSize = Math.min(width, height) * PLAYFIELD_MARGIN;
    const scale = this.playfieldSize > 0 ? newPlayfieldSize / this.playfieldSize : 1;

    this.width = width;
    this.height = height;
    this.offsetX = (width - newPlayfieldSize) / 2;
    this.offsetY = (height - newPlayfieldSize) / 2;
    this.playfieldSize = newPlayfieldSize;
    this.cellSize = newPlayfieldSize / COLS;
    this.playerRadius = this.cellSize * PLAYER_RADIUS_FRAC;
    this.enemyRadius = this.cellSize * ENEMY_RADIUS_FRAC;

    if (scale !== 1) {
      this.player.x *= scale;
      this.player.y *= scale;
      this.lastSampledPoint.x *= scale;
      this.lastSampledPoint.y *= scale;
      for (const point of this.trail) {
        point.x *= scale;
        point.y *= scale;
      }
      for (const enemy of this.enemies) {
        enemy.x *= scale;
        enemy.y *= scale;
        enemy.vx *= scale;
        enemy.vy *= scale;
      }
    }
  }

  /** キャンバス(ステージ)座標を軌道の狙い角に変換する。ドラッグ操作用。 */
  aimAtStagePoint(stageX: number, stageY: number): void {
    const localX = stageX - this.offsetX;
    const localY = stageY - this.offsetY;
    const dx = localX - this.player.x;
    const dy = localY - this.player.y;
    if (Math.hypot(dx, dy) < 1) return;
    this.player.desiredAngle = Math.atan2(dy, dx);
  }

  /** キーボードなど、角度を直接指定したい入力向け。 */
  setDesiredAngle(angle: number): void {
    this.player.desiredAngle = angle;
  }

  private cellIndexAt(x: number, y: number): number {
    const col = Math.min(COLS - 1, Math.max(0, Math.floor(x / this.cellSize)));
    const row = Math.min(ROWS - 1, Math.max(0, Math.floor(y / this.cellSize)));
    return row * COLS + col;
  }

  private isOwnedAtLocal(x: number, y: number): boolean {
    return this.ownership[this.cellIndexAt(x, y)] === 1;
  }

  private markTrailSegment(x0: number, y0: number, x1: number, y1: number): void {
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const step = this.cellSize * TRAIL_SAMPLE_FRAC;
    const steps = Math.max(1, Math.ceil(dist / step));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.trailCells.add(this.cellIndexAt(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t));
    }
  }

  private updateCapturedRatio(): void {
    let owned = 0;
    for (let i = 0; i < TOTAL_CELLS; i++) owned += this.ownership[i];
    this.capturedRatio = owned / TOTAL_CELLS;
  }

  /** 軌跡が自陣に戻った瞬間に呼ぶ。境界セルから外側へ塗りつぶし、残った空洞を制圧地とする。 */
  private finalizeCapture(): void {
    const wall = new Uint8Array(TOTAL_CELLS);
    wall.set(this.ownership);
    for (const idx of this.trailCells) wall[idx] = 1;

    const outside = new Uint8Array(TOTAL_CELLS);
    const queue: number[] = [];
    const visitIfOpen = (col: number, row: number) => {
      if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return;
      const idx = row * COLS + col;
      if (wall[idx] || outside[idx]) return;
      outside[idx] = 1;
      queue.push(idx);
    };
    for (let col = 0; col < COLS; col++) {
      visitIfOpen(col, 0);
      visitIfOpen(col, ROWS - 1);
    }
    for (let row = 0; row < ROWS; row++) {
      visitIfOpen(0, row);
      visitIfOpen(COLS - 1, row);
    }
    while (queue.length > 0) {
      const idx = queue.pop();
      if (idx === undefined) break;
      const col = idx % COLS;
      const row = Math.floor(idx / COLS);
      visitIfOpen(col - 1, row);
      visitIfOpen(col + 1, row);
      visitIfOpen(col, row - 1);
      visitIfOpen(col, row + 1);
    }

    let gained = 0;
    for (const idx of this.trailCells) {
      if (this.ownership[idx] === 0) {
        this.ownership[idx] = 1;
        gained++;
      }
    }
    for (let i = 0; i < TOTAL_CELLS; i++) {
      if (this.ownership[i] === 1 || outside[i]) continue;
      this.ownership[i] = 1;
      gained++;
    }

    this.player.isTrailing = false;
    this.trail = [];
    this.trailCells.clear();

    if (gained > 0) {
      this.territoryVersion++;
      this.updateCapturedRatio();
      const points = gained * POINTS_PER_CELL;
      this.score += points;
      this.onCapture?.({ gainedCells: gained, points, capturedRatio: this.capturedRatio });
    }

    if (this.capturedRatio >= WIN_RATIO) {
      this.isOver = true;
      this.isClear = true;
    }
  }

  private handleLifeLost(): void {
    this.lives -= 1;
    this.player.isTrailing = false;
    this.trail = [];
    this.trailCells.clear();
    this.player.x = this.playfieldSize / 2;
    this.player.y = this.playfieldSize / 2;
    this.lastSampledPoint = { x: this.player.x, y: this.player.y };
    this.player.angle = 0;
    this.player.desiredAngle = 0;
    this.onLifeLost?.();
    if (this.lives <= 0) {
      this.isOver = true;
      this.isClear = false;
    }
  }

  private updateEnemies(deltaSeconds: number): void {
    const speedScale = 1 + this.capturedRatio * ENEMY_SPEED_GROWTH;
    for (const enemy of this.enemies) {
      let nx = enemy.x + enemy.vx * speedScale * deltaSeconds;
      let ny = enemy.y + enemy.vy * speedScale * deltaSeconds;
      if (nx < this.enemyRadius) {
        nx = this.enemyRadius;
        enemy.vx = Math.abs(enemy.vx);
      } else if (nx > this.playfieldSize - this.enemyRadius) {
        nx = this.playfieldSize - this.enemyRadius;
        enemy.vx = -Math.abs(enemy.vx);
      }
      if (ny < this.enemyRadius) {
        ny = this.enemyRadius;
        enemy.vy = Math.abs(enemy.vy);
      } else if (ny > this.playfieldSize - this.enemyRadius) {
        ny = this.playfieldSize - this.enemyRadius;
        enemy.vy = -Math.abs(enemy.vy);
      }
      enemy.x = nx;
      enemy.y = ny;
    }
  }

  /** 軌跡を伸ばしている間だけ、敵との接触（本体 or 軌跡ごと）で1ミス扱いにする。 */
  private checkEnemyCollisions(): void {
    if (!this.player.isTrailing) return;
    for (const enemy of this.enemies) {
      const dist = Math.hypot(enemy.x - this.player.x, enemy.y - this.player.y);
      if (dist < this.enemyRadius + this.playerRadius) {
        this.handleLifeLost();
        return;
      }
      if (this.trailCells.has(this.cellIndexAt(enemy.x, enemy.y))) {
        this.handleLifeLost();
        return;
      }
    }
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    const diff = wrapAngleDiff(this.player.angle, this.player.desiredAngle);
    const maxTurn = TURN_RATE * deltaSeconds;
    this.player.angle += Math.max(-maxTurn, Math.min(maxTurn, diff));

    const speed = this.playfieldSize * SPEED_FRAC;
    const prevX = this.player.x;
    const prevY = this.player.y;
    let nextX = prevX + Math.cos(this.player.angle) * speed * deltaSeconds;
    let nextY = prevY + Math.sin(this.player.angle) * speed * deltaSeconds;

    if (nextX < 0) {
      nextX = -nextX;
      this.player.angle = Math.PI - this.player.angle;
    } else if (nextX > this.playfieldSize) {
      nextX = 2 * this.playfieldSize - nextX;
      this.player.angle = Math.PI - this.player.angle;
    }
    if (nextY < 0) {
      nextY = -nextY;
      this.player.angle = -this.player.angle;
    } else if (nextY > this.playfieldSize) {
      nextY = 2 * this.playfieldSize - nextY;
      this.player.angle = -this.player.angle;
    }

    this.player.x = nextX;
    this.player.y = nextY;

    const ownedNow = this.isOwnedAtLocal(nextX, nextY);

    if (!this.player.isTrailing) {
      if (!ownedNow) {
        this.player.isTrailing = true;
        this.trail = [{ x: prevX, y: prevY }];
        this.trailCells.clear();
        this.markTrailSegment(prevX, prevY, nextX, nextY);
        this.trail.push({ x: nextX, y: nextY });
        this.lastSampledPoint = { x: nextX, y: nextY };
      }
    } else {
      this.markTrailSegment(this.lastSampledPoint.x, this.lastSampledPoint.y, nextX, nextY);
      this.lastSampledPoint = { x: nextX, y: nextY };
      const last = this.trail[this.trail.length - 1];
      if (!last || Math.hypot(nextX - last.x, nextY - last.y) > this.cellSize * 0.3) {
        this.trail.push({ x: nextX, y: nextY });
      }
      if (ownedNow) {
        this.finalizeCapture();
      }
    }

    this.updateEnemies(deltaSeconds);
    this.checkEnemyCollisions();
  }
}
