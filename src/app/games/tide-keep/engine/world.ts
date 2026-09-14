export interface WaveResolvedEvent {
  waveIndex: number;
  isKeepSafe: boolean;
  peakWaterLevel: number;
}

/** 浜を横断する砂の柱の本数。resize() では本数を変えず、各柱の高さだけを比例させる。 */
export const COLUMN_COUNT = 48;
/** 中央の「砦」ゾーンとみなす柱のインデックス範囲 [KEEP_START_INDEX, KEEP_END_INDEX)。 */
export const KEEP_START_INDEX = Math.floor(COLUMN_COUNT * 0.42);
export const KEEP_END_INDEX = Math.ceil(COLUMN_COUNT * 0.58);
/** 1回分の波のサージ(盛り上がり)が続く秒数。 */
export const WAVE_DURATION_SECONDS = 1.6;
/** 最初の波が来るまでの秒数。以降は経過時間に応じて短くなっていく。 */
export const WAVE_INTERVAL_START_SECONDS = 4.5;

const MAX_SAND_HEIGHT_RATIO = 0.6;
const INITIAL_SAND_HEIGHT_RATIO = 0.3;
const KEEP_REQUIRED_HEIGHT_RATIO = 0.3;
// ショベルの中心から何柱ぶん離れるまで砂を盛れるか。中心ほど多く、外側ほど少なく盛られる。
const PILE_RADIUS_COLUMNS = 4;
// ショベル中心が1秒あたりに到達できる高さ(maxSandHeightに対する割合)。
const PILE_RATE_RATIO = 0.9;
// 隣接する柱の高さへ毎秒どれだけ均されるか(尖った山を自然な砂山の形に近づける)。
const SETTLE_RATE_PER_SECOND = 1.6;
const TIDE_BASE_RATIO = 0.08;
const TIDE_RISE_PER_SECOND_RATIO = 0.004;
const TIDE_RISE_CAP_RATIO = 0.4;
const WAVE_INTERVAL_MIN_SECONDS = 1.8;
// 経過時間に応じて次の波までの間隔が短くなっていく速さ
const WAVE_INTERVAL_DECAY_PER_SECOND = 0.02;
const WAVE_SURGE_BASE_RATIO = 0.16;
// 波を重ねるたびにサージのピークが少しずつ強まっていく速さ
const WAVE_SURGE_GROWTH_PER_WAVE_RATIO = 0.02;
const WAVE_SURGE_CAP_RATIO = 0.35;
const WAVE_SURGE_JITTER_RATIO = 0.15;
// 水没している柱が1秒あたりに削られる高さ(maxSandHeightに対する割合)。値を大きくしすぎると
// 水没した瞬間にほぼ即死してしまい、盛り返す猶予がなくなるため、数秒は粘れる程度に抑えてある。
const EROSION_RATE_RATIO = 0.05;
const TIME_SCORE_RATE_PER_SECOND = 8;
const WAVE_SURVIVE_BONUS = 60;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * 満ちてくる潮から中央の砦を守り続けるリアルタイム築城サバイバルの純粋ロジック層。
 * React / pixi.js には一切依存しない。
 *
 * 浜は COLUMN_COUNT 本の砂柱(高さのみを持つ1次元配列)としてモデル化する。
 * プレイヤーはショベル位置に砂を盛り、潮位(ゆっくり上昇し続ける基準水位)と
 * 定期的に襲ってくる波のサージ(一時的な水位上昇のパルス)が水没した柱を削っていく。
 * 中央の「砦」ゾーンの柱がすべて要求高さを満たせなくなった瞬間にゲームオーバーになる。
 */
export class TideKeepWorld {
  width = 0;
  height = 0;

  /** 各柱の砂の高さ(px)。COLUMN_COUNT本で固定、resize()時に高さ方向だけ比例して伸縮する。 */
  sandHeights: number[] = [];
  /** ショベル(盛る位置)のx座標(px)。 */
  shovelX = 0;
  isPiling = false;

  score = 0;
  waveIndex = 0;
  wavesSurvived = 0;
  isOver = false;
  /** 生存(=プレイが進行)している秒数。reset()で0に戻る。 */
  elapsedSeconds = 0;

  private waveTimer = WAVE_INTERVAL_START_SECONDS;
  private activeWaveElapsed: number | null = null;
  private activeWavePeakRatio = 0;

  onWaveResolved: ((event: WaveResolvedEvent) => void) | null = null;

  constructor(width: number, height: number) {
    this.width = width > 0 ? width : 1;
    this.height = height > 0 ? height : 1;
    this.reset();
  }

  reset(): void {
    this.sandHeights = new Array(COLUMN_COUNT).fill(this.height * INITIAL_SAND_HEIGHT_RATIO);
    this.shovelX = this.width / 2;
    this.isPiling = false;
    this.score = 0;
    this.waveIndex = 0;
    this.wavesSurvived = 0;
    this.isOver = false;
    this.elapsedSeconds = 0;
    this.waveTimer = WAVE_INTERVAL_START_SECONDS;
    this.activeWaveElapsed = null;
    this.activeWavePeakRatio = 0;
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const scaleX = this.width > 0 ? width / this.width : 1;
    const scaleY = this.height > 0 ? height / this.height : 1;
    if (this.width > 0 && this.height > 0) {
      this.shovelX *= scaleX;
      for (let i = 0; i < this.sandHeights.length; i++) this.sandHeights[i] *= scaleY;
    }
    this.width = width;
    this.height = height;
  }

  get maxSandHeight(): number {
    return this.height * MAX_SAND_HEIGHT_RATIO;
  }

  get requiredKeepHeight(): number {
    return this.height * KEEP_REQUIRED_HEIGHT_RATIO;
  }

  get columnWidth(): number {
    return this.width / COLUMN_COUNT;
  }

  /** ゆっくり上昇し続ける潮の基準水位(px)。上限でクランプされる。 */
  get tideLevel(): number {
    const riseRatio = Math.min(
      TIDE_RISE_CAP_RATIO,
      TIDE_BASE_RATIO + this.elapsedSeconds * TIDE_RISE_PER_SECOND_RATIO,
    );
    return this.height * riseRatio;
  }

  /** 現在進行中の波サージの高さ比率(0〜)。波が来ていなければ0。 */
  get waveSurgeRatio(): number {
    if (this.activeWaveElapsed === null) return 0;
    const t = clamp(this.activeWaveElapsed / WAVE_DURATION_SECONDS, 0, 1);
    return this.activeWavePeakRatio * Math.sin(Math.PI * t);
  }

  /** 潮位+波サージを合わせた、いま実際に水没判定に使われる水位(px)。 */
  get waterLevel(): number {
    return this.tideLevel + this.height * this.waveSurgeRatio;
  }

  /** 砦ゾーンの健全度(0〜1)。0になった瞬間に砦は流される。 */
  get keepIntegrity(): number {
    let minHeight = Number.POSITIVE_INFINITY;
    for (let i = KEEP_START_INDEX; i < KEEP_END_INDEX; i++) {
      minHeight = Math.min(minHeight, this.sandHeights[i]);
    }
    if (!Number.isFinite(minHeight)) return 0;
    return clamp(minHeight / this.requiredKeepHeight, 0, 1);
  }

  setShovelPosition(x: number): void {
    this.shovelX = clamp(x, 0, this.width);
  }

  moveShovelBy(dx: number): void {
    this.setShovelPosition(this.shovelX + dx);
  }

  setPiling(isPiling: boolean): void {
    this.isPiling = isPiling;
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    this.elapsedSeconds += deltaSeconds;
    this.advanceWaveSchedule(deltaSeconds);

    const waterLevel = this.waterLevel;
    this.applyErosion(waterLevel, deltaSeconds);
    if (this.isPiling) this.applyPiling(deltaSeconds);
    this.applySettling(deltaSeconds);

    if (this.keepIntegrity <= 0) this.isOver = true;
    this.resolveWaveIfFinished();

    this.score =
      Math.floor(this.elapsedSeconds * TIME_SCORE_RATE_PER_SECOND) +
      this.wavesSurvived * WAVE_SURVIVE_BONUS;
  }

  private advanceWaveSchedule(deltaSeconds: number): void {
    if (this.activeWaveElapsed !== null) {
      this.activeWaveElapsed += deltaSeconds;
      return;
    }

    this.waveTimer -= deltaSeconds;
    if (this.waveTimer > 0) return;

    this.waveIndex += 1;
    this.activeWaveElapsed = 0;
    const growth = Math.min(
      WAVE_SURGE_CAP_RATIO - WAVE_SURGE_BASE_RATIO,
      (this.waveIndex - 1) * WAVE_SURGE_GROWTH_PER_WAVE_RATIO,
    );
    const jitter = 1 + randRange(-WAVE_SURGE_JITTER_RATIO, WAVE_SURGE_JITTER_RATIO);
    this.activeWavePeakRatio = Math.max(0, (WAVE_SURGE_BASE_RATIO + growth) * jitter);
    this.waveTimer = Math.max(
      WAVE_INTERVAL_MIN_SECONDS,
      WAVE_INTERVAL_START_SECONDS - this.elapsedSeconds * WAVE_INTERVAL_DECAY_PER_SECOND,
    );
  }

  private resolveWaveIfFinished(): void {
    if (this.activeWaveElapsed === null || this.activeWaveElapsed < WAVE_DURATION_SECONDS) return;

    const isKeepSafe = !this.isOver;
    if (isKeepSafe) this.wavesSurvived += 1;
    this.onWaveResolved?.({
      waveIndex: this.waveIndex,
      isKeepSafe,
      peakWaterLevel: this.waterLevel,
    });
    this.activeWaveElapsed = null;
  }

  private applyErosion(waterLevel: number, deltaSeconds: number): void {
    const erosionAmount = this.height * EROSION_RATE_RATIO * deltaSeconds;
    for (let i = 0; i < COLUMN_COUNT; i++) {
      if (this.sandHeights[i] < waterLevel) {
        this.sandHeights[i] = Math.max(0, this.sandHeights[i] - erosionAmount);
      }
    }
  }

  private applyPiling(deltaSeconds: number): void {
    const centerIndex = clamp(Math.floor(this.shovelX / this.columnWidth), 0, COLUMN_COUNT - 1);
    const pileRate = this.maxSandHeight * PILE_RATE_RATIO;
    for (let offset = -PILE_RADIUS_COLUMNS; offset <= PILE_RADIUS_COLUMNS; offset++) {
      const index = centerIndex + offset;
      if (index < 0 || index >= COLUMN_COUNT) continue;

      const falloff = 1 - Math.abs(offset) / (PILE_RADIUS_COLUMNS + 1);
      if (falloff <= 0) continue;

      const gained = pileRate * falloff * deltaSeconds;
      this.sandHeights[index] = Math.min(this.maxSandHeight, this.sandHeights[index] + gained);
    }
  }

  private applySettling(deltaSeconds: number): void {
    const rate = Math.min(1, SETTLE_RATE_PER_SECOND * deltaSeconds);
    const next = this.sandHeights.slice();
    for (let i = 0; i < COLUMN_COUNT; i++) {
      const left = this.sandHeights[Math.max(0, i - 1)];
      const right = this.sandHeights[Math.min(COLUMN_COUNT - 1, i + 1)];
      const neighborAverage = (left + right) / 2;
      next[i] = this.sandHeights[i] + (neighborAverage - this.sandHeights[i]) * rate;
    }
    this.sandHeights = next;
  }
}
