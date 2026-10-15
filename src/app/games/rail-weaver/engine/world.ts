export type LayResult = "filled" | "no-target" | "no-stock";

export interface TrackGap {
  readonly id: number;
  /** カート先頭からこのギャップまでの距離(ワールド単位)。0以下になると未補修のまま到達。 */
  distanceAhead: number;
  isFilled: boolean;
}

const INITIAL_SPEED = 1.6;
export const MAX_SPEED = 4.2;
const SPEED_GROWTH_PER_DISTANCE = 0.015;

const INITIAL_SPAWN_INTERVAL = 2.1;
export const MIN_SPAWN_INTERVAL = 0.9;
const SPAWN_INTERVAL_DECAY_PER_DISTANCE = 0.009;

const WARMUP_SECONDS = 1.3;
/** ギャップが新たに現れる地点(カートからの距離)。 */
export const SPAWN_DISTANCE_AHEAD = 8.5;
/**
 * この距離以内に近づいたギャップだけ、板を渡して補修できる。
 * 序盤(速度が遅いうち)は距離/速度でおよそ2秒前後の反応時間になるよう大きめに取ってある。
 */
export const REACH_DISTANCE = 3.2;
/** カートを通過した後、このぶん後方まで描画用に残してから配列から除く。 */
const CLEANUP_DISTANCE_BEHIND = -1;

export const PLANK_STOCK_MAX = 4;
const PLANK_REGEN_INTERVAL = 1.6;

const SCORE_PER_PLANK = 100;
const COMBO_BONUS_PER_STREAK = 10;

/**
 * 峡谷を渡るトロッコの前方に途切れたレールが現れ続けるリアルタイム補修パズルの
 * 純粋ロジック層。React / pixi.js には依存しない。
 */
export class RailWeaverWorld {
  private _gaps: TrackGap[] = [];
  private nextId = 0;
  private spawnTimer = WARMUP_SECONDS;
  private plankRegenTimer = PLANK_REGEN_INTERVAL;

  distance = 0;
  score = 0;
  combo = 0;
  plankStock = PLANK_STOCK_MAX;
  isOver = false;

  onLay: ((result: LayResult) => void) | null = null;
  onCrash: (() => void) | null = null;

  constructor() {
    this.reset();
  }

  get gaps(): readonly TrackGap[] {
    return this._gaps;
  }

  get speed(): number {
    return Math.min(MAX_SPEED, INITIAL_SPEED + this.distance * SPEED_GROWTH_PER_DISTANCE);
  }

  get spawnInterval(): number {
    return Math.max(
      MIN_SPAWN_INTERVAL,
      INITIAL_SPAWN_INTERVAL - this.distance * SPAWN_INTERVAL_DECAY_PER_DISTANCE,
    );
  }

  reset(): void {
    this._gaps = [];
    this.nextId = 0;
    this.spawnTimer = WARMUP_SECONDS;
    this.plankRegenTimer = PLANK_REGEN_INTERVAL;
    this.distance = 0;
    this.score = 0;
    this.combo = 0;
    this.plankStock = PLANK_STOCK_MAX;
    this.isOver = false;
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    const travel = this.speed * deltaSeconds;
    this.distance += travel;
    for (const gap of this._gaps) gap.distanceAhead -= travel;

    const crashed = this._gaps.find((gap) => !gap.isFilled && gap.distanceAhead <= 0);
    if (crashed) {
      this.isOver = true;
      this.onCrash?.();
      return;
    }

    this._gaps = this._gaps.filter((gap) => gap.distanceAhead > CLEANUP_DISTANCE_BEHIND);

    if (this.plankStock < PLANK_STOCK_MAX) {
      this.plankRegenTimer -= deltaSeconds;
      if (this.plankRegenTimer <= 0) {
        this.plankStock += 1;
        this.plankRegenTimer = PLANK_REGEN_INTERVAL;
      }
    } else {
      // 満タンの間はタイマーを貯めない: 消費した直後にすぐ1本戻ってしまうのを防ぐ。
      this.plankRegenTimer = PLANK_REGEN_INTERVAL;
    }

    this.spawnTimer -= deltaSeconds;
    if (this.spawnTimer <= 0) {
      this._gaps.push({ id: this.nextId++, distanceAhead: SPAWN_DISTANCE_AHEAD, isFilled: false });
      this.spawnTimer = this.spawnInterval;
    }
  }

  /** 補修圏内で最も近い、まだ塞がれていないギャップ。無ければnull。UIのハイライト表示用。 */
  nextLayableGap(): TrackGap | null {
    let best: TrackGap | null = null;
    for (const gap of this._gaps) {
      if (gap.isFilled) continue;
      if (gap.distanceAhead <= 0 || gap.distanceAhead > REACH_DISTANCE) continue;
      if (!best || gap.distanceAhead < best.distanceAhead) best = gap;
    }
    return best;
  }

  /** 補修圏内で最も近いギャップに板を渡す。タップ/クリック/Enterキーから呼ばれる。 */
  layPlank(): LayResult {
    if (this.isOver) {
      this.onLay?.("no-target");
      return "no-target";
    }

    const target = this.nextLayableGap();
    if (!target) {
      this.onLay?.("no-target");
      return "no-target";
    }
    if (this.plankStock <= 0) {
      this.onLay?.("no-stock");
      return "no-stock";
    }

    target.isFilled = true;
    this.plankStock -= 1;
    this.score += SCORE_PER_PLANK + this.combo * COMBO_BONUS_PER_STREAK;
    this.combo += 1;
    this.onLay?.("filled");
    return "filled";
  }
}
