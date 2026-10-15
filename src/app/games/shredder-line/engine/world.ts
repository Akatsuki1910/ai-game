export const SCRAP_COLORS = ["copper", "steel", "glass"] as const;
export type ScrapColor = (typeof SCRAP_COLORS)[number];

export const CHUTE_COUNT = SCRAP_COLORS.length;
export const LIVES_MAX = 3;

export interface ScrapPiece {
  readonly id: number;
  readonly color: ScrapColor;
  /** 0: ベルト投入口(スポーン) 〜 1: シュレッダーの刃(未分別で到達すると失敗)。 */
  progress: number;
  /** つかんでドラッグ中はベルトの進行を止める(掴んでいる間は安全)。 */
  isHeld: boolean;
}

export type SortResult = "correct" | "wrong" | "invalid";

export interface SortEvent {
  result: SortResult;
  pieceId: number;
  chuteIndex: number;
  points: number;
  color: ScrapColor | null;
}

export interface MissEvent {
  pieceId: number;
  color: ScrapColor;
}

const INITIAL_BELT_SPEED = 0.11;
const MAX_BELT_SPEED = 0.32;
const BELT_SPEED_GROWTH_PER_SUCCESS = 0.012;

const INITIAL_SPAWN_INTERVAL = 1.5;
const MIN_SPAWN_INTERVAL = 0.55;
const SPAWN_INTERVAL_DECAY_PER_SUCCESS = 0.045;

export const MAX_PIECES_ON_BELT = 6;
const SCORE_PER_SORT = 100;
const COMBO_BONUS_PER_STREAK = 15;

/**
 * スクラップ(金属くず)をベルトコンベアから正しい色のシュートへ仕分ける
 * リアルタイム仕分けパズルの純粋ロジック層。React / pixi.js には依存しない。
 */
export class ShredderLineWorld {
  private _pieces: ScrapPiece[] = [];
  private spawnTimer = 0;
  private successCount = 0;
  private nextId = 0;

  score = 0;
  combo = 0;
  lives = LIVES_MAX;
  isOver = false;

  onSort: ((event: SortEvent) => void) | null = null;
  onMiss: ((event: MissEvent) => void) | null = null;

  constructor() {
    this.reset();
  }

  get pieces(): readonly ScrapPiece[] {
    return this._pieces;
  }

  get beltSpeed(): number {
    return Math.min(
      MAX_BELT_SPEED,
      INITIAL_BELT_SPEED + this.successCount * BELT_SPEED_GROWTH_PER_SUCCESS,
    );
  }

  get spawnInterval(): number {
    return Math.max(
      MIN_SPAWN_INTERVAL,
      INITIAL_SPAWN_INTERVAL - this.successCount * SPAWN_INTERVAL_DECAY_PER_SUCCESS,
    );
  }

  reset(): void {
    this._pieces = [];
    this.spawnTimer = 0;
    this.successCount = 0;
    this.nextId = 0;
    this.score = 0;
    this.combo = 0;
    this.lives = LIVES_MAX;
    this.isOver = false;
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    for (let i = this._pieces.length - 1; i >= 0; i--) {
      const piece = this._pieces[i];
      if (piece.isHeld) continue;
      piece.progress += this.beltSpeed * deltaSeconds;
      if (piece.progress >= 1) {
        this._pieces.splice(i, 1);
        this.lives -= 1;
        this.combo = 0;
        this.onMiss?.({ pieceId: piece.id, color: piece.color });
        if (this.lives <= 0) {
          this.isOver = true;
          return;
        }
      }
    }
    if (this.isOver) return;

    this.spawnTimer -= deltaSeconds;
    if (this.spawnTimer <= 0) {
      this.trySpawn();
      this.spawnTimer = this.spawnInterval;
    }
  }

  /** ベルト上のスクラップをつかむ。掴めた(=以後ベルトが進まなくなる)かどうかを返す。 */
  grabPiece(id: number): boolean {
    if (this.isOver) return false;
    const piece = this._pieces.find((p) => p.id === id);
    if (!piece || piece.isHeld) return false;
    piece.isHeld = true;
    return true;
  }

  /** シュート以外で指を離した場合、つかんだ場所からベルトの進行を再開する。 */
  releasePiece(id: number): void {
    const piece = this._pieces.find((p) => p.id === id);
    if (piece) piece.isHeld = false;
  }

  /** シュートへ投入する。つかんでいたかどうかに関わらず呼べる(キーボード操作用)。 */
  sortPiece(id: number, chuteIndex: number): SortResult {
    const piece = this._pieces.find((p) => p.id === id);
    const chuteColor = SCRAP_COLORS[chuteIndex];

    if (this.isOver || !piece || chuteColor === undefined) {
      this.onSort?.({
        result: "invalid",
        pieceId: id,
        chuteIndex,
        points: 0,
        color: piece?.color ?? null,
      });
      return "invalid";
    }

    this._pieces = this._pieces.filter((p) => p.id !== id);

    if (piece.color === chuteColor) {
      const points = SCORE_PER_SORT + this.combo * COMBO_BONUS_PER_STREAK;
      this.score += points;
      this.combo += 1;
      this.successCount += 1;
      this.onSort?.({ result: "correct", pieceId: id, chuteIndex, points, color: piece.color });
      return "correct";
    }

    this.combo = 0;
    this.lives -= 1;
    this.onSort?.({ result: "wrong", pieceId: id, chuteIndex, points: 0, color: piece.color });
    if (this.lives <= 0) this.isOver = true;
    return "wrong";
  }

  /** シュレッダーに最も近い(=最も危険な)つかんでいないスクラップのidを返す。キーボード操作用。 */
  mostUrgentPieceId(): number | null {
    let best: ScrapPiece | null = null;
    for (const piece of this._pieces) {
      if (piece.isHeld) continue;
      if (!best || piece.progress > best.progress) best = piece;
    }
    return best?.id ?? null;
  }

  private trySpawn(): void {
    if (this._pieces.length >= MAX_PIECES_ON_BELT) return;
    const color = SCRAP_COLORS[Math.floor(Math.random() * SCRAP_COLORS.length)];
    this._pieces.push({ id: this.nextId++, color, progress: 0, isHeld: false });
  }
}
