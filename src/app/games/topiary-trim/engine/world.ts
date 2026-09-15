export interface Stem {
  /** 中心からの固定配置角度(ラジアン)。育っても変わらない。 */
  readonly angle: number;
  /** 境界半径に対する比率。0で未成長、1で目標シルエットの輪郭。1を超えるとはみ出した状態。 */
  length: number;
  growthSpeedRatioPerSecond: number;
  /** はみ出した状態(length > 1)が連続している秒数。境界内に戻ると0にリセットされる。 */
  secondsSinceEscaped: number;
}

export interface PxPoint {
  readonly x: number;
  readonly y: number;
}

export interface StemBrokenEvent {
  readonly angle: number;
  readonly health: number;
}

export interface StemPrunedEvent {
  readonly angle: number;
  readonly points: number;
  readonly prunes: number;
}

export const HEALTH_MAX = 100;
export const STEM_COUNT = 16;
/** 目標シルエット(円)の半径。min(width, height) に対する比率。 */
export const BOUNDARY_RADIUS_RATIO = 0.36;
/** 境界からはみ出した状態がこの秒数続くと、枝は折れて長さ0から生え直す。 */
export const ESCAPE_GRACE_SECONDS = 3;
/** 剪定すると境界のわずか内側まで刈り戻される。 */
const PRUNE_TARGET_LENGTH_RATIO = 0.82;

const GROWTH_SPEED_MIN = 0.15;
const GROWTH_SPEED_MAX = 0.3;
const DIFFICULTY_RAMP_PER_SECOND = 0.02;
const DIFFICULTY_RAMP_MAX_MULTIPLIER = 2;
const BREAK_DAMAGE = 18;
const COVERAGE_SCORE_PER_SECOND = 40;
const PRUNE_BONUS_POINTS = 25;
export const SHEARS_ROTATION_SPEED_RADIANS_PER_SECOND = 2.1;

const ANGLE_PER_STEM = (Math.PI * 2) / STEM_COUNT;

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function normalizeAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  return ((angle % twoPi) + twoPi) % twoPi;
}

function angularDistance(a: number, b: number): number {
  const diff = Math.abs(normalizeAngle(a) - normalizeAngle(b));
  return Math.min(diff, Math.PI * 2 - diff);
}

/**
 * 中心から放射状に伸びる16本の枝を、目標シルエット(円)からはみ出す前に
 * 剪定し続けるリアルタイム・ガーデニングパズルの純粋ロジック層。
 * React / pixi.js には一切依存しない。
 *
 * 枝は角度を固定し「長さ(境界半径に対する比率)」だけを状態として持つ。
 * これにより resize() 時の再配置が不要になる(prism-drift / gold-seam と同じ方針)。
 * はみ出した枝(length > 1)を ESCAPE_GRACE_SECONDS 秒放置すると折れて体力が減り、
 * その枝は長さ0から生え直す。折れるまでの猶予を伸び速度と切り離すことで、
 * 描画フレームレートが落ちても剪定できる猶予時間が一定に保たれる。
 * 生え揃うほど(=はみ出さず境界近くを保つほど)継続的にスコアが入り、
 * 剪定にも即時ボーナスが入る。
 */
export class TopiaryTrimWorld {
  width = 0;
  height = 0;

  readonly stems: Stem[];
  shearsAngle = -Math.PI / 2;

  health = HEALTH_MAX;
  score = 0;
  prunes = 0;
  isOver = false;

  onStemBroken: ((event: StemBrokenEvent) => void) | null = null;
  onStemPruned: ((event: StemPrunedEvent) => void) | null = null;

  private elapsedSeconds = 0;
  private shearsRotationInput: -1 | 0 | 1 = 0;

  constructor(width: number, height: number) {
    this.stems = createStems();
    this.resize(width, height);
    this.reset();
  }

  reset(): void {
    for (const stem of this.stems) {
      stem.length = 0;
      stem.growthSpeedRatioPerSecond = randomRange(GROWTH_SPEED_MIN, GROWTH_SPEED_MAX);
      stem.secondsSinceEscaped = 0;
    }
    this.shearsAngle = -Math.PI / 2;
    this.shearsRotationInput = 0;
    this.health = HEALTH_MAX;
    this.score = 0;
    this.prunes = 0;
    this.isOver = false;
    this.elapsedSeconds = 0;
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.width = width;
    this.height = height;
  }

  setShearsRotationInput(direction: -1 | 0 | 1): void {
    this.shearsRotationInput = direction;
  }

  step(deltaSeconds: number): void {
    if (this.isOver || this.width <= 0 || this.height <= 0) return;

    this.elapsedSeconds += deltaSeconds;
    this.shearsAngle = normalizeAngle(
      this.shearsAngle +
        this.shearsRotationInput * SHEARS_ROTATION_SPEED_RADIANS_PER_SECOND * deltaSeconds,
    );

    const growthMultiplier = Math.min(
      DIFFICULTY_RAMP_MAX_MULTIPLIER,
      1 + this.elapsedSeconds * DIFFICULTY_RAMP_PER_SECOND,
    );

    for (const stem of this.stems) {
      stem.length += stem.growthSpeedRatioPerSecond * growthMultiplier * deltaSeconds;
      if (stem.length > 1) {
        stem.secondsSinceEscaped += deltaSeconds;
        if (stem.secondsSinceEscaped >= ESCAPE_GRACE_SECONDS) {
          stem.length = 0;
          stem.secondsSinceEscaped = 0;
          stem.growthSpeedRatioPerSecond = randomRange(GROWTH_SPEED_MIN, GROWTH_SPEED_MAX);
          this.health = Math.max(0, this.health - BREAK_DAMAGE);
          this.onStemBroken?.({ angle: stem.angle, health: this.health });
        }
      } else {
        stem.secondsSinceEscaped = 0;
      }
    }

    this.score += this.coverageRatio * COVERAGE_SCORE_PER_SECOND * deltaSeconds;

    if (this.health <= 0) {
      this.isOver = true;
    }
  }

  /** 目標シルエットの充填率(0〜1)。はみ出した枝は1として上限を掛けて数える。 */
  get coverageRatio(): number {
    const total = this.stems.reduce((sum, stem) => sum + Math.min(1, stem.length), 0);
    return total / this.stems.length;
  }

  /** 現在のシアー(はさみ)の角度で剪定を試みる。剪定できたら true。 */
  pruneAtShears(): boolean {
    return this.pruneAtAngle(this.shearsAngle);
  }

  /** 任意の角度(クリック/タップ位置から算出)で剪定を試みる。剪定できたら true。 */
  pruneAtAngle(angle: number): boolean {
    if (this.isOver) return false;
    const stem = this.stems[this.nearestStemIndex(angle)];
    if (stem.length <= 1) return false;

    stem.length = PRUNE_TARGET_LENGTH_RATIO;
    stem.secondsSinceEscaped = 0;
    this.score += PRUNE_BONUS_POINTS;
    this.prunes += 1;
    this.onStemPruned?.({ angle: stem.angle, points: PRUNE_BONUS_POINTS, prunes: this.prunes });
    return true;
  }

  /** クリック/タップ位置(実ピクセル座標)から角度を求め、剪定を試みる。 */
  pruneAtPointPx(x: number, y: number): boolean {
    const centerX = this.width / 2;
    const centerY = this.height / 2;
    return this.pruneAtAngle(Math.atan2(y - centerY, x - centerX));
  }

  getStemTipPx(stem: Stem): PxPoint {
    const centerX = this.width / 2;
    const centerY = this.height / 2;
    const radiusPx = Math.min(this.width, this.height) * BOUNDARY_RADIUS_RATIO * stem.length;
    return {
      x: centerX + radiusPx * Math.cos(stem.angle),
      y: centerY + radiusPx * Math.sin(stem.angle),
    };
  }

  getBoundaryRadiusPx(): number {
    return Math.min(this.width, this.height) * BOUNDARY_RADIUS_RATIO;
  }

  getShearsPointPx(): PxPoint {
    const centerX = this.width / 2;
    const centerY = this.height / 2;
    const radiusPx = this.getBoundaryRadiusPx() * 1.15;
    return {
      x: centerX + radiusPx * Math.cos(this.shearsAngle),
      y: centerY + radiusPx * Math.sin(this.shearsAngle),
    };
  }

  /** 最もはみ出している(=最も切迫している)枝を返す。無ければ null。 */
  getMostEscapedStem(): Stem | null {
    let found: Stem | null = null;
    for (const stem of this.stems) {
      if (stem.length <= 1) continue;
      if (!found || stem.length > found.length) found = stem;
    }
    return found;
  }

  private nearestStemIndex(angle: number): number {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.stems.length; i++) {
      const distance = angularDistance(angle, this.stems[i].angle);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }
    return bestIndex;
  }
}

function createStems(): Stem[] {
  return Array.from({ length: STEM_COUNT }, (_, i) => ({
    angle: normalizeAngle(-Math.PI / 2 + i * ANGLE_PER_STEM),
    length: 0,
    growthSpeedRatioPerSecond: randomRange(GROWTH_SPEED_MIN, GROWTH_SPEED_MAX),
    secondsSinceEscaped: 0,
  }));
}
