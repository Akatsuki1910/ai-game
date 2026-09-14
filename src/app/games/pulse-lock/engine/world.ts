export interface Tumbler {
  id: number;
  /** ターゲットゾーンの開始角(ラジアン, [0, 2π))。ゾーンは targetStart から targetWidth ぶん進む向き。 */
  targetStart: number;
  targetWidth: number;
  /** 現在の指針の角度(ラジアン, [0, 2π))。アクティブなタンブラーだけが step() で進む。 */
  angle: number;
  /** 指針の角速度(ラジアン/秒)。符号で回転方向を表す。 */
  angularSpeed: number;
  isSolved: boolean;
}

export interface TumblerSolvedEvent {
  tumblerIndex: number;
  points: number;
  /** ターゲットゾーン中心にどれだけ近いタップだったか(0〜1、1が完璧)。 */
  precision: number;
  combo: number;
}

export interface LockCompletedEvent {
  /** クリアし終えたロックのレベル(次のレベルではなく、たった今解いたレベル)。 */
  level: number;
  bonus: number;
}

export interface LockMissedEvent {
  tumblerIndex: number;
  livesRemaining: number;
}

const TAU = Math.PI * 2;

export const START_LIVES = 3;
const MIN_TUMBLERS = 2;
const MAX_TUMBLERS = 6;
const BASE_TARGET_WIDTH = 1.1;
const TARGET_WIDTH_DECAY_PER_LEVEL = 0.05;
const MIN_TARGET_WIDTH = 0.35;
const BASE_ANGULAR_SPEED = 1.0;
const ANGULAR_SPEED_GROWTH_PER_LEVEL = 0.12;
const MAX_ANGULAR_SPEED = 3.2;
const BASE_POINTS = 40;
const COMBO_BONUS_PER_STREAK = 4;
const MAX_COMBO_BONUS = 60;
const LOCK_BASE_BONUS = 100;
const LOCK_BONUS_PER_LEVEL = 10;

let nextTumblerId = 1;

function normalizeAngle(angle: number): number {
  return ((angle % TAU) + TAU) % TAU;
}

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function tumblerCountForLevel(level: number): number {
  return Math.min(MAX_TUMBLERS, Math.max(MIN_TUMBLERS, MIN_TUMBLERS + Math.floor((level - 1) / 2)));
}

function targetWidthForLevel(level: number): number {
  return Math.max(MIN_TARGET_WIDTH, BASE_TARGET_WIDTH - (level - 1) * TARGET_WIDTH_DECAY_PER_LEVEL);
}

function angularSpeedForLevel(level: number): number {
  return Math.min(
    MAX_ANGULAR_SPEED,
    BASE_ANGULAR_SPEED + (level - 1) * ANGULAR_SPEED_GROWTH_PER_LEVEL,
  );
}

/**
 * 回転するタンブラー(同心円のリング)を、指針がターゲットゾーンに重なった瞬間に
 * タップして順番に解錠していくリアルタイム・ロックピッキングの純粋ロジック層。
 * React / pixi.js には一切依存しない。画面サイズにも依存しない(角度だけの状態のため
 * resize() は不要)。
 */
export class PulseLockWorld {
  level = 1;
  lives = START_LIVES;
  score = 0;
  combo = 0;
  isOver = false;
  tumblers: Tumbler[] = [];
  activeTumblerIndex = 0;

  onTumblerSolved: ((event: TumblerSolvedEvent) => void) | null = null;
  onLockCompleted: ((event: LockCompletedEvent) => void) | null = null;
  onLockMissed: ((event: LockMissedEvent) => void) | null = null;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.level = 1;
    this.lives = START_LIVES;
    this.score = 0;
    this.combo = 0;
    this.isOver = false;
    this.tumblers = this.generateLock(this.level);
    this.activeTumblerIndex = 0;
  }

  get activeTumbler(): Tumbler | undefined {
    return this.tumblers[this.activeTumblerIndex];
  }

  private generateLock(level: number): Tumbler[] {
    const count = tumblerCountForLevel(level);
    const width = targetWidthForLevel(level);
    const speed = angularSpeedForLevel(level);
    return Array.from({ length: count }, (_, i) => ({
      id: nextTumblerId++,
      targetStart: randRange(0, TAU),
      targetWidth: width,
      angle: randRange(0, TAU),
      angularSpeed: speed * (i % 2 === 0 ? 1 : -1),
      isSolved: false,
    }));
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;
    const tumbler = this.activeTumbler;
    if (!tumbler) return;
    tumbler.angle = normalizeAngle(tumbler.angle + tumbler.angularSpeed * deltaSeconds);
  }

  /** 指針がターゲットゾーン内にある瞬間にタップ(クリック/タップ/Enter)されたときに呼ぶ。 */
  attemptLock(): void {
    if (this.isOver) return;
    const tumbler = this.activeTumbler;
    if (!tumbler) return;

    const offset = normalizeAngle(tumbler.angle - tumbler.targetStart);
    const isHit = offset <= tumbler.targetWidth;

    if (!isHit) {
      this.combo = 0;
      this.lives = Math.max(0, this.lives - 1);
      this.onLockMissed?.({ tumblerIndex: this.activeTumblerIndex, livesRemaining: this.lives });
      if (this.lives <= 0) this.isOver = true;
      return;
    }

    const centerOffset = tumbler.targetWidth / 2;
    const precision = centerOffset > 0 ? 1 - Math.abs(offset - centerOffset) / centerOffset : 1;

    tumbler.isSolved = true;
    this.combo += 1;
    const comboBonus = Math.min(MAX_COMBO_BONUS, this.combo * COMBO_BONUS_PER_STREAK);
    const points = Math.round(BASE_POINTS + BASE_POINTS * precision + comboBonus);
    this.score += points;
    this.onTumblerSolved?.({
      tumblerIndex: this.activeTumblerIndex,
      points,
      precision,
      combo: this.combo,
    });

    this.activeTumblerIndex += 1;
    if (this.activeTumblerIndex >= this.tumblers.length) {
      const bonus = LOCK_BASE_BONUS + this.level * LOCK_BONUS_PER_LEVEL;
      this.score += bonus;
      this.onLockCompleted?.({ level: this.level, bonus });
      this.level += 1;
      this.tumblers = this.generateLock(this.level);
      this.activeTumblerIndex = 0;
    }
  }
}
