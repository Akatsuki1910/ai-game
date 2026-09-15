export interface RivalKite {
  id: number;
  x: number;
  y: number;
  vx: number;
  /** 0〜CUT_THRESHOLD。糸を重ね続けると増え、しきい値で切れる。 */
  sawPower: number;
}

export interface KiteCutEvent {
  points: number;
  combo: number;
  x: number;
  y: number;
}

export interface Point {
  x: number;
  y: number;
}

export const ROUND_SECONDS = 75;
export const MAX_ANGLE = (55 * Math.PI) / 180;
export const CUT_THRESHOLD = 100;

const ANCHOR_Y_RATIO = 0.92;
const STRING_LENGTH_RATIO = 0.7;
const FOLLOW_RATE = 7;
const TURN_SPEED = 1.6; // rad/秒。キーボード操作時の旋回速度。
const WIND_AMPLITUDE = 0.5; // rad/秒^2 相当。難易度で増幅される風の揺さぶり。
const WIND_FREQUENCY = 0.6;
const MAX_DIFFICULTY = 2.2;
const DIFFICULTY_GROWTH_PER_CUT = 0.08;

const OPPONENT_Y_RATIO = 0.16;
const OPPONENT_MIN_SPEED = 14;
const OPPONENT_MAX_SPEED = 34;
const OPPONENT_BAND_MIN_RATIO = 0.18;
const OPPONENT_BAND_MAX_RATIO = 0.82;
const INITIAL_OPPONENT_X_RATIO = 0.68;
const OPPONENT_ADD_INTERVAL = 22;
const MAX_OPPONENTS = 3;

const CUT_TOLERANCE_PX = 16;
const SAW_BASE_RATE = 30; // 接触しているだけでも進む基礎レート(/秒)
const SAW_BONUS_RATE = 260; // 旋回速度(rad/秒)に応じて上乗せされるレート
const SAW_DECAY_RATE = 65; // 非接触時に減衰するレート(/秒)
const COMBO_RESET_SECONDS = 6;
const BASE_POINTS = 120;
const COMBO_BONUS_PER_STREAK = 40;
const MAX_COMBO_BONUS = 320;

let nextId = 1;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** 線分 a→b 上で y 座標が指定値になる位置の x を線形補間で求める。 */
function xAtY(a: Point, b: Point, y: number): number {
  if (b.y === a.y) return a.x;
  const t = (y - a.y) / (b.y - a.y);
  return a.x + (b.x - a.x) * t;
}

/**
 * 錨(操縦者の手元)から伸びる自分の凧糸を旋回させ、上空を漂うライバルの凧糸に
 * 重ねて断ち切るリアルタイム凧合戦の純粋ロジック層。React / pixi.js に依存しない。
 *
 * 相手の凧糸は常にその凧から画面下方へまっすぐ垂れる線として扱う（見た目の簡略化）。
 * 自分の凧糸(錨→凧)との最短距離が一定以下なら「重なっている」とみなし、
 * 重なっている間じわじわ、素早く旋回させるほど速く相手の糸を切る。
 */
export class KiteDuelWorld {
  width = 0;
  height = 0;
  theta = 0;
  controlAngle = 0;
  angularVelocity = 0;
  score = 0;
  combo = 0;
  timeRemaining = ROUND_SECONDS;
  isOver = false;
  opponents: RivalKite[] = [];

  private difficulty = 1;
  private windPhase = 0;
  private timeSinceLastSpawn = 0;
  private timeSinceLastCut = 0;

  onKiteCut: ((event: KiteCutEvent) => void) | null = null;

  constructor(width: number, height: number) {
    this.resize(width, height);
    this.reset();
  }

  reset(): void {
    this.score = 0;
    this.combo = 0;
    this.timeRemaining = ROUND_SECONDS;
    this.isOver = false;
    this.theta = 0;
    this.controlAngle = 0;
    this.angularVelocity = 0;
    this.difficulty = 1;
    this.windPhase = 0;
    this.timeSinceLastSpawn = 0;
    this.timeSinceLastCut = 0;
    this.opponents = [this.spawnOpponent(true)];
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const scaleX = this.width > 0 ? width / this.width : 1;
    if (this.width > 0 && this.height > 0) {
      for (const opponent of this.opponents) {
        opponent.x *= scaleX;
      }
    }
    this.width = width;
    this.height = height;
    for (const opponent of this.opponents) {
      opponent.y = this.height * OPPONENT_Y_RATIO;
    }
  }

  get anchor(): Point {
    return { x: this.width * 0.5, y: this.height * ANCHOR_Y_RATIO };
  }

  get stringLength(): number {
    return Math.min(this.width, this.height) * STRING_LENGTH_RATIO;
  }

  get kitePosition(): Point {
    const anchor = this.anchor;
    return {
      x: anchor.x + this.stringLength * Math.sin(this.theta),
      y: anchor.y - this.stringLength * Math.cos(this.theta),
    };
  }

  /** ポインタ座標の方向を狙い角度にする(ドラッグ操作)。 */
  setPointerTarget(x: number, y: number): void {
    const anchor = this.anchor;
    const angle = Math.atan2(x - anchor.x, anchor.y - y);
    this.controlAngle = clamp(angle, -MAX_ANGLE, MAX_ANGLE);
  }

  /** キーボードでの旋回操作(左右)。 */
  nudgeControlAngle(direction: -1 | 1, deltaSeconds: number): void {
    this.controlAngle = clamp(
      this.controlAngle + direction * TURN_SPEED * deltaSeconds,
      -MAX_ANGLE,
      MAX_ANGLE,
    );
  }

  private spawnOpponent(isInitial: boolean): RivalKite {
    const x = isInitial
      ? this.width * INITIAL_OPPONENT_X_RATIO
      : randRange(this.width * OPPONENT_BAND_MIN_RATIO, this.width * OPPONENT_BAND_MAX_RATIO);
    const direction = isInitial || Math.random() < 0.5 ? 1 : -1;
    return {
      id: nextId++,
      x,
      y: this.height * OPPONENT_Y_RATIO,
      vx: direction * randRange(OPPONENT_MIN_SPEED, OPPONENT_MAX_SPEED) * this.difficulty,
      sawPower: 0,
    };
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    this.timeRemaining = Math.max(0, this.timeRemaining - deltaSeconds);
    if (this.timeRemaining <= 0) {
      this.isOver = true;
      return;
    }

    this.windPhase += deltaSeconds;
    this.timeSinceLastCut += deltaSeconds;
    if (this.timeSinceLastCut >= COMBO_RESET_SECONDS) {
      this.combo = 0;
    }

    const windTorque = Math.sin(this.windPhase * WIND_FREQUENCY) * WIND_AMPLITUDE * this.difficulty;
    const previousTheta = this.theta;
    const smoothing = Math.min(1, FOLLOW_RATE * deltaSeconds);
    const nextTheta =
      this.theta + (this.controlAngle - this.theta) * smoothing + windTorque * deltaSeconds;
    this.theta = clamp(nextTheta, -MAX_ANGLE, MAX_ANGLE);
    this.angularVelocity = deltaSeconds > 0 ? (this.theta - previousTheta) / deltaSeconds : 0;

    this.timeSinceLastSpawn += deltaSeconds;
    if (this.timeSinceLastSpawn >= OPPONENT_ADD_INTERVAL && this.opponents.length < MAX_OPPONENTS) {
      this.timeSinceLastSpawn = 0;
      this.opponents.push(this.spawnOpponent(false));
    }

    const anchor = this.anchor;
    const kite = this.kitePosition;
    const bandMinX = this.width * OPPONENT_BAND_MIN_RATIO;
    const bandMaxX = this.width * OPPONENT_BAND_MAX_RATIO;

    for (const opponent of this.opponents) {
      opponent.x += opponent.vx * deltaSeconds;
      if (opponent.x < bandMinX || opponent.x > bandMaxX) {
        opponent.vx *= -1;
        opponent.x = clamp(opponent.x, bandMinX, bandMaxX);
      }

      const topY = Math.max(kite.y, opponent.y);
      const bottomY = Math.min(anchor.y, this.height);
      let distance = Number.POSITIVE_INFINITY;
      if (topY <= bottomY) {
        const xTop = xAtY(kite, anchor, topY);
        const xBottom = xAtY(kite, anchor, bottomY);
        distance = Math.min(Math.abs(xTop - opponent.x), Math.abs(xBottom - opponent.x));
        if ((xTop - opponent.x) * (xBottom - opponent.x) <= 0) distance = 0;
      }

      if (distance <= CUT_TOLERANCE_PX) {
        opponent.sawPower = Math.min(
          CUT_THRESHOLD,
          opponent.sawPower +
            (SAW_BASE_RATE + SAW_BONUS_RATE * Math.abs(this.angularVelocity)) * deltaSeconds,
        );
      } else {
        opponent.sawPower = Math.max(0, opponent.sawPower - SAW_DECAY_RATE * deltaSeconds);
      }

      if (opponent.sawPower >= CUT_THRESHOLD) {
        this.combo += 1;
        this.timeSinceLastCut = 0;
        const points =
          BASE_POINTS + Math.min(MAX_COMBO_BONUS, (this.combo - 1) * COMBO_BONUS_PER_STREAK);
        this.score += points;
        this.difficulty = Math.min(MAX_DIFFICULTY, this.difficulty + DIFFICULTY_GROWTH_PER_CUT);
        this.onKiteCut?.({ points, combo: this.combo, x: opponent.x, y: opponent.y });

        const respawned = this.spawnOpponent(false);
        opponent.x = respawned.x;
        opponent.y = respawned.y;
        opponent.vx = respawned.vx;
        opponent.sawPower = 0;
      }
    }
  }
}
