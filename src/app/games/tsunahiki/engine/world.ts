export type PullJudgement = "perfect" | "good";
export type PullMissReason = "timing" | "timeout";

export interface ChantBeat {
  /** ステージ開始からの経過秒数で、綱を引くべき掛け声の瞬間。 */
  time: number;
}

export interface PullResultEvent {
  judgement: PullJudgement;
  ropePosition: number;
  scoreGained: number;
  combo: number;
  round: number;
  roundWon: boolean;
}

export interface PullMissedEvent {
  reason: PullMissReason;
  ropePosition: number;
}

export interface VisibleBeat {
  time: number;
  /** 判定ラインまでの残り秒数。負の値は判定ラインを過ぎてまだ判定待ちであることを表す。 */
  secondsUntilHit: number;
}

export const ROPE_MIN = 0;
export const ROPE_MAX = 100;
export const ROPE_START = 50;

/** この秒数以内に引けばPERFECT。 */
export const PERFECT_WINDOW_SECONDS = 0.1;
/** この秒数以内なら GOOD。これを超えるとミス扱い。 */
export const GOOD_WINDOW_SECONDS = 0.26;
/** 掛け声が判定ラインに近づいてくる様子を描画で見せる先読み秒数。 */
export const APPROACH_SECONDS = 1.6;

const LEAD_IN_SECONDS = 1.6;
const BASE_INTERVAL_SECONDS = 1.3;
const MIN_INTERVAL_SECONDS = 0.55;
const INTERVAL_SHRINK_PER_ROUND = 0.09;
const GENERATE_LOOKAHEAD_SECONDS = APPROACH_SECONDS + 1;

const PERFECT_GAIN = 11;
const GOOD_GAIN = 5;
const COMBO_GAIN_BONUS = 0.7;
const MAX_COMBO_FOR_GAIN = 10;

const TIMING_MISS_LOSS = 6;
const TIMEOUT_MISS_LOSS = 9;

const PERFECT_SCORE = 100;
const GOOD_SCORE = 50;
const COMBO_SCORE_BONUS = 10;
const MAX_COMBO_FOR_SCORE = 12;
const ROUND_CLEAR_BONUS = 200;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** ラウンドが進むほど掛け声の間隔が詰まっていく(最短値でクランプ)。 */
function intervalSecondsAtRound(round: number): number {
  return Math.max(
    MIN_INTERVAL_SECONDS,
    BASE_INTERVAL_SECONDS - (round - 1) * INTERVAL_SHRINK_PER_ROUND,
  );
}

/**
 * 祭りの綱引き(綱引き)を掛け声のリズムで戦うリアルタイム・タイミングパズルの純粋ロジック層。
 * React / pixi.js には一切依存せず、画面サイズにも依存しない。
 *
 * 判定の方針: 「待っていても何も起きない」状態を作らないため、pull() の呼び出しは
 * 現在の対象ビート(掛け声)を常にヒット(PERFECT/GOOD)かミスのどちらかに必ず解決する
 * (タイミングが窓の外なら問答無用でミス)。入力しないまま窓を過ぎた場合は
 * step() 側でタイムアウトミスとして自動的に処理される。
 */
export class TsunahikiWorld {
  round = 1;
  /** 0(相手側の勝ち)〜100(自陣の勝ち=ラウンドクリア)。 */
  ropePosition = ROPE_START;
  score = 0;
  combo = 0;
  maxCombo = 0;
  isOver = false;
  elapsed = 0;

  beats: ChantBeat[] = [];
  /** beats の中で、まだ判定されていない最初のビートのインデックス。 */
  beatIndex = 0;

  onPullResolved: ((event: PullResultEvent) => void) | null = null;
  onPullMissed: ((event: PullMissedEvent) => void) | null = null;

  private nextBeatTime = LEAD_IN_SECONDS;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.round = 1;
    this.ropePosition = ROPE_START;
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.isOver = false;
    this.elapsed = 0;
    this.beats = [];
    this.beatIndex = 0;
    this.nextBeatTime = LEAD_IN_SECONDS;
    this.generateUpcomingBeats();
  }

  /** 現在引くべき(まだ判定されていない)掛け声のビート。 */
  get currentBeat(): ChantBeat | null {
    return this.beatIndex < this.beats.length ? this.beats[this.beatIndex] : null;
  }

  /** 描画用に、これから判定ラインへ近づいてくるビートを時間順に返す。 */
  getVisibleBeats(): VisibleBeat[] {
    const visible: VisibleBeat[] = [];
    for (let i = this.beatIndex; i < this.beats.length; i++) {
      const beat = this.beats[i];
      const secondsUntilHit = beat.time - this.elapsed;
      if (secondsUntilHit > APPROACH_SECONDS) break;
      visible.push({ time: beat.time, secondsUntilHit });
    }
    return visible;
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    this.elapsed += deltaSeconds;
    this.generateUpcomingBeats();

    while (
      !this.isOver &&
      this.beatIndex < this.beats.length &&
      this.elapsed - this.beats[this.beatIndex].time > GOOD_WINDOW_SECONDS
    ) {
      this.resolveMiss("timeout");
    }
  }

  /** 「ヨイショ!」の掛け声に合わせて綱を引く。現在の対象ビートを必ずヒットかミスへ解決する。 */
  pull(): void {
    if (this.isOver || this.beatIndex >= this.beats.length) return;

    const beat = this.beats[this.beatIndex];
    const distance = Math.abs(this.elapsed - beat.time);
    if (distance > GOOD_WINDOW_SECONDS) {
      this.resolveMiss("timing");
      return;
    }

    this.resolveHit(beat, distance <= PERFECT_WINDOW_SECONDS ? "perfect" : "good");
  }

  private generateUpcomingBeats(): void {
    const lookaheadTime = this.elapsed + GENERATE_LOOKAHEAD_SECONDS;
    while (this.nextBeatTime <= lookaheadTime) {
      this.beats.push({ time: this.nextBeatTime });
      this.nextBeatTime += intervalSecondsAtRound(this.round);
    }
  }

  private resolveHit(_beat: ChantBeat, judgement: PullJudgement): void {
    this.beatIndex += 1;
    this.combo += 1;
    this.maxCombo = Math.max(this.maxCombo, this.combo);

    const comboForGain = Math.min(this.combo, MAX_COMBO_FOR_GAIN);
    const gain =
      (judgement === "perfect" ? PERFECT_GAIN : GOOD_GAIN) + comboForGain * COMBO_GAIN_BONUS;
    this.ropePosition = clamp(this.ropePosition + gain, ROPE_MIN, ROPE_MAX);

    const comboBonusScore = Math.min(this.combo, MAX_COMBO_FOR_SCORE) * COMBO_SCORE_BONUS;
    let scoreGained = (judgement === "perfect" ? PERFECT_SCORE : GOOD_SCORE) + comboBonusScore;

    let roundWon = false;
    if (this.ropePosition >= ROPE_MAX) {
      roundWon = true;
      scoreGained += ROUND_CLEAR_BONUS;
      this.round += 1;
      this.ropePosition = ROPE_START;
    }

    this.score += scoreGained;

    this.onPullResolved?.({
      judgement,
      ropePosition: this.ropePosition,
      scoreGained,
      combo: this.combo,
      round: this.round,
      roundWon,
    });
  }

  private resolveMiss(reason: PullMissReason): void {
    this.beatIndex += 1;
    this.combo = 0;
    const loss = reason === "timeout" ? TIMEOUT_MISS_LOSS : TIMING_MISS_LOSS;
    this.ropePosition = clamp(this.ropePosition - loss, ROPE_MIN, ROPE_MAX);

    this.onPullMissed?.({ reason, ropePosition: this.ropePosition });

    if (this.ropePosition <= ROPE_MIN) {
      this.isOver = true;
    }
  }
}
