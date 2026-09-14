export interface Marble {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** スポーンされた経過秒(World.elapsedSeconds基準)。釘の間で稀に均衡してしまった場合の強制解決に使う。 */
  spawnedAt: number;
}

export interface PegSlot {
  /** リングの回転が0のときの基準角度(ラジアン)。実際の座標は rotationAngle を加えて求める。 */
  angle: number;
}

export interface MarbleResolvedEvent {
  isCollected: boolean;
  points: number;
  combo: number;
  /** 解決した瞬間のマーブルのx座標。ポップアップ演出の表示位置に使う。 */
  x: number;
}

/** 1ラウンドの持ち時間(秒)。 */
export const ROUND_SECONDS = 60;
/** リング上に並べる釘の数。奇数にして真上から落ちても左右非対称にばらけやすくする。 */
export const PEG_COUNT = 9;

const GRAVITY = 640;
const MARBLE_RADIUS = 8;
const PEG_RADIUS = 13;
const RESTITUTION = 0.5;
/** 長押し中にリングが回転する角速度(ラジアン/秒)。 */
const ROTATION_SPEED = 1.7;
const SPAWN_INTERVAL_START = 1.15;
const SPAWN_INTERVAL_MIN = 0.5;
// 経過時間に応じてスポーン間隔が短くなっていく速さ
const SPAWN_INTERVAL_DECAY_PER_SECOND = 0.012;
const GOAL_WIDTH_RATIO = 0.24;
const RING_RADIUS_RATIO = 0.26;
const RING_CENTER_Y_RATIO = 0.42;
const MARBLE_BASE_SCORE = 10;
const COMBO_BONUS_PER_STREAK = 2;
const COMBO_BONUS_MAX = 20;
// 釘の間でまれに(ほぼ)静止してしまうケースの安全弁。これが無いとその1個が永遠に
// 解決されず、マーブル配列が減らないままラウンドが終わってしまう。
const MARBLE_MAX_LIFETIME_SECONDS = 12;
const SPAWN_X_JITTER_RATIO = 0.06;

let nextMarbleId = 1;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * 回転する釘リングにマーブルを落とし、中央のゴールへ導くリアルタイム・アーケードの
 * 純粋ロジック層。React / pixi.js には一切依存しない。
 *
 * 釘はリング中心からの角度(角速度で連続回転)だけを状態として持ち、絶対座標は
 * getPegPositions() で都度算出する。こうすることで resize() 時に釘の再スケール処理が
 * 不要になる(中心・半径がすべて width/height の比率から導出されるため)。
 */
export class RotorDropWorld {
  width = 0;
  height = 0;

  readonly pegs: PegSlot[];
  marbles: Marble[] = [];

  rotationAngle = 0;
  private rotationInput: -1 | 0 | 1 = 0;

  score = 0;
  combo = 0;
  marblesCollected = 0;
  marblesMissed = 0;
  totalSpawned = 0;
  timeRemaining = ROUND_SECONDS;
  isOver = false;

  private elapsedSeconds = 0;
  private spawnTimer = 0.6;

  onMarbleResolved: ((event: MarbleResolvedEvent) => void) | null = null;

  constructor(width: number, height: number) {
    this.pegs = Array.from({ length: PEG_COUNT }, (_, i) => ({
      angle: (i / PEG_COUNT) * Math.PI * 2,
    }));
    this.width = width > 0 ? width : 1;
    this.height = height > 0 ? height : 1;
    this.reset();
  }

  reset(): void {
    this.marbles = [];
    this.rotationAngle = 0;
    this.rotationInput = 0;
    this.score = 0;
    this.combo = 0;
    this.marblesCollected = 0;
    this.marblesMissed = 0;
    this.totalSpawned = 0;
    this.timeRemaining = ROUND_SECONDS;
    this.isOver = false;
    this.elapsedSeconds = 0;
    this.spawnTimer = 0.6;
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const scaleX = this.width > 0 ? width / this.width : 1;
    const scaleY = this.height > 0 ? height / this.height : 1;
    if (this.width > 0 && this.height > 0) {
      for (const marble of this.marbles) {
        marble.x *= scaleX;
        marble.y *= scaleY;
      }
    }
    this.width = width;
    this.height = height;
  }

  /** リングの回転入力(-1=反時計回り, 0=停止, 1=時計回り)。押している間、毎フレーム呼ぶ想定。 */
  setRotationInput(direction: -1 | 0 | 1): void {
    this.rotationInput = direction;
  }

  get centerX(): number {
    return this.width / 2;
  }

  get centerY(): number {
    return this.height * RING_CENTER_Y_RATIO;
  }

  get ringRadius(): number {
    return Math.min(this.width, this.height) * RING_RADIUS_RATIO;
  }

  /** マーブルがゴール/ハズレの判定を受ける高さ(画面下端付近)。 */
  get exitY(): number {
    return this.height - Math.max(40, this.height * 0.08);
  }

  get goalHalfWidth(): number {
    return (this.width * GOAL_WIDTH_RATIO) / 2;
  }

  /** これまでスポーンしたマーブルのうち、ゴールできた割合(0〜1)。 */
  get collectRate(): number {
    return this.totalSpawned > 0 ? this.marblesCollected / this.totalSpawned : 0;
  }

  /** 現在の釘の絶対座標。描画・当たり判定の両方で使う。 */
  getPegPositions(): Array<{ x: number; y: number }> {
    return this.pegs.map((peg) => {
      const angle = peg.angle + this.rotationAngle;
      return {
        x: this.centerX + Math.cos(angle) * this.ringRadius,
        y: this.centerY + Math.sin(angle) * this.ringRadius,
      };
    });
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    this.timeRemaining = Math.max(0, this.timeRemaining - deltaSeconds);
    if (this.timeRemaining <= 0) {
      this.isOver = true;
      return;
    }
    this.elapsedSeconds += deltaSeconds;
    this.rotationAngle += this.rotationInput * ROTATION_SPEED * deltaSeconds;

    this.spawnTimer -= deltaSeconds;
    if (this.spawnTimer <= 0) {
      this.spawnMarble();
      const interval = Math.max(
        SPAWN_INTERVAL_MIN,
        SPAWN_INTERVAL_START - this.elapsedSeconds * SPAWN_INTERVAL_DECAY_PER_SECOND,
      );
      this.spawnTimer += interval;
    }

    const pegPositions = this.getPegPositions();
    for (const marble of this.marbles) {
      this.integrateMarble(marble, deltaSeconds);
      this.collideWithWalls(marble);
      for (const peg of pegPositions) this.collideWithPeg(marble, peg);
    }

    this.resolveMarbles();
  }

  private spawnMarble(): void {
    const jitter = this.width * SPAWN_X_JITTER_RATIO;
    const x = clamp(
      this.centerX + randRange(-jitter, jitter),
      MARBLE_RADIUS,
      this.width - MARBLE_RADIUS,
    );
    this.marbles.push({
      id: nextMarbleId++,
      x,
      y: MARBLE_RADIUS * 2,
      vx: 0,
      vy: 40,
      spawnedAt: this.elapsedSeconds,
    });
    this.totalSpawned += 1;
  }

  private integrateMarble(marble: Marble, deltaSeconds: number): void {
    marble.vy += GRAVITY * deltaSeconds;
    marble.x += marble.vx * deltaSeconds;
    marble.y += marble.vy * deltaSeconds;
  }

  private collideWithWalls(marble: Marble): void {
    if (marble.x < MARBLE_RADIUS) {
      marble.x = MARBLE_RADIUS;
      marble.vx = Math.abs(marble.vx) * RESTITUTION;
    } else if (marble.x > this.width - MARBLE_RADIUS) {
      marble.x = this.width - MARBLE_RADIUS;
      marble.vx = -Math.abs(marble.vx) * RESTITUTION;
    }
  }

  private collideWithPeg(marble: Marble, peg: { x: number; y: number }): void {
    const dx = marble.x - peg.x;
    const dy = marble.y - peg.y;
    const dist = Math.hypot(dx, dy);
    const minDist = MARBLE_RADIUS + PEG_RADIUS;
    if (dist <= 0 || dist >= minDist) return;

    const nx = dx / dist;
    const ny = dy / dist;
    const overlap = minDist - dist;
    marble.x += nx * overlap;
    marble.y += ny * overlap;

    const velocityDotNormal = marble.vx * nx + marble.vy * ny;
    if (velocityDotNormal < 0) {
      marble.vx -= (1 + RESTITUTION) * velocityDotNormal * nx;
      marble.vy -= (1 + RESTITUTION) * velocityDotNormal * ny;
    }
  }

  private resolveMarbles(): void {
    for (let i = this.marbles.length - 1; i >= 0; i--) {
      const marble = this.marbles[i];
      const hasTimedOut = this.elapsedSeconds - marble.spawnedAt > MARBLE_MAX_LIFETIME_SECONDS;
      if (marble.y - MARBLE_RADIUS < this.exitY && !hasTimedOut) continue;

      this.marbles.splice(i, 1);
      const isCollected = !hasTimedOut && Math.abs(marble.x - this.centerX) <= this.goalHalfWidth;

      if (isCollected) {
        this.marblesCollected += 1;
        this.combo += 1;
        const points =
          MARBLE_BASE_SCORE + Math.min(COMBO_BONUS_MAX, this.combo * COMBO_BONUS_PER_STREAK);
        this.score += points;
        this.onMarbleResolved?.({ isCollected: true, points, combo: this.combo, x: marble.x });
      } else {
        this.marblesMissed += 1;
        this.combo = 0;
        this.onMarbleResolved?.({ isCollected: false, points: 0, combo: 0, x: marble.x });
      }
    }
  }
}
