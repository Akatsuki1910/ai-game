export interface Card {
  readonly id: number;
  readonly label: string;
  x: number;
  y: number;
}

export type MissReason = "wrongCard" | "snatchedByRival";

export interface CardCapturedEvent {
  cardId: number;
  label: string;
  points: number;
  comboAfter: number;
  x: number;
  y: number;
}

export interface MissEvent {
  reason: MissReason;
  cardId: number | null;
  label: string | null;
  livesRemaining: number;
  x: number | null;
  y: number | null;
}

export interface RoundStartedEvent {
  round: number;
  cardCount: number;
}

export interface RoundClearedEvent {
  round: number;
  bonus: number;
}

/** 現代仮名遣いの基本五十音(わ・を・んを含む46字)。札の文字はここから重複なく選ぶ。 */
export const HIRAGANA_POOL = [
  "あ",
  "い",
  "う",
  "え",
  "お",
  "か",
  "き",
  "く",
  "け",
  "こ",
  "さ",
  "し",
  "す",
  "せ",
  "そ",
  "た",
  "ち",
  "つ",
  "て",
  "と",
  "な",
  "に",
  "ぬ",
  "ね",
  "の",
  "は",
  "ひ",
  "ふ",
  "へ",
  "ほ",
  "ま",
  "み",
  "む",
  "め",
  "も",
  "や",
  "ゆ",
  "よ",
  "ら",
  "り",
  "る",
  "れ",
  "ろ",
  "わ",
  "を",
  "ん",
] as const;

export const START_LIVES = 3;
export const INITIAL_CARD_COUNT = 8;
export const CARDS_PER_ROUND = 2;
export const MAX_CARD_COUNT = 20;
export const CARD_WIDTH = 56;
export const CARD_HEIGHT = 72;
export const CARD_HIT_SLOP = 12;

const RIVAL_BASE_SECONDS = 3.2;
const RIVAL_MIN_SECONDS = 1.15;
const RIVAL_SECONDS_PER_ROUND = 0.16;

const BASE_POINTS = 60;
const COMBO_BONUS_PER_STREAK = 12;
const SPEED_BONUS_MAX = 80;
const ROUND_CLEAR_BONUS = 120;
const MISS_FLASH_SECONDS = 0.45;
/** ミスの直後、ライバルの手の進行を止める猶予。立て続けの横取りで一瞬で全ライフを失うのを防ぐ。 */
const MISS_GRACE_SECONDS = 0.6;

/** 札を配置する矩形が画面の何割を占めるか(残りは余白)。width/heightに対する比率で持ち、resizeでの比例拡大が壊れないようにする。 */
const GRID_MARGIN_RATIO = 0.14;
const JITTER_RATIO = 0.28;

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function shuffledCopy<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const swap = copy[i];
    copy[i] = copy[j];
    copy[j] = swap;
  }
  return copy;
}

/**
 * 札をジッター付きグリッドに配置する。純粋なランダム配置だと狭い画面で札同士が
 * 密集してタップしにくくなるため、セルに割り当ててから軽く揺らす
 * (constellation-echoのgenerateStarFieldと同じ方針)。
 * 全ての値をwidth/heightの線形な比率で作ることで、resize()による
 * 比例拡大縮小（scaleX/scaleYを掛けるだけ）と矛盾しないようにしている。
 */
function generateCardField(width: number, height: number, count: number): Card[] {
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

  const cellIndices = shuffledCopy(Array.from({ length: cols * rows }, (_, i) => i)).slice(
    0,
    count,
  );
  const labels = shuffledCopy(HIRAGANA_POOL).slice(0, count);

  return cellIndices.map((cellIndex, id) => {
    const col = cellIndex % cols;
    const row = Math.floor(cellIndex / cols);
    const centerX = marginX + cellWidth * (col + 0.5);
    const centerY = marginY + cellHeight * (row + 0.5);
    return {
      id,
      label: labels[id],
      x: centerX + randRange(-jitterX, jitterX),
      y: centerY + randRange(-jitterY, jitterY),
    };
  });
}

/**
 * 読まれた文字の札を、ライバルより先に見つけて取り続けるリアルタイム速取り(かるた)パズルの
 * 純粋ロジック層。React / pixi.js には一切依存しない。
 */
export class KarutaDashWorld {
  width = 0;
  height = 0;
  cards: Card[] = [];
  targetLabel = "";
  round = 1;
  score = 0;
  lives = START_LIVES;
  combo = 0;
  isOver = false;
  elapsedSeconds = 0;
  /** ライバルが目標の札に手を伸ばす進行度。0で開始し、1に達すると横取りされる。 */
  rivalProgress = 0;
  /** キーボード操作用の選択カーソル座標(画面座標系)。ポインター操作時もここに同期される。 */
  selectorX = 0;
  selectorY = 0;
  /** 札の配置(ラウンド)が変わるたびに増える世代カウンタ。UI側の再描画トリガー用。 */
  generation = 0;
  lastMissReason: MissReason | null = null;
  missFlashCardId: number | null = null;
  missFlashRemaining = 0;

  onCardCaptured: ((event: CardCapturedEvent) => void) | null = null;
  onMiss: ((event: MissEvent) => void) | null = null;
  onRoundStarted: ((event: RoundStartedEvent) => void) | null = null;
  onRoundCleared: ((event: RoundClearedEvent) => void) | null = null;

  private graceRemaining = 0;

  constructor(width: number, height: number) {
    this.resize(width, height);
    this.reset();
  }

  reset(): void {
    this.round = 1;
    this.score = 0;
    this.lives = START_LIVES;
    this.combo = 0;
    this.isOver = false;
    this.graceRemaining = 0;
    this.missFlashCardId = null;
    this.missFlashRemaining = 0;
    this.lastMissReason = null;
    this.startRound();
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const scaleX = this.width > 0 ? width / this.width : 1;
    const scaleY = this.height > 0 ? height / this.height : 1;
    if (this.width > 0 && this.height > 0) {
      for (const card of this.cards) {
        card.x *= scaleX;
        card.y *= scaleY;
      }
      this.selectorX *= scaleX;
      this.selectorY *= scaleY;
    }
    this.width = width;
    this.height = height;
  }

  /** 矩形の札あたり判定(中心座標 x,y からの当たり判定)。 */
  findCardAt(x: number, y: number): Card | undefined {
    const halfW = CARD_WIDTH / 2 + CARD_HIT_SLOP;
    const halfH = CARD_HEIGHT / 2 + CARD_HIT_SLOP;
    return this.cards.find((c) => Math.abs(c.x - x) <= halfW && Math.abs(c.y - y) <= halfH);
  }

  setSelectorPosition(x: number, y: number): void {
    this.selectorX = Math.min(this.width, Math.max(0, x));
    this.selectorY = Math.min(this.height, Math.max(0, y));
  }

  moveSelectorBy(dx: number, dy: number): void {
    this.setSelectorPosition(this.selectorX + dx, this.selectorY + dy);
  }

  /** 選択カーソルの位置にある札を取ろうとする(キーボード操作用)。 */
  grabAtSelector(): void {
    const card = this.findCardAt(this.selectorX, this.selectorY);
    if (card) this.grabCard(card.id);
  }

  grabCard(cardId: number): void {
    if (this.isOver) return;
    const card = this.cards.find((c) => c.id === cardId);
    if (!card) return; // 既に取られた/存在しないidは無視

    if (card.label === this.targetLabel) {
      this.captureCard(card);
    } else {
      this.registerMiss("wrongCard", card.id);
    }
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;
    this.elapsedSeconds += deltaSeconds;

    if (this.missFlashRemaining > 0) {
      this.missFlashRemaining = Math.max(0, this.missFlashRemaining - deltaSeconds);
    }

    if (this.graceRemaining > 0) {
      this.graceRemaining = Math.max(0, this.graceRemaining - deltaSeconds);
      return;
    }

    const rivalSeconds = this.rivalSecondsForRound(this.round);
    this.rivalProgress = Math.min(1, this.rivalProgress + deltaSeconds / rivalSeconds);
    if (this.rivalProgress >= 1) {
      const targetCard = this.cards.find((c) => c.label === this.targetLabel);
      this.registerMiss("snatchedByRival", targetCard?.id ?? null);
    }
  }

  private cardCountForRound(round: number): number {
    return Math.min(MAX_CARD_COUNT, INITIAL_CARD_COUNT + (round - 1) * CARDS_PER_ROUND);
  }

  private rivalSecondsForRound(round: number): number {
    return Math.max(RIVAL_MIN_SECONDS, RIVAL_BASE_SECONDS - (round - 1) * RIVAL_SECONDS_PER_ROUND);
  }

  private captureCard(card: Card): void {
    const speedFraction = Math.max(0, Math.min(1, 1 - this.rivalProgress));
    this.combo += 1;
    const points = Math.round(
      BASE_POINTS + COMBO_BONUS_PER_STREAK * (this.combo - 1) + SPEED_BONUS_MAX * speedFraction,
    );
    this.score += points;
    this.cards = this.cards.filter((c) => c.id !== card.id);
    this.onCardCaptured?.({
      cardId: card.id,
      label: card.label,
      points,
      comboAfter: this.combo,
      x: card.x,
      y: card.y,
    });

    if (this.cards.length === 0) {
      this.clearRound();
      return;
    }
    this.pickNextTarget();
  }

  private registerMiss(reason: MissReason, cardId: number | null): void {
    this.combo = 0;
    this.lives = Math.max(0, this.lives - 1);
    this.lastMissReason = reason;

    const flashedCard = cardId !== null ? this.cards.find((c) => c.id === cardId) : undefined;
    this.missFlashCardId = cardId;
    this.missFlashRemaining = MISS_FLASH_SECONDS;
    this.graceRemaining = MISS_GRACE_SECONDS;

    if (reason === "snatchedByRival" && cardId !== null) {
      this.cards = this.cards.filter((c) => c.id !== cardId);
    }

    this.onMiss?.({
      reason,
      cardId,
      label: flashedCard?.label ?? null,
      livesRemaining: this.lives,
      x: flashedCard?.x ?? null,
      y: flashedCard?.y ?? null,
    });

    if (this.lives <= 0) {
      this.isOver = true;
      return;
    }

    if (reason === "snatchedByRival") {
      if (this.cards.length === 0) {
        this.clearRound();
        return;
      }
      this.pickNextTarget();
    }
  }

  private pickNextTarget(): void {
    if (this.cards.length === 0) return;
    const index = Math.floor(Math.random() * this.cards.length);
    this.targetLabel = this.cards[index].label;
    this.rivalProgress = 0;
  }

  private clearRound(): void {
    this.score += ROUND_CLEAR_BONUS;
    this.round += 1;
    this.onRoundCleared?.({ round: this.round, bonus: ROUND_CLEAR_BONUS });
    this.startRound();
  }

  private startRound(): void {
    this.generation += 1;
    const count = this.cardCountForRound(this.round);
    this.cards = generateCardField(this.width, this.height, count);
    this.selectorX = this.width / 2;
    this.selectorY = this.height / 2;
    this.pickNextTarget();
    this.onRoundStarted?.({ round: this.round, cardCount: this.cards.length });
  }
}
