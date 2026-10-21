export type NoteType = "don" | "katsu";

export type NoteJudgement = "perfect" | "good";
export type MissReason = "wrong" | "timing" | "timeout";

export interface ChartNote {
  /** ステージ開始からの経過秒数で、この音符を叩くべき瞬間。 */
  time: number;
  type: NoteType;
}

export interface NoteJudgedEvent {
  type: NoteType;
  judgement: NoteJudgement;
  points: number;
  combo: number;
}

export interface NoteMissedEvent {
  reason: MissReason;
  livesRemaining: number;
}

export interface StageClearedEvent {
  /** クリアし終えたステージ番号(次のステージではなく、たった今終えたステージ)。 */
  stage: number;
  bonus: number;
}

export interface VisibleNote {
  type: NoteType;
  /** ステージ開始からの経過秒数で叩くべき瞬間(ChartNote.time と同じ)。 */
  time: number;
  /** 判定ラインまでの残り秒数。負の値は判定ラインを過ぎてまだ判定待ちであることを表す。 */
  secondsUntilHit: number;
}

export const START_LIVES = 5;

/** この秒数以内に叩けば PERFECT。 */
export const PERFECT_WINDOW_SECONDS = 0.08;
/** この秒数以内に叩けば GOOD。これを超えると(ボタンが合っていても)ミス扱い。 */
export const GOOD_WINDOW_SECONDS = 0.22;
/** 音符が判定ラインに近づいてくる様子を描画で見せる先読み秒数。 */
export const APPROACH_SECONDS = 1.6;

const BASE_BPM = 100;
const BPM_INCREMENT_PER_STAGE = 9;
const MAX_BPM = 196;

const BASE_NOTE_COUNT = 10;
const NOTE_COUNT_INCREMENT_PER_STAGE = 3;
const MAX_NOTE_COUNT = 26;

/** 2ステージ目以降は助走として最初の音符が鳴るまでこの拍数ぶん待つ。 */
const LEAD_IN_BEATS = 2;
/**
 * 1ステージ目だけは、画面の読み込み・初期化にかかる時間ぶんプレイヤーが身構える
 * 猶予を確保するため、拍数ではなく絶対秒数で長めの助走を取る。
 */
const STAGE_ONE_LEAD_IN_SECONDS = 3;
/** 高いステージほど、音符間隔が半拍(八分音符)になる確率。 */
const HALF_BEAT_CHANCE_PER_STAGE = 0.05;
const MAX_HALF_BEAT_CHANCE = 0.45;

const BASE_POINTS = 100;
const PERFECT_BONUS = 40;
const COMBO_BONUS_PER_STREAK = 6;
const MAX_COMBO_BONUS = 120;
const STAGE_BASE_BONUS = 150;
const STAGE_BONUS_PER_STAGE = 20;

function bpmForStage(stage: number): number {
  return Math.min(MAX_BPM, BASE_BPM + (stage - 1) * BPM_INCREMENT_PER_STAGE);
}

function noteCountForStage(stage: number): number {
  return Math.min(MAX_NOTE_COUNT, BASE_NOTE_COUNT + (stage - 1) * NOTE_COUNT_INCREMENT_PER_STAGE);
}

function halfBeatChanceForStage(stage: number): number {
  return Math.min(MAX_HALF_BEAT_CHANCE, (stage - 1) * HALF_BEAT_CHANCE_PER_STAGE);
}

/**
 * 指定ステージの譜面(音符の出現タイミングと種類の列)を生成する。
 * テンポ(BPM)と音符数はステージが進むほど増え、八分音符が混ざる確率も上がる。
 */
export function generateChart(stage: number): ChartNote[] {
  const beatSeconds = 60 / bpmForStage(stage);
  const noteCount = noteCountForStage(stage);
  const halfBeatChance = halfBeatChanceForStage(stage);

  const notes: ChartNote[] = [];
  let time =
    stage === 1
      ? Math.max(STAGE_ONE_LEAD_IN_SECONDS, beatSeconds * LEAD_IN_BEATS)
      : beatSeconds * LEAD_IN_BEATS;
  for (let i = 0; i < noteCount; i++) {
    notes.push({ time, type: Math.random() < 0.5 ? "don" : "katsu" });
    const subdivision = Math.random() < halfBeatChance ? 0.5 : 1;
    time += beatSeconds * subdivision;
  }
  return notes;
}

/**
 * 右から流れてくる音符を正しい太鼓(ドン/カツ)で叩き続けるリアルタイム・リズムパズルの
 * 純粋ロジック層。React / pixi.js には一切依存しない。画面サイズにも依存しない。
 *
 * 判定の方針: 「待っていても何も起きない」状態を作らないため、現在の対象音符に対する
 * hit() の呼び出しは常にヒット(PERFECT/GOOD)かミスのどちらかに必ず解決する
 * (ボタンが違う、または叩くタイミングが窓の外なら問答無用でミス)。入力しないまま
 * 窓を過ぎた場合は step() 側でタイムアウトミスとして自動的に処理される。
 */
export class TaikoPulseWorld {
  stage = 1;
  score = 0;
  combo = 0;
  maxCombo = 0;
  lives = START_LIVES;
  isOver = false;

  chart: readonly ChartNote[] = [];
  /** chart の中で、まだ判定されていない最初の音符のインデックス。 */
  noteIndex = 0;
  elapsed = 0;

  onNoteJudged: ((event: NoteJudgedEvent) => void) | null = null;
  onNoteMissed: ((event: NoteMissedEvent) => void) | null = null;
  onStageCleared: ((event: StageClearedEvent) => void) | null = null;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.stage = 1;
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.lives = START_LIVES;
    this.isOver = false;
    this.startStage();
  }

  /** 現在叩くべき(まだ判定されていない)音符。ステージが尽きていれば null。 */
  get currentNote(): ChartNote | null {
    return this.noteIndex < this.chart.length ? this.chart[this.noteIndex] : null;
  }

  /** 描画用に、これから判定ラインへ近づいてくる音符を時間順に返す。 */
  getVisibleNotes(): VisibleNote[] {
    const visible: VisibleNote[] = [];
    for (let i = this.noteIndex; i < this.chart.length; i++) {
      const note = this.chart[i];
      const secondsUntilHit = note.time - this.elapsed;
      if (secondsUntilHit > APPROACH_SECONDS) break;
      visible.push({ type: note.type, time: note.time, secondsUntilHit });
    }
    return visible;
  }

  private startStage(): void {
    this.elapsed = 0;
    this.noteIndex = 0;
    this.chart = generateChart(this.stage);
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    this.elapsed += deltaSeconds;
    while (
      !this.isOver &&
      this.noteIndex < this.chart.length &&
      this.elapsed - this.chart[this.noteIndex].time > GOOD_WINDOW_SECONDS
    ) {
      this.resolveMiss("timeout");
    }
    if (!this.isOver && this.chart.length > 0 && this.noteIndex >= this.chart.length) {
      this.clearStage();
    }
  }

  /** プレイヤーがドン/カツを叩いた瞬間に呼ぶ。現在の対象音符を必ずヒットかミスへ解決する。 */
  hit(type: NoteType): void {
    if (this.isOver || this.noteIndex >= this.chart.length) return;

    const note = this.chart[this.noteIndex];
    if (note.type !== type) {
      this.resolveMiss("wrong");
      return;
    }

    const distance = Math.abs(this.elapsed - note.time);
    if (distance > GOOD_WINDOW_SECONDS) {
      this.resolveMiss("timing");
      return;
    }

    this.resolveHit(note, distance <= PERFECT_WINDOW_SECONDS ? "perfect" : "good");
  }

  private resolveHit(note: ChartNote, judgement: NoteJudgement): void {
    this.noteIndex += 1;
    this.combo += 1;
    this.maxCombo = Math.max(this.maxCombo, this.combo);

    const comboBonus = Math.min(MAX_COMBO_BONUS, this.combo * COMBO_BONUS_PER_STREAK);
    const perfectBonus = judgement === "perfect" ? PERFECT_BONUS : 0;
    const points = BASE_POINTS + comboBonus + perfectBonus;
    this.score += points;
    this.onNoteJudged?.({ type: note.type, judgement, points, combo: this.combo });

    if (this.noteIndex >= this.chart.length) this.clearStage();
  }

  private resolveMiss(reason: MissReason): void {
    this.noteIndex += 1;
    this.combo = 0;
    this.lives = Math.max(0, this.lives - 1);
    this.onNoteMissed?.({ reason, livesRemaining: this.lives });

    if (this.lives <= 0) {
      this.isOver = true;
      return;
    }
    if (this.noteIndex >= this.chart.length) this.clearStage();
  }

  private clearStage(): void {
    const bonus = STAGE_BASE_BONUS + this.stage * STAGE_BONUS_PER_STAGE;
    this.score += bonus;
    this.onStageCleared?.({ stage: this.stage, bonus });
    this.stage += 1;
    this.startStage();
  }
}
