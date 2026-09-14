export const THREAD_COLORS = ["indigo", "gold", "crimson"] as const;
export type ThreadColor = (typeof THREAD_COLORS)[number];

export interface WovenRow {
  id: number;
  color: ThreadColor;
  isFlawed: boolean;
}

export interface BeatResolvedEvent {
  isCorrect: boolean;
  requiredColor: ThreadColor;
  combo: number;
  points: number;
}

export type WeaveOutcome = "torn" | "finished" | null;

export const TARGET_ROWS = 36;
export const INTEGRITY_MAX = 100;
const INITIAL_BEAT_SECONDS = 1.3;
const MIN_BEAT_SECONDS = 0.55;
const BEAT_SPEEDUP_PER_ROW = 0.018;
const INTEGRITY_LOSS_PER_MISS = 20;
const INTEGRITY_GAIN_PER_HIT = 3;
const SCORE_PER_HIT = 100;
const COMBO_BONUS_PER_EXTRA = 25;
const QUEUE_LOOKAHEAD = 5;

let nextRowId = 1;

function randomColor(): ThreadColor {
  const index = Math.floor(Math.random() * THREAD_COLORS.length);
  return THREAD_COLORS[index];
}

/**
 * 機織りのリアルタイム状態。シャトルは常に一定周期(beatInterval)で往復しており、
 * その周期内に指示された糸色を選べたかどうかだけを問う。フレーム完璧な
 * タイミング判定にはしていないため、指の遅いタップやマウスクリックでも
 * 「間に合ったかどうか」の一問一答として成立する。
 */
export class LoomWeaveWorld {
  private _rows: WovenRow[] = [];
  private _queue: ThreadColor[] = [];
  beatInterval = INITIAL_BEAT_SECONDS;
  beatTimer = INITIAL_BEAT_SECONDS;
  integrity = INTEGRITY_MAX;
  score = 0;
  combo = 0;
  maxCombo = 0;
  isOver = false;
  outcome: WeaveOutcome = null;

  onBeatResolved: ((event: BeatResolvedEvent) => void) | null = null;

  constructor() {
    this.reset();
  }

  get rows(): readonly WovenRow[] {
    return this._rows;
  }

  get queue(): readonly ThreadColor[] {
    return this._queue;
  }

  get activeColor(): ThreadColor {
    return this._queue[0];
  }

  get upcomingColors(): readonly ThreadColor[] {
    return this._queue.slice(1);
  }

  get beatRatio(): number {
    if (this.beatInterval <= 0) return 0;
    return Math.min(1, Math.max(0, this.beatTimer / this.beatInterval));
  }

  reset(): void {
    this._rows = [];
    this._queue = Array.from({ length: QUEUE_LOOKAHEAD }, () => randomColor());
    this.beatInterval = INITIAL_BEAT_SECONDS;
    this.beatTimer = this.beatInterval;
    this.integrity = INTEGRITY_MAX;
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.isOver = false;
    this.outcome = null;
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    this.beatTimer -= deltaSeconds;
    if (this.beatTimer <= 0) {
      this.resolveBeat(false);
    }
  }

  /** プレイヤーが糸色を選択した瞬間に呼ぶ。 */
  selectColor(color: ThreadColor): void {
    if (this.isOver) return;
    this.resolveBeat(color === this.activeColor);
  }

  private resolveBeat(isCorrect: boolean): void {
    const requiredColor = this._queue.shift();
    if (requiredColor === undefined) return;
    this._queue.push(randomColor());

    let points = 0;
    if (isCorrect) {
      this.combo += 1;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      points = SCORE_PER_HIT + (this.combo - 1) * COMBO_BONUS_PER_EXTRA;
      this.score += points;
      this.integrity = Math.min(INTEGRITY_MAX, this.integrity + INTEGRITY_GAIN_PER_HIT);
      this.beatInterval = Math.max(MIN_BEAT_SECONDS, this.beatInterval - BEAT_SPEEDUP_PER_ROW);
    } else {
      this.combo = 0;
      this.integrity = Math.max(0, this.integrity - INTEGRITY_LOSS_PER_MISS);
    }

    this._rows.push({ id: nextRowId++, color: requiredColor, isFlawed: !isCorrect });
    this.onBeatResolved?.({ isCorrect, requiredColor, combo: this.combo, points });

    this.beatTimer = this.beatInterval;

    if (this.integrity <= 0) {
      this.isOver = true;
      this.outcome = "torn";
      return;
    }
    if (this._rows.length >= TARGET_ROWS) {
      this.isOver = true;
      this.outcome = "finished";
    }
  }
}
