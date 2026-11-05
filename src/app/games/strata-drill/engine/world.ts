export type FeatureKind = "ore" | "hazard";

export interface Feature {
  readonly id: number;
  readonly depth: number;
  readonly fromFrac: number;
  readonly toFrac: number;
  readonly kind: FeatureKind;
  isResolved: boolean;
}

export interface DrillInput {
  readonly isDrilling: boolean;
  /** -1(左) 〜 1(右)。 */
  readonly steerDir: number;
}

export const MAX_HEAT = 100;
export const VISIBLE_DEPTH_RANGE = 18;
export const DRILL_SCREEN_Y_RATIO = 0.3;

const STEER_SPEED = 0.9; // frac/秒
const DRILL_SPEED = 6; // depth/秒
const HEAT_RATE = 28; // %/秒(ドリル中)
const COOL_RATE = 45; // %/秒(非ドリル中)

const DEPTH_SCORE_PER_UNIT = 10;
const ORE_POINTS = 80;

const SAFE_START_DEPTH = 10;
const FEATURE_THICKNESS = 2.4;

const BASE_BAND_WIDTH = 0.34;
const MIN_BAND_WIDTH = 0.16;
const BAND_SHRINK_PER_DEPTH = 0.0015;

const BASE_MIN_GAP = 9;
const BASE_MAX_GAP = 13;
const MIN_GAP_FLOOR = 4;
const GAP_SHRINK_PER_DEPTH = 0.03;

const ORE_PROBABILITY = 0.55;
const LOOKAHEAD_DEPTH = 24;

let nextFeatureId = 1;

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** 深度を、ドリルを画面上の固定位置に据えたときのスクリーンY座標に変換する（描画層が使う純粋関数）。 */
export function depthToScreenY(world: StrataDrillWorld, depth: number): number {
  const pixelsPerDepth = world.height / VISIBLE_DEPTH_RANGE;
  return DRILL_SCREEN_Y_RATIO * world.height + (depth - world.depth) * pixelsPerDepth;
}

export class StrataDrillWorld {
  width = 0;
  height = 0;
  depth = 0;
  drillXFrac = 0.5;
  heat = 0;
  score = 0;
  oreCollected = 0;
  isOver = false;
  isOverheated = false;
  features: Feature[] = [];

  private nextFeatureDepth = SAFE_START_DEPTH;

  constructor(width: number, height: number) {
    this.resize(width, height);
    this.reset();
  }

  reset(): void {
    this.depth = 0;
    this.drillXFrac = 0.5;
    this.heat = 0;
    this.score = 0;
    this.oreCollected = 0;
    this.isOver = false;
    this.isOverheated = false;
    this.features = [];
    this.nextFeatureDepth = SAFE_START_DEPTH;
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.width = width;
    this.height = height;
  }

  step(deltaSeconds: number, input: DrillInput): void {
    if (this.isOver) return;

    const steerDir = Math.min(1, Math.max(-1, input.steerDir));
    this.drillXFrac = Math.min(
      1,
      Math.max(0, this.drillXFrac + steerDir * STEER_SPEED * deltaSeconds),
    );

    if (input.isDrilling) {
      this.heat = Math.min(MAX_HEAT, this.heat + HEAT_RATE * deltaSeconds);
      if (this.heat >= MAX_HEAT) {
        this.isOver = true;
        this.isOverheated = true;
        return;
      }
      this.depth += DRILL_SPEED * deltaSeconds;
      this.score += DRILL_SPEED * deltaSeconds * DEPTH_SCORE_PER_UNIT;
    } else {
      this.heat = Math.max(0, this.heat - COOL_RATE * deltaSeconds);
    }

    this.spawnUpcomingFeatures();

    for (const feature of this.features) {
      if (feature.isResolved) continue;
      if (Math.abs(feature.depth - this.depth) > FEATURE_THICKNESS / 2) continue;
      if (this.drillXFrac < feature.fromFrac || this.drillXFrac > feature.toFrac) continue;

      if (feature.kind === "hazard") {
        this.isOver = true;
        return;
      }
      feature.isResolved = true;
      this.oreCollected += 1;
      this.score += ORE_POINTS;
    }
  }

  private spawnUpcomingFeatures(): void {
    const lookaheadDepth = this.depth + LOOKAHEAD_DEPTH;
    const minGap = Math.max(MIN_GAP_FLOOR, BASE_MIN_GAP - this.depth * GAP_SHRINK_PER_DEPTH);
    const maxGap = Math.max(minGap + 1, BASE_MAX_GAP - this.depth * GAP_SHRINK_PER_DEPTH);

    while (this.nextFeatureDepth < lookaheadDepth) {
      const bandWidth = Math.max(
        MIN_BAND_WIDTH,
        BASE_BAND_WIDTH - this.nextFeatureDepth * BAND_SHRINK_PER_DEPTH,
      );
      const fromFrac = randRange(0, 1 - bandWidth);
      const kind: FeatureKind = Math.random() < ORE_PROBABILITY ? "ore" : "hazard";

      this.features.push({
        id: nextFeatureId++,
        depth: this.nextFeatureDepth,
        fromFrac,
        toFrac: fromFrac + bandWidth,
        kind,
        isResolved: false,
      });

      this.nextFeatureDepth += randRange(minGap, maxGap);
    }

    this.features = this.features.filter(
      (feature) => feature.depth > this.depth - FEATURE_THICKNESS,
    );
  }
}
