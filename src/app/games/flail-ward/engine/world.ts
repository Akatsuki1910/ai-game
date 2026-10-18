export interface Meteor {
  id: number;
  /** 中心から見た方向(ラジアン)。中心へ直進するため飛行中は変化しない。 */
  angle: number;
  /** 中心からの現在距離。0に近づくほどコアに迫っている。 */
  distance: number;
  /** 距離が減る速さ(px/秒)。 */
  speed: number;
  /** 当たり判定用の半径。 */
  size: number;
}

export interface MeteorDeflectedEvent {
  points: number;
  streak: number;
  x: number;
  y: number;
}

export interface CoreHitEvent {
  livesRemaining: number;
  x: number;
  y: number;
}

export const START_LIVES = 6;

const CORE_RADIUS_RATIO = 0.09;
const CORE_RADIUS_MIN = 20;
const CORE_RADIUS_MAX = 56;
const FLAIL_RADIUS_RATIO = 0.33;
const FLAIL_RADIUS_MIN = 70;
const FLAIL_RADIUS_MAX = 230;
const BALL_RADIUS_RATIO = 0.07;
const BALL_RADIUS_MIN = 16;
const BALL_RADIUS_MAX = 40;
const METEOR_SIZE_RATIO = 0.05;
const METEOR_SIZE_MIN = 11;
const METEOR_SIZE_MAX = 32;
const SPAWN_MARGIN = 60;

// フレイルの追従はバネ-ダンパ系(角度の2階微分)で表現する。ポインタの直下へ瞬間移動
// させると「振り回す」感触が失われ、強すぎる減衰は反応が鈍くなるため両方を調整する。
const SPRING_STIFFNESS = 140;
const SPRING_DAMPING = 12;
const KEYBOARD_ROTATE_SPEED = 2.6;

const TRAVEL_SECONDS_MIN = 2.6;
const TRAVEL_SECONDS_MAX = 3.6;
const DIFFICULTY_RAMP_SECONDS = 70;
const MAX_DIFFICULTY = 1.9;

const SPAWN_INTERVAL_START = 1.2;
const SPAWN_INTERVAL_MIN = 0.42;
const SPAWN_INTERVAL_DECAY_PER_SECOND = 0.011;
const INITIAL_SPAWN_DELAY = 0.25;

const BASE_POINTS = 40;
const STREAK_BONUS_PER = 12;
const STREAK_BONUS_MAX = 160;

let nextMeteorId = 1;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** 角度差を [-π, π] に正規化する。 */
function wrapAngle(angle: number): number {
  let a = angle % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * 中央のコアを狙って四方から飛来するメテオを、鎖でつながったフレイル(鉄球)を
 * 振り回して弾き返すリアルタイム防衛ゲームの純粋ロジック層。
 * React / pixi.js には一切依存しない。
 *
 * フレイルは中心からの角度だけを状態として持ち、絶対座標は ballPosition() で
 * 都度算出する。コア半径・フレイル半径・ボール半径はすべて width/height の
 * 比率から導出するため、resize() のたびに再配置する必要がない。
 */
export class FlailWardWorld {
  width = 0;
  height = 0;

  ballAngle = -Math.PI / 2;
  angularVelocity = 0;
  targetAngle = -Math.PI / 2;

  meteors: Meteor[] = [];

  score = 0;
  streak = 0;
  lives = START_LIVES;
  meteorsDeflected = 0;
  meteorsReachedCore = 0;
  isOver = false;

  private elapsedSeconds = 0;
  private spawnTimer = INITIAL_SPAWN_DELAY;

  onMeteorDeflected: ((event: MeteorDeflectedEvent) => void) | null = null;
  onCoreHit: ((event: CoreHitEvent) => void) | null = null;

  constructor(width: number, height: number) {
    this.width = width > 0 ? width : 1;
    this.height = height > 0 ? height : 1;
    this.reset();
  }

  reset(): void {
    this.meteors = [];
    this.ballAngle = -Math.PI / 2;
    this.angularVelocity = 0;
    this.targetAngle = -Math.PI / 2;
    this.score = 0;
    this.streak = 0;
    this.lives = START_LIVES;
    this.meteorsDeflected = 0;
    this.meteorsReachedCore = 0;
    this.isOver = false;
    this.elapsedSeconds = 0;
    this.spawnTimer = INITIAL_SPAWN_DELAY;
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const oldScale = this.width > 0 && this.height > 0 ? Math.min(this.width, this.height) : 0;
    this.width = width;
    this.height = height;
    if (oldScale <= 0) return;

    const factor = this.scale / oldScale;
    for (const meteor of this.meteors) {
      meteor.distance *= factor;
      meteor.speed *= factor;
    }
  }

  get centerX(): number {
    return this.width / 2;
  }

  get centerY(): number {
    return this.height / 2;
  }

  get scale(): number {
    return Math.min(this.width, this.height);
  }

  get coreRadius(): number {
    return clamp(this.scale * CORE_RADIUS_RATIO, CORE_RADIUS_MIN, CORE_RADIUS_MAX);
  }

  get flailRadius(): number {
    return clamp(this.scale * FLAIL_RADIUS_RATIO, FLAIL_RADIUS_MIN, FLAIL_RADIUS_MAX);
  }

  get ballRadius(): number {
    return clamp(this.scale * BALL_RADIUS_RATIO, BALL_RADIUS_MIN, BALL_RADIUS_MAX);
  }

  get spawnDistance(): number {
    return Math.hypot(this.width, this.height) / 2 + SPAWN_MARGIN;
  }

  get ballPosition(): { x: number; y: number } {
    return {
      x: this.centerX + Math.cos(this.ballAngle) * this.flailRadius,
      y: this.centerY + Math.sin(this.ballAngle) * this.flailRadius,
    };
  }

  meteorPosition(meteor: Meteor): { x: number; y: number } {
    return {
      x: this.centerX + Math.cos(meteor.angle) * meteor.distance,
      y: this.centerY + Math.sin(meteor.angle) * meteor.distance,
    };
  }

  /** ポインタの位置へフレイルを振る。ドラッグ/長押し中に毎フレーム呼ぶ想定。 */
  aimAt(x: number, y: number): void {
    const dx = x - this.centerX;
    const dy = y - this.centerY;
    if (Math.hypot(dx, dy) < 1e-3) return;
    this.targetAngle = Math.atan2(dy, dx);
  }

  /** キーボードでの回転入力。押している間、毎フレーム呼ぶ想定。 */
  rotateManually(direction: -1 | 0 | 1, deltaSeconds: number): void {
    if (direction === 0) return;
    this.targetAngle += direction * KEYBOARD_ROTATE_SPEED * deltaSeconds;
  }

  private get difficulty(): number {
    return 1 + Math.min(MAX_DIFFICULTY - 1, this.elapsedSeconds / DIFFICULTY_RAMP_SECONDS);
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;
    this.elapsedSeconds += deltaSeconds;

    const angleError = wrapAngle(this.targetAngle - this.ballAngle);
    this.angularVelocity +=
      (angleError * SPRING_STIFFNESS - this.angularVelocity * SPRING_DAMPING) * deltaSeconds;
    this.ballAngle += this.angularVelocity * deltaSeconds;

    this.spawnTimer -= deltaSeconds;
    if (this.spawnTimer <= 0) {
      this.spawnMeteor();
      const interval = Math.max(
        SPAWN_INTERVAL_MIN,
        SPAWN_INTERVAL_START - this.elapsedSeconds * SPAWN_INTERVAL_DECAY_PER_SECOND,
      );
      this.spawnTimer += interval;
    }

    const ballPos = this.ballPosition;
    for (let i = this.meteors.length - 1; i >= 0; i--) {
      const meteor = this.meteors[i];
      meteor.distance -= meteor.speed * deltaSeconds;
      const pos = this.meteorPosition(meteor);

      const distToBall = Math.hypot(pos.x - ballPos.x, pos.y - ballPos.y);
      if (distToBall <= meteor.size + this.ballRadius) {
        this.meteors.splice(i, 1);
        this.streak += 1;
        this.meteorsDeflected += 1;
        const points =
          BASE_POINTS + Math.min(STREAK_BONUS_MAX, (this.streak - 1) * STREAK_BONUS_PER);
        this.score += points;
        this.onMeteorDeflected?.({ points, streak: this.streak, x: pos.x, y: pos.y });
        continue;
      }

      if (meteor.distance <= this.coreRadius) {
        this.meteors.splice(i, 1);
        this.streak = 0;
        this.meteorsReachedCore += 1;
        this.lives -= 1;
        this.onCoreHit?.({ livesRemaining: this.lives, x: pos.x, y: pos.y });
        if (this.lives <= 0) {
          this.isOver = true;
        }
      }
    }
  }

  private spawnMeteor(): void {
    const angle = randRange(0, Math.PI * 2);
    const travelSeconds = randRange(TRAVEL_SECONDS_MIN, TRAVEL_SECONDS_MAX) / this.difficulty;
    const distance = this.spawnDistance;
    const size =
      clamp(this.scale * METEOR_SIZE_RATIO, METEOR_SIZE_MIN, METEOR_SIZE_MAX) *
      randRange(0.85, 1.2);
    this.meteors.push({
      id: nextMeteorId++,
      angle,
      distance,
      speed: distance / travelSeconds,
      size,
    });
  }
}
