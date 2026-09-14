import {
  clamp,
  constrainDistance,
  distance,
  integrateVerlet,
  type Point,
  randRange,
} from "./physics.ts";

export interface Anchor {
  id: number;
  x: number;
  y: number;
}

export interface AnchorGrabbedEvent {
  anchor: Anchor;
  points: number;
  combo: number;
}

/** ワールド座標系の基準となる縦幅。画面サイズが変わってもゲーム内の物理法則はこの値で一定にする。 */
export const LOGICAL_HEIGHT = 600;
/** これより下に落ちたら谷底へ転落したとみなす。 */
export const GROUND_Y = 560;
export const PLAYER_RADIUS = 14;
/** つかもうとした瞬間、この距離以内にあるアンカーだけをつかめる。 */
export const GRAB_RADIUS = 70;
export const MIN_ROPE_LENGTH = 70;
export const MAX_ROPE_LENGTH = 220;

const GRAVITY = 1600;
const VELOCITY_DAMPING = 0.998;
const ANCHOR_SPACING_MIN = 190;
const ANCHOR_SPACING_MAX = 330;
const ANCHOR_Y_MIN = 140;
const ANCHOR_Y_MAX = 420;
const START_ANCHOR_Y = 260;
const START_ROPE_LENGTH = 150;
/** 振り子が最初から自然に揺れ始めるよう、鉛直から少しずらして開始する。 */
const START_ANGLE_FROM_VERTICAL = Math.PI / 7;
/** 現在の表示幅の何倍先までアンカーを生成しておくか（リサイズで急に画面が広がっても足りるように余裕を持たせる）。 */
const SPAWN_AHEAD_MULTIPLIER = 1.6;
const PRUNE_BEHIND_MARGIN = 400;
const GRAB_POINTS_BASE = 40;
const GRAB_POINTS_PER_COMBO = 10;
const DISTANCE_SCORE_DIVISOR = 5;

let nextAnchorId = 1;

/**
 * ロープアクションのワールド。Verlet積分 + 距離拘束で振り子運動を表現し、
 * 「つかむ/放す」のタイミングだけをプレイヤー操作として扱う。
 */
export class GrappleArcWorld {
  width = 0;
  height = 0;

  playerX = 0;
  playerY = 0;
  private prevPlayerX = 0;
  private prevPlayerY = 0;

  isAttached = false;
  attachedAnchorId: number | null = null;
  ropeLength = 0;
  /** 直前に離したアンカー。離した直後に同じアンカーへ即再フックしてしまうのを防ぐ。 */
  private lastAnchorId: number | null = null;

  anchors: Anchor[] = [];
  private lastSpawnX = 0;

  score = 0;
  /** アンカーを掴んで得た得点の合計。距離ぶんの得点と合算して score になる。 */
  private grabBonus = 0;
  combo = 0;
  bestCombo = 0;
  anchorsGrabbed = 0;
  furthestX = 0;
  isOver = false;

  onAnchorGrabbed: ((event: AnchorGrabbedEvent) => void) | null = null;

  constructor(width: number, height: number) {
    this.width = width > 0 ? width : 1;
    this.height = height > 0 ? height : 1;
    this.reset();
  }

  reset(): void {
    this.anchors = [];
    this.lastSpawnX = 0;

    const startAnchor: Anchor = { id: nextAnchorId++, x: 0, y: START_ANCHOR_Y };
    this.anchors.push(startAnchor);
    this.lastSpawnX = startAnchor.x;

    this.score = 0;
    this.grabBonus = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.anchorsGrabbed = 0;
    this.furthestX = 0;
    this.isOver = false;

    this.isAttached = true;
    this.attachedAnchorId = startAnchor.id;
    this.lastAnchorId = startAnchor.id;
    this.ropeLength = START_ROPE_LENGTH;

    this.playerX = startAnchor.x + Math.sin(START_ANGLE_FROM_VERTICAL) * START_ROPE_LENGTH;
    this.playerY = startAnchor.y + Math.cos(START_ANGLE_FROM_VERTICAL) * START_ROPE_LENGTH;
    this.prevPlayerX = this.playerX;
    this.prevPlayerY = this.playerY;

    this.ensureAnchorsAhead();
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.width = width;
    this.height = height;
    this.ensureAnchorsAhead();
  }

  /** 画面の縦幅に対する物理スケール（ロジカル座標→画面ピクセル）。 */
  get scale(): number {
    return this.height > 0 ? this.height / LOGICAL_HEIGHT : 1;
  }

  /** 現在の画面幅を、ロジカル座標の横幅に換算した値。 */
  get logicalViewWidth(): number {
    return this.scale > 0 ? this.width / this.scale : this.width;
  }

  /** 描画側が使う、追従カメラの左端のワールドX座標。 */
  get cameraX(): number {
    return Math.max(0, this.playerX - this.logicalViewWidth * 0.35);
  }

  /** つかもうとする（マウスダウン/タップ/キー押下）。範囲内にアンカーがなければコンボが途切れる。 */
  attemptGrab(): void {
    if (this.isOver || this.isAttached) return;

    let nearest: Anchor | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const anchor of this.anchors) {
      if (anchor.id === this.lastAnchorId) continue;
      const d = distance(this.playerX, this.playerY, anchor.x, anchor.y);
      if (d <= GRAB_RADIUS && d < nearestDistance) {
        nearest = anchor;
        nearestDistance = d;
      }
    }

    if (!nearest) {
      this.combo = 0;
      return;
    }

    this.isAttached = true;
    this.attachedAnchorId = nearest.id;
    this.lastAnchorId = nearest.id;
    this.ropeLength = clamp(nearestDistance, MIN_ROPE_LENGTH, MAX_ROPE_LENGTH);

    this.combo += 1;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.anchorsGrabbed += 1;

    const points = GRAB_POINTS_BASE + (this.combo - 1) * GRAB_POINTS_PER_COMBO;
    this.grabBonus += points;
    this.score = this.grabBonus + Math.floor(this.furthestX / DISTANCE_SCORE_DIVISOR);
    this.onAnchorGrabbed?.({ anchor: nearest, points, combo: this.combo });
  }

  /** 放す（マウスアップ/タップ終了/キー解放）。 */
  release(): void {
    if (this.isOver || !this.isAttached) return;
    this.isAttached = false;
    this.attachedAnchorId = null;
  }

  /** プレイヤーを速度ゼロの状態で指定位置へ移す（テストや将来の演出フック向けの補助メソッド）。 */
  teleportTo(x: number, y: number): void {
    this.playerX = x;
    this.playerY = y;
    this.prevPlayerX = x;
    this.prevPlayerY = y;
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    const current: Point = { x: this.playerX, y: this.playerY };
    const previous: Point = { x: this.prevPlayerX, y: this.prevPlayerY };
    let next = integrateVerlet(current, previous, GRAVITY, deltaSeconds, VELOCITY_DAMPING);

    if (this.isAttached && this.attachedAnchorId !== null) {
      const anchor = this.anchors.find((a) => a.id === this.attachedAnchorId);
      if (anchor) {
        next = constrainDistance(next, anchor, this.ropeLength);
      } else {
        this.isAttached = false;
        this.attachedAnchorId = null;
      }
    }

    this.prevPlayerX = this.playerX;
    this.prevPlayerY = this.playerY;
    this.playerX = next.x;
    this.playerY = next.y;

    this.furthestX = Math.max(this.furthestX, this.playerX);
    this.score = this.grabBonus + Math.floor(this.furthestX / DISTANCE_SCORE_DIVISOR);

    if (this.playerY - PLAYER_RADIUS > GROUND_Y) {
      this.isOver = true;
      return;
    }

    this.ensureAnchorsAhead();
  }

  private ensureAnchorsAhead(): void {
    const horizon = this.cameraX + this.logicalViewWidth * SPAWN_AHEAD_MULTIPLIER;
    while (this.lastSpawnX < horizon) {
      this.lastSpawnX += randRange(ANCHOR_SPACING_MIN, ANCHOR_SPACING_MAX);
      const y = randRange(ANCHOR_Y_MIN, ANCHOR_Y_MAX);
      this.anchors.push({ id: nextAnchorId++, x: this.lastSpawnX, y });
    }

    const pruneBefore = this.cameraX - PRUNE_BEHIND_MARGIN;
    while (
      this.anchors.length > 1 &&
      this.anchors[0].x < pruneBefore &&
      this.anchors[0].id !== this.attachedAnchorId
    ) {
      this.anchors.shift();
    }
  }
}
