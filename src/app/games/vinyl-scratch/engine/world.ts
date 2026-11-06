export type ScratchDirection = "forward" | "back";

export type CueJudgement = "perfect" | "good";
export type CueMissReason = "wrong" | "timing" | "timeout";

export interface ScratchCue {
  /** ステージ開始からの経過秒数で、このキューを判定ラインで捌くべき瞬間。 */
  time: number;
  direction: ScratchDirection;
}

export interface CueJudgedEvent {
  direction: ScratchDirection;
  judgement: CueJudgement;
  points: number;
  combo: number;
}

export interface CueMissedEvent {
  reason: CueMissReason;
  hypeRemaining: number;
}

export interface VisibleCue {
  direction: ScratchDirection;
  time: number;
  /** 判定ラインまでの残り秒数。負の値は判定ラインを過ぎてまだ判定待ちであることを表す。 */
  secondsUntilHit: number;
}

export const START_HYPE = 100;

/** この秒数以内に正しい方向へ擦れば PERFECT。 */
export const PERFECT_WINDOW_SECONDS = 0.09;
/** この秒数以内なら(方向が合っていれば) GOOD。これを超えるとミス扱い。 */
export const GOOD_WINDOW_SECONDS = 0.24;
/** キューが判定ラインに近づいてくる様子を描画で見せる先読み秒数。 */
export const APPROACH_SECONDS = 1.5;

const LEAD_IN_SECONDS = 2.5;
const BASE_INTERVAL_SECONDS = 1.15;
const MIN_INTERVAL_SECONDS = 0.5;
const INTERVAL_RAMP_PER_SECOND = 0.012;
const GENERATE_LOOKAHEAD_SECONDS = APPROACH_SECONDS + 1;

const HYPE_GAIN_PERFECT = 6;
const HYPE_GAIN_GOOD = 3;
const HYPE_LOSS_MISS = 16;

const BASE_POINTS = 100;
const PERFECT_BONUS = 40;
const COMBO_BONUS_PER_STREAK = 6;
const MAX_COMBO_BONUS = 120;

/** 経過時間が長いほどキューの間隔が詰まっていく(最短値でクランプ)。 */
function intervalSecondsAt(elapsedSeconds: number): number {
  return Math.max(
    MIN_INTERVAL_SECONDS,
    BASE_INTERVAL_SECONDS - elapsedSeconds * INTERVAL_RAMP_PER_SECOND,
  );
}

/**
 * ターンテーブルを操るリアルタイム・スクラッチDJパズルの純粋ロジック層。
 * React / pixi.js には一切依存せず、画面サイズにも依存しない。
 *
 * 判定の方針: 「待っていても何も起きない」状態を作らないため、現在の対象キューに対する
 * scratch() の呼び出しは常にヒット(PERFECT/GOOD)かミスのどちらかに必ず解決する
 * (方向が違う、またはタイミングが窓の外なら問答無用でミス)。入力しないまま窓を過ぎた
 * 場合は step() 側でタイムアウトミスとして自動的に処理される。
 */
export class VinylScratchWorld {
  score = 0;
  combo = 0;
  maxCombo = 0;
  hype = START_HYPE;
  isOver = false;
  elapsed = 0;

  cues: ScratchCue[] = [];
  /** cues の中で、まだ判定されていない最初のキューのインデックス。 */
  cueIndex = 0;

  onCueJudged: ((event: CueJudgedEvent) => void) | null = null;
  onCueMissed: ((event: CueMissedEvent) => void) | null = null;

  private nextCueTime = LEAD_IN_SECONDS;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.hype = START_HYPE;
    this.isOver = false;
    this.elapsed = 0;
    this.cues = [];
    this.cueIndex = 0;
    this.nextCueTime = LEAD_IN_SECONDS;
    this.generateUpcomingCues();
  }

  /** 現在捌くべき(まだ判定されていない)キュー。 */
  get currentCue(): ScratchCue | null {
    return this.cueIndex < this.cues.length ? this.cues[this.cueIndex] : null;
  }

  /** 描画用に、これから判定ラインへ近づいてくるキューを時間順に返す。 */
  getVisibleCues(): VisibleCue[] {
    const visible: VisibleCue[] = [];
    for (let i = this.cueIndex; i < this.cues.length; i++) {
      const cue = this.cues[i];
      const secondsUntilHit = cue.time - this.elapsed;
      if (secondsUntilHit > APPROACH_SECONDS) break;
      visible.push({ direction: cue.direction, time: cue.time, secondsUntilHit });
    }
    return visible;
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    this.elapsed += deltaSeconds;
    this.generateUpcomingCues();

    while (
      !this.isOver &&
      this.cueIndex < this.cues.length &&
      this.elapsed - this.cues[this.cueIndex].time > GOOD_WINDOW_SECONDS
    ) {
      this.resolveMiss("timeout");
    }
  }

  /** プレイヤーがターンテーブルを擦った瞬間に呼ぶ。現在の対象キューを必ずヒットかミスへ解決する。 */
  scratch(direction: ScratchDirection): void {
    if (this.isOver || this.cueIndex >= this.cues.length) return;

    const cue = this.cues[this.cueIndex];
    if (cue.direction !== direction) {
      this.resolveMiss("wrong");
      return;
    }

    const distance = Math.abs(this.elapsed - cue.time);
    if (distance > GOOD_WINDOW_SECONDS) {
      this.resolveMiss("timing");
      return;
    }

    this.resolveHit(cue, distance <= PERFECT_WINDOW_SECONDS ? "perfect" : "good");
  }

  private generateUpcomingCues(): void {
    const lookaheadTime = this.elapsed + GENERATE_LOOKAHEAD_SECONDS;
    while (this.nextCueTime <= lookaheadTime) {
      const direction: ScratchDirection = Math.random() < 0.5 ? "forward" : "back";
      this.cues.push({ time: this.nextCueTime, direction });
      this.nextCueTime += intervalSecondsAt(this.elapsed);
    }
  }

  private resolveHit(cue: ScratchCue, judgement: CueJudgement): void {
    this.cueIndex += 1;
    this.combo += 1;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.hype = Math.min(
      START_HYPE,
      this.hype + (judgement === "perfect" ? HYPE_GAIN_PERFECT : HYPE_GAIN_GOOD),
    );

    const comboBonus = Math.min(MAX_COMBO_BONUS, this.combo * COMBO_BONUS_PER_STREAK);
    const perfectBonus = judgement === "perfect" ? PERFECT_BONUS : 0;
    const points = BASE_POINTS + comboBonus + perfectBonus;
    this.score += points;
    this.onCueJudged?.({ direction: cue.direction, judgement, points, combo: this.combo });
  }

  private resolveMiss(reason: CueMissReason): void {
    this.cueIndex += 1;
    this.combo = 0;
    this.hype = Math.max(0, this.hype - HYPE_LOSS_MISS);
    this.onCueMissed?.({ reason, hypeRemaining: this.hype });

    if (this.hype <= 0) {
      this.isOver = true;
    }
  }
}
