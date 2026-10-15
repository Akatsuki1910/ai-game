export interface Lane {
  load: number;
  /** このレーンの積雪ペース(1秒あたり)。レーンごとに固定でばらつく。 */
  rate: number;
}

export interface ReleaseEvent {
  laneIndex: number;
  points: number;
  isClutch: boolean;
}

export interface CollapseEvent {
  laneIndex: number;
  /** 自然崩落が別の崩落の飛び火で起きたものかどうか。 */
  isChained: boolean;
}

export interface StormEvent {
  boost: number;
}

export interface GameOverEvent {
  score: number;
}

export const LANE_COUNT = 6;
export const VILLAGE_HEALTH_MAX = 100;
export const LOAD_MAX = 1;
/** この積雪量以上で解放すると「際どい解放」ボーナスが付き、隣へ雪が飛び火する。 */
export const CHAIN_THRESHOLD = 0.6;
export const STORM_INTERVAL_SECONDS = 14;
/** 開始時にレーンへ最大でどれだけ雪が積もっていることがあるか。 */
export const INITIAL_LOAD_MAX = 0.35;

const BASE_LOAD_RATE_MIN = 0.05;
const BASE_LOAD_RATE_MAX = 0.09;
const RAMP_PER_SECOND = 0.01;
const RAMP_CAP = 2.5;
const UNCONTROLLED_DAMAGE = 15;
const CHAIN_BONUS = 50;
// 自然崩落の飛び火を強くしすぎると、全レーンがほぼ同時に積もりきったときに
// 一撃で盤面全体が連鎖崩落して即ゲームオーバーになってしまうため、控えめにする。
const SPILL_FACTOR = 0.2;
const STORM_BOOST = 0.08;
// 飛び火の連鎖が万一ループしても必ず止まるようにする安全弁(レーン数を超えて連鎖することはない)。
const MAX_SPILL_CHAIN_DEPTH = LANE_COUNT;

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * 尾根の監視員となり、斜面レーンに積もる雪を限界前に人為的に崩し続けて
 * 麓の集落を雪崩から守るリアルタイム防災シミュレーションの純粋ロジック層。
 * React / pixi.js には依存しない。
 *
 * レーンの積雪(load)は時間とともに自動的に増え、LOAD_MAX に達すると
 * 「自然崩落」として集落にダメージが入る。プレイヤーが手動で release() すると
 * ダメージなしで得点化できるが、CHAIN_THRESHOLD 以上まで溜め込んでからの
 * 解放は高得点な代わりに隣のレーンへ雪を飛び火させ、連鎖崩落の火種になる。
 */
export class CorniceWatchWorld {
  lanes: Lane[] = [];
  villageHealth = VILLAGE_HEALTH_MAX;
  score = 0;
  isOver = false;
  private elapsedSeconds = 0;
  private nextStormAt = STORM_INTERVAL_SECONDS;

  onRelease: ((event: ReleaseEvent) => void) | null = null;
  onCollapse: ((event: CollapseEvent) => void) | null = null;
  onStorm: ((event: StormEvent) => void) | null = null;
  onGameOver: ((event: GameOverEvent) => void) | null = null;

  constructor() {
    this.reset();
  }

  reset(): void {
    // 各レーンの初期積雪量とペースにばらつきを持たせ、全レーンが同時に満杯へ
    // 到達して盤面が一撃で崩壊するのを避ける(タイミングを分散させる)。
    this.lanes = Array.from({ length: LANE_COUNT }, () => ({
      load: randRange(0, INITIAL_LOAD_MAX),
      rate: randRange(BASE_LOAD_RATE_MIN, BASE_LOAD_RATE_MAX),
    }));
    this.villageHealth = VILLAGE_HEALTH_MAX;
    this.score = 0;
    this.isOver = false;
    this.elapsedSeconds = 0;
    this.nextStormAt = STORM_INTERVAL_SECONDS;
  }

  get secondsUntilStorm(): number {
    return Math.max(0, this.nextStormAt - this.elapsedSeconds);
  }

  private get rampMultiplier(): number {
    return Math.min(RAMP_CAP, 1 + this.elapsedSeconds * RAMP_PER_SECOND);
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;
    this.elapsedSeconds += deltaSeconds;

    if (this.elapsedSeconds >= this.nextStormAt) {
      this.nextStormAt += STORM_INTERVAL_SECONDS;
      for (const lane of this.lanes) lane.load = Math.min(LOAD_MAX, lane.load + STORM_BOOST);
      this.onStorm?.({ boost: STORM_BOOST });
    }

    const multiplier = this.rampMultiplier;
    for (let i = 0; i < this.lanes.length; i++) {
      const lane = this.lanes[i];
      lane.load = Math.min(LOAD_MAX, lane.load + lane.rate * multiplier * deltaSeconds);
      if (lane.load >= LOAD_MAX) {
        this.collapseLane(i, false, 0);
        if (this.isOver) return;
      }
    }
  }

  /** レーンを人為的に解放する(制御された雪崩)。積雪量に応じて得点化される。 */
  release(laneIndex: number): void {
    if (this.isOver) return;
    const lane = this.lanes[laneIndex];
    if (!lane || lane.load <= 0) return;

    const load = lane.load;
    const points = Math.round(load * 100);
    const isClutch = load >= CHAIN_THRESHOLD;
    lane.load = 0;
    this.score += points + (isClutch ? CHAIN_BONUS : 0);
    this.onRelease?.({ laneIndex, points, isClutch });

    if (isClutch) {
      this.spillToNeighbors(laneIndex, load * SPILL_FACTOR, 0);
    }
  }

  private spillToNeighbors(laneIndex: number, amount: number, depth: number): void {
    if (depth >= MAX_SPILL_CHAIN_DEPTH) return;
    for (const neighborIndex of [laneIndex - 1, laneIndex + 1]) {
      const neighbor = this.lanes[neighborIndex];
      if (!neighbor) continue;
      neighbor.load = Math.min(LOAD_MAX, neighbor.load + amount);
      if (neighbor.load >= LOAD_MAX) {
        this.collapseLane(neighborIndex, true, depth + 1);
        if (this.isOver) return;
      }
    }
  }

  private collapseLane(laneIndex: number, isChained: boolean, spillDepth: number): void {
    const lane = this.lanes[laneIndex];
    if (!lane) return;
    const collapsedLoad = lane.load;
    lane.load = 0;
    this.villageHealth = Math.max(0, this.villageHealth - UNCONTROLLED_DAMAGE);
    this.onCollapse?.({ laneIndex, isChained });

    if (this.villageHealth <= 0) {
      this.isOver = true;
      this.onGameOver?.({ score: this.score });
      return;
    }

    // 自然崩落も勢いで隣に雪をまき散らし、連鎖崩落の火種になり得る。
    this.spillToNeighbors(laneIndex, collapsedLoad * SPILL_FACTOR, spillDepth);
  }
}
