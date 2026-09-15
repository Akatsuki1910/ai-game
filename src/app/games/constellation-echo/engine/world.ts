export interface Star {
  readonly id: number;
  x: number;
  y: number;
}

export type Phase = "preview" | "recall" | "success" | "mistake" | "gameOver";

export interface StarRevealedEvent {
  star: Star;
  order: number;
}

export interface RoundStartedEvent {
  round: number;
  stars: readonly Star[];
  sequence: readonly number[];
}

export interface RoundClearedEvent {
  round: number;
  points: number;
  sequenceLength: number;
}

export type MistakeReason = "wrongStar" | "timeout";

export interface MistakeEvent {
  round: number;
  livesRemaining: number;
  reason: MistakeReason;
  wrongStarId?: number;
}

export const STAR_COUNT = 8;
export const START_LIVES = 3;
export const INITIAL_SEQUENCE_LENGTH = 3;
export const MAX_SEQUENCE_LENGTH = STAR_COUNT;
export const STAR_RADIUS = 16;
export const STAR_HIT_SLOP = 22;

const REVEAL_STEP_SECONDS = 0.55;
const REVEAL_GAP_SECONDS = 0.2;
const PREVIEW_LEAD_SECONDS = 0.45;
const RECALL_BASE_SECONDS = 3.2;
const RECALL_PER_STAR_SECONDS = 1.3;
const SUCCESS_PAUSE_SECONDS = 0.9;
const MISTAKE_PAUSE_SECONDS = 1.1;
const MISTAKE_FLASH_SECONDS = 0.45;

const BASE_POINTS_PER_STAR = 40;
const SPEED_BONUS_MAX = 120;

/** 星を配置する矩形が画面の何割を占めるか(残りは余白)。width/heightに対する比率で持ち、resizeでの比例拡大が壊れないようにする。 */
const GRID_MARGIN_RATIO = 0.13;
const JITTER_RATIO = 0.32;

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function shuffledIndices(count: number): number[] {
  const indices = Array.from({ length: count }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const swap = indices[i];
    indices[i] = indices[j];
    indices[j] = swap;
  }
  return indices;
}

/**
 * 星をジッター付きグリッドに配置する。純粋なランダム配置だと狭い画面で星同士が
 * 密集してタップしにくくなるため、セルに割り当ててから軽く揺らす。
 * 全ての値をwidth/heightの線形な比率で作ることで、後段のresize()による
 * 比例拡大縮小（scaleX/scaleYを掛けるだけ）と矛盾しないようにしている。
 */
function generateStarField(width: number, height: number, count: number): Star[] {
  const marginX = width * GRID_MARGIN_RATIO;
  const marginY = height * GRID_MARGIN_RATIO;
  const usableWidth = Math.max(0, width - marginX * 2);
  const usableHeight = Math.max(0, height - marginY * 2);

  const aspect = usableHeight > 0 ? usableWidth / usableHeight : 1;
  let cols = Math.max(1, Math.round(Math.sqrt(count * aspect)));
  let rows = Math.max(1, Math.ceil(count / cols));
  while (cols * rows < count) {
    cols += 1;
    rows = Math.ceil(count / cols);
  }

  const cellWidth = usableWidth / cols;
  const cellHeight = usableHeight / rows;
  const jitterX = cellWidth * JITTER_RATIO;
  const jitterY = cellHeight * JITTER_RATIO;

  const cellIndices = shuffledIndices(cols * rows).slice(0, count);

  return cellIndices.map((cellIndex, id) => {
    const col = cellIndex % cols;
    const row = Math.floor(cellIndex / cols);
    const centerX = marginX + cellWidth * (col + 0.5);
    const centerY = marginY + cellHeight * (row + 0.5);
    return {
      id,
      x: centerX + randRange(-jitterX, jitterX),
      y: centerY + randRange(-jitterY, jitterY),
    };
  });
}

/** 星のidから、重複なしの訪問順序（長さlength）を作る。 */
function generateSequence(starCount: number, length: number): number[] {
  return shuffledIndices(starCount).slice(0, length);
}

/**
 * 星座を覚えて同じ順にタップし直すリアルタイム記憶パズルの純粋ロジック層。
 * React / pixi.js には一切依存しない。
 */
export class ConstellationEchoWorld {
  width = 0;
  height = 0;
  stars: Star[] = [];
  sequence: number[] = [];
  phase: Phase = "preview";
  round = 1;
  score = 0;
  lives = START_LIVES;
  isOver = false;
  elapsedSeconds = 0;
  /** recallフェーズの残り秒数。recallフェーズ以外では0。 */
  timeRemaining = 0;
  /** previewフェーズでこれまでに光らせた星の数（sequenceの先頭からの個数）。 */
  revealedCount = 0;
  /** recallフェーズで正解し終えた星の数（sequenceの先頭からの個数）。 */
  recallProgress = 0;
  /** ラウンド（新しい星配置+順路）を生成し直すたびに増える世代カウンタ。UI側の再描画トリガー用。 */
  generation = 0;
  lastMistakeReason: MistakeReason | null = null;
  mistakeFlashStarId: number | null = null;
  mistakeFlashRemaining = 0;

  onStarRevealed: ((event: StarRevealedEvent) => void) | null = null;
  onRoundStarted: ((event: RoundStartedEvent) => void) | null = null;
  onRoundCleared: ((event: RoundClearedEvent) => void) | null = null;
  onMistake: ((event: MistakeEvent) => void) | null = null;

  private sequenceLength = INITIAL_SEQUENCE_LENGTH;
  private phaseTimer = 0;
  private revealIndex = 0;

  constructor(width: number, height: number) {
    this.resize(width, height);
    this.reset();
  }

  reset(): void {
    this.round = 1;
    this.score = 0;
    this.lives = START_LIVES;
    this.isOver = false;
    this.sequenceLength = INITIAL_SEQUENCE_LENGTH;
    this.mistakeFlashStarId = null;
    this.mistakeFlashRemaining = 0;
    this.lastMistakeReason = null;
    this.startRound();
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const scaleX = this.width > 0 ? width / this.width : 1;
    const scaleY = this.height > 0 ? height / this.height : 1;
    if (this.width > 0 && this.height > 0) {
      for (const star of this.stars) {
        star.x *= scaleX;
        star.y *= scaleY;
      }
    }
    this.width = width;
    this.height = height;
  }

  /** idはstars配列内でのindexと一致する（generateStarFieldが0始まりの連番で割り当てるため）。 */
  findStarAt(x: number, y: number): Star | undefined {
    return this.stars.find((s) => Math.hypot(s.x - x, s.y - y) <= STAR_RADIUS + STAR_HIT_SLOP);
  }

  selectStar(id: number): void {
    if (this.isOver || this.phase !== "recall") return;

    const expected = this.sequence[this.recallProgress];
    if (id === expected) {
      this.recallProgress += 1;
      if (this.recallProgress >= this.sequence.length) {
        this.completeRound();
      }
      return;
    }

    this.registerMistake("wrongStar", id);
  }

  private startRound(): void {
    this.generation += 1;
    this.stars = generateStarField(this.width, this.height, STAR_COUNT);
    this.sequence = generateSequence(STAR_COUNT, this.sequenceLength);
    this.revealedCount = 0;
    this.recallProgress = 0;
    this.revealIndex = 0;
    this.timeRemaining = 0;
    this.phase = "preview";
    this.phaseTimer = PREVIEW_LEAD_SECONDS;
    this.onRoundStarted?.({ round: this.round, stars: this.stars, sequence: this.sequence });
  }

  private recallTimeLimit(): number {
    return RECALL_BASE_SECONDS + this.sequence.length * RECALL_PER_STAR_SECONDS;
  }

  private completeRound(): void {
    const limit = this.recallTimeLimit();
    const timeFraction = limit > 0 ? Math.max(0, Math.min(1, this.timeRemaining / limit)) : 0;
    const points = Math.round(
      BASE_POINTS_PER_STAR * this.sequence.length + SPEED_BONUS_MAX * timeFraction,
    );
    this.score += points;
    this.onRoundCleared?.({ round: this.round, points, sequenceLength: this.sequence.length });

    this.round += 1;
    this.sequenceLength = Math.min(MAX_SEQUENCE_LENGTH, this.sequenceLength + 1);
    this.phase = "success";
    this.phaseTimer = SUCCESS_PAUSE_SECONDS;
  }

  private registerMistake(reason: MistakeReason, wrongStarId?: number): void {
    this.lives = Math.max(0, this.lives - 1);
    this.lastMistakeReason = reason;
    this.mistakeFlashStarId = wrongStarId ?? null;
    this.mistakeFlashRemaining = MISTAKE_FLASH_SECONDS;
    this.onMistake?.({ round: this.round, livesRemaining: this.lives, reason, wrongStarId });

    if (this.lives <= 0) {
      this.isOver = true;
      this.phase = "gameOver";
      return;
    }

    this.phase = "mistake";
    this.phaseTimer = MISTAKE_PAUSE_SECONDS;
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;
    this.elapsedSeconds += deltaSeconds;

    if (this.mistakeFlashRemaining > 0) {
      this.mistakeFlashRemaining = Math.max(0, this.mistakeFlashRemaining - deltaSeconds);
    }

    switch (this.phase) {
      case "preview": {
        this.phaseTimer -= deltaSeconds;
        while (this.phaseTimer <= 0 && this.phase === "preview") {
          if (this.revealIndex >= this.sequence.length) {
            this.phase = "recall";
            this.timeRemaining = this.recallTimeLimit();
            break;
          }
          const starId = this.sequence[this.revealIndex];
          const star = this.stars[starId];
          this.revealIndex += 1;
          this.revealedCount = this.revealIndex;
          if (star) this.onStarRevealed?.({ star, order: this.revealIndex - 1 });
          this.phaseTimer +=
            this.revealIndex >= this.sequence.length
              ? PREVIEW_LEAD_SECONDS
              : REVEAL_STEP_SECONDS + REVEAL_GAP_SECONDS;
        }
        break;
      }
      case "recall": {
        this.timeRemaining = Math.max(0, this.timeRemaining - deltaSeconds);
        if (this.timeRemaining <= 0) this.registerMistake("timeout");
        break;
      }
      case "success":
      case "mistake": {
        this.phaseTimer -= deltaSeconds;
        if (this.phaseTimer <= 0) this.startRound();
        break;
      }
      case "gameOver":
        break;
    }
  }
}
