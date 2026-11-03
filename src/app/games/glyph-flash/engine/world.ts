import { compareGlyphPaths, generateGlyphPath, type Point, pathLength } from "./path.ts";

export type GlyphPhase = "preview" | "trace" | "result";

export interface RoundResult {
  score: number;
  passed: boolean;
}

const INITIAL_LIVES = 3;
const BASE_PREVIEW_SECONDS = 1.6;
const MIN_PREVIEW_SECONDS = 0.5;
const PREVIEW_SECONDS_STEP = 0.05;
const BASE_PASS_THRESHOLD = 55;
const MAX_PASS_THRESHOLD = 82;
const PASS_THRESHOLD_STEP = 1.5;
const BASE_SEGMENT_COUNT = 3;
const MAX_SEGMENT_COUNT = 8;
const BASE_INK_MULTIPLIER = 1.6;
const MIN_INK_MULTIPLIER = 1.15;
const INK_MULTIPLIER_STEP = 0.03;
const RESULT_SECONDS = 1.1;
const BASE_POINTS = 100;
const BONUS_PER_EXTRA_PERCENT = 4;

/**
 * 一瞬だけ表示されるお題の軌跡を記憶し、消えた後に再現してなぞるワールド。
 * 「お題を見せる(preview) → なぞらせる(trace) → 採点して見せる(result)」の
 * 3フェーズを繰り返し、合格するたびにお題は複雑に・記憶できる時間は短くなる。
 */
export class GlyphFlashWorld {
  width = 0;
  height = 0;
  phase: GlyphPhase = "preview";
  round = 1;
  score = 0;
  lives = INITIAL_LIVES;
  isOver = false;

  targetPath: Point[] = [];
  drawnPath: Point[] = [];
  previewTimer = 0;
  previewDuration = BASE_PREVIEW_SECONDS;
  resultTimer = 0;
  lastResult: RoundResult | null = null;
  inkBudget = 0;
  inkUsed = 0;
  passThreshold = BASE_PASS_THRESHOLD;

  private strokeActive = false;

  onRoundResolved: ((result: RoundResult) => void) | null = null;
  onRoundStarted: (() => void) | null = null;

  constructor(width: number, height: number) {
    this.resize(width, height);
    this.reset();
  }

  reset(): void {
    this.round = 1;
    this.score = 0;
    this.lives = INITIAL_LIVES;
    this.isOver = false;
    this.strokeActive = false;
    this.startRound();
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const scaleX = this.width > 0 ? width / this.width : 1;
    const scaleY = this.height > 0 ? height / this.height : 1;
    if (this.width > 0 && this.height > 0) {
      this.targetPath = this.targetPath.map((p) => ({ x: p.x * scaleX, y: p.y * scaleY }));
      this.drawnPath = this.drawnPath.map((p) => ({ x: p.x * scaleX, y: p.y * scaleY }));
      // インク予算/消費量も距離(長さ)の指標なので、座標と同じ比率で一緒に拡大縮小する。
      // ここを忘れると、最初に極小サイズ(1x1)で作られた予算が実寸に伸びた軌跡に対して
      // 絶対的に小さすぎたままになり、なぞっても一歩も線が伸びなくなる。
      const lengthScale = (scaleX + scaleY) / 2;
      this.inkBudget *= lengthScale;
      this.inkUsed *= lengthScale;
    }
    this.width = width;
    this.height = height;
  }

  get inkRemaining(): number {
    return Math.max(0, this.inkBudget - this.inkUsed);
  }

  get referenceSize(): number {
    return Math.max(1, Math.min(this.width, this.height));
  }

  get isStrokeActive(): boolean {
    return this.strokeActive;
  }

  beginStroke(x: number, y: number): void {
    if (this.phase !== "trace" || this.isOver) return;
    this.strokeActive = true;
    this.drawnPath = [{ x, y }];
    this.inkUsed = 0;
  }

  extendStroke(x: number, y: number): void {
    if (!this.strokeActive || this.phase !== "trace") return;
    const last = this.drawnPath[this.drawnPath.length - 1];
    if (!last) return;
    const segmentLength = Math.hypot(x - last.x, y - last.y);
    if (this.inkUsed + segmentLength > this.inkBudget) return;
    this.drawnPath.push({ x, y });
    this.inkUsed += segmentLength;
  }

  endStroke(): void {
    if (!this.strokeActive || this.phase !== "trace") return;
    this.strokeActive = false;

    const comparisonScore = compareGlyphPaths(this.targetPath, this.drawnPath, this.referenceSize);
    const passed = comparisonScore >= this.passThreshold;

    if (passed) {
      const bonus = Math.max(0, comparisonScore - this.passThreshold) * BONUS_PER_EXTRA_PERCENT;
      this.score += Math.round(BASE_POINTS + bonus);
      this.round += 1;
    } else {
      this.lives = Math.max(0, this.lives - 1);
      if (this.lives <= 0) this.isOver = true;
    }

    this.lastResult = { score: Math.round(comparisonScore), passed };
    this.onRoundResolved?.(this.lastResult);
    this.phase = "result";
    this.resultTimer = RESULT_SECONDS;
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    if (this.phase === "preview") {
      this.previewTimer = Math.max(0, this.previewTimer - deltaSeconds);
      if (this.previewTimer <= 0) this.phase = "trace";
      return;
    }

    if (this.phase === "result") {
      this.resultTimer = Math.max(0, this.resultTimer - deltaSeconds);
      if (this.resultTimer <= 0) this.startRound();
    }
  }

  private startRound(): void {
    const segmentCount = Math.min(
      MAX_SEGMENT_COUNT,
      BASE_SEGMENT_COUNT + Math.floor((this.round - 1) / 2),
    );
    this.targetPath =
      this.width > 0 && this.height > 0
        ? generateGlyphPath(this.width, this.height, segmentCount)
        : [];
    this.drawnPath = [];
    this.strokeActive = false;
    this.inkUsed = 0;

    const targetLength = pathLength(this.targetPath);
    const inkMultiplier = Math.max(
      MIN_INK_MULTIPLIER,
      BASE_INK_MULTIPLIER - (this.round - 1) * INK_MULTIPLIER_STEP,
    );
    this.inkBudget = Math.max(targetLength * inkMultiplier, this.referenceSize * 0.1);

    this.previewDuration = Math.max(
      MIN_PREVIEW_SECONDS,
      BASE_PREVIEW_SECONDS - (this.round - 1) * PREVIEW_SECONDS_STEP,
    );
    this.previewTimer = this.previewDuration;

    this.passThreshold = Math.min(
      MAX_PASS_THRESHOLD,
      BASE_PASS_THRESHOLD + (this.round - 1) * PASS_THRESHOLD_STEP,
    );

    this.phase = "preview";
    this.resultTimer = 0;
    this.lastResult = null;

    this.onRoundStarted?.();
  }
}
