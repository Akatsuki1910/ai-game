export interface Spark {
  id: number;
  x: number;
  y: number;
  age: number;
  bobPhase: number;
}

export interface SparkCaughtEvent {
  spark: Spark;
  points: number;
}

/** 安定度の最大値。0になると火球が落ちて終了する。 */
export const STABILITY_MAX = 100;
/** この距離までは「静か」とみなし、安定度を減らさない。 */
export const SEPARATION_SAFE_RADIUS = 50;
/** 火花を掬える距離。 */
export const SPARK_CATCH_RADIUS = 30;

// 火球を持ち手へ引き戻すバネの強さ。ある程度強めにして、持ち手が止まれば
// すぐに追いついてくるようにする(止まった後も長く離れたままだと、1回の
// 大きな移動だけで安定度が溶け切ってしまい「揺らす」より「移動する」ことの
// ペナルティが支配的になってしまうため)。
const SPRING_STIFFNESS = 36;
// 火球の空気抵抗(1秒あたりの速度減衰指数)
const EMBER_DAMPING_PER_SECOND = 6;
// 安全距離を超えた分、1px・1秒あたりに失う安定度
const SEPARATION_PENALTY_RATE = 0.18;
// 1フレームの罰則計算に使う「安全距離を超えた分」の上限。上限がないと、
// 持ち手を遠くへ動かした瞬間(火球が追いつく前)の一瞬だけで安定度が
// 吹き飛んでしまうため、効かせる勢いに頭打ちを設ける。
const SEPARATION_EXCESS_CAP = 250;
// 安全距離内に収まっているときの、1秒あたりの安定度回復量
const STABILITY_REGEN_PER_SECOND = 22;
// 線香花火は完全に静かに持っていても自然に燃え尽きていくため、経過時間の2乗に
// 比例する形で常にわずかな自然減衰を加える。これが無いと「一切動かさない」が
// 常に最適解になってしまい、終わりのないゲームになってしまう。
const BASE_DECAY_GROWTH_PER_SECOND_SQUARED = 0.25;
// 風のランダムウォークが1秒あたりに変化しうる幅(火球への加速度 px/s^2)
const WIND_JITTER = 90;
const WIND_MAX_BASE = 18;
const WIND_MAX_GROWTH_PER_SECOND = 2.2;
const WIND_MAX_CAP = 140;
const SCORE_PER_SECOND = 12;
const SPARK_SPAWN_INTERVAL_MIN = 1.6;
const SPARK_SPAWN_INTERVAL_MAX = 2.8;
const SPARK_LIFETIME = 4.5;
const SPARK_BASE_POINTS = 60;
const SPARK_COMBO_BONUS = 15;
// 火花を掬う動作自体の反動で火球が跳ねる速さ。掬うほどリスクも増す。
const SPARK_RECOIL_SPEED = 220;
const SPARK_MARGIN_RATIO = 0.12;
const SPARK_MIN_DISTANCE_FROM_EMBER = 80;

let nextSparkId = 1;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * 線香花火の火球を、持ち手を揺らさずに持ち続けるリアルタイム集中力パズルの純粋ロジック層。
 * React / pixi.js には一切依存しない。
 *
 * 火球はバネで持ち手に引かれつつ、風のランダムウォークで常にわずかに揺らされる。
 * 持ち手と火球の距離(separation)が安全距離を超えている間は安定度が減り、
 * 0になると火球が落ちて終了する。漂う火花を掬うと加点できるが、
 * 掬う動作自体の反動も火球を揺らすリスクになる。
 */
export class SenkoSparkWorld {
  width = 0;
  height = 0;

  handX = 0;
  handY = 0;
  emberX = 0;
  emberY = 0;
  private emberVX = 0;
  private emberVY = 0;

  stability = STABILITY_MAX;
  score = 0;
  sparksCaught = 0;
  isOver = false;

  sparks: Spark[] = [];

  private windX = 0;
  private windY = 0;
  private elapsedSeconds = 0;
  private nextSparkInSeconds = 0;
  private pendingFlick = false;

  onSparkCaught: ((event: SparkCaughtEvent) => void) | null = null;

  constructor(width: number, height: number) {
    this.width = width > 0 ? width : 1;
    this.height = height > 0 ? height : 1;
    this.reset();
  }

  reset(): void {
    this.handX = this.width / 2;
    this.handY = this.height / 2;
    this.emberX = this.handX;
    this.emberY = this.handY;
    this.emberVX = 0;
    this.emberVY = 0;
    this.stability = STABILITY_MAX;
    this.score = 0;
    this.sparksCaught = 0;
    this.isOver = false;
    this.sparks = [];
    this.windX = 0;
    this.windY = 0;
    this.elapsedSeconds = 0;
    this.nextSparkInSeconds = randRange(SPARK_SPAWN_INTERVAL_MIN, SPARK_SPAWN_INTERVAL_MAX);
    this.pendingFlick = false;
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const scaleX = this.width > 0 ? width / this.width : 1;
    const scaleY = this.height > 0 ? height / this.height : 1;
    this.handX *= scaleX;
    this.handY *= scaleY;
    this.emberX *= scaleX;
    this.emberY *= scaleY;
    for (const spark of this.sparks) {
      spark.x *= scaleX;
      spark.y *= scaleY;
    }
    this.width = width;
    this.height = height;
  }

  /** ドラッグ/長押し中に持ち手の位置を更新する。画面外にはみ出さない。 */
  setHandPosition(x: number, y: number): void {
    this.handX = clamp(x, 0, this.width);
    this.handY = clamp(y, 0, this.height);
  }

  /** キーボード操作用に、現在位置からの相対移動で持ち手を動かす。 */
  moveHandBy(dx: number, dy: number): void {
    this.setHandPosition(this.handX + dx, this.handY + dy);
  }

  /** タップ/クリック/Enterで「火花を掬う」動作を要求する。判定は次の step() でまとめて行う。 */
  requestFlick(): void {
    this.pendingFlick = true;
  }

  /** 持ち手と火球の距離。安定度が減り始める基準になる。 */
  get separation(): number {
    return Math.hypot(this.emberX - this.handX, this.emberY - this.handY);
  }

  /** 現在の風の最大強度。経過時間とともに強まり、上限でクランプされる。 */
  get windMax(): number {
    return Math.min(WIND_MAX_CAP, WIND_MAX_BASE + this.elapsedSeconds * WIND_MAX_GROWTH_PER_SECOND);
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    this.elapsedSeconds += deltaSeconds;

    const windMax = this.windMax;
    this.windX = clamp(
      this.windX + randRange(-WIND_JITTER, WIND_JITTER) * deltaSeconds,
      -windMax,
      windMax,
    );
    this.windY = clamp(
      this.windY + randRange(-WIND_JITTER, WIND_JITTER) * deltaSeconds,
      -windMax,
      windMax,
    );

    const dampingFactor = Math.exp(-EMBER_DAMPING_PER_SECOND * deltaSeconds);
    this.emberVX =
      (this.emberVX +
        (this.handX - this.emberX) * SPRING_STIFFNESS * deltaSeconds +
        this.windX * deltaSeconds) *
      dampingFactor;
    this.emberVY =
      (this.emberVY +
        (this.handY - this.emberY) * SPRING_STIFFNESS * deltaSeconds +
        this.windY * deltaSeconds) *
      dampingFactor;
    this.emberX += this.emberVX * deltaSeconds;
    this.emberY += this.emberVY * deltaSeconds;

    this.stability -= BASE_DECAY_GROWTH_PER_SECOND_SQUARED * this.elapsedSeconds * deltaSeconds;
    if (this.separation > SEPARATION_SAFE_RADIUS) {
      const excess = Math.min(this.separation - SEPARATION_SAFE_RADIUS, SEPARATION_EXCESS_CAP);
      this.stability -= excess * SEPARATION_PENALTY_RATE * deltaSeconds;
    } else {
      this.stability += STABILITY_REGEN_PER_SECOND * deltaSeconds;
    }
    this.stability = clamp(this.stability, 0, STABILITY_MAX);

    if (this.pendingFlick) {
      this.pendingFlick = false;
      this.resolveFlick();
    }

    this.updateSparks(deltaSeconds);

    if (this.stability <= 0) {
      this.stability = 0;
      this.isOver = true;
      return;
    }

    this.score += SCORE_PER_SECOND * deltaSeconds;
  }

  private resolveFlick(): void {
    let closestIndex = -1;
    let closestDistance = SPARK_CATCH_RADIUS;
    for (let i = 0; i < this.sparks.length; i++) {
      const distance = Math.hypot(this.sparks[i].x - this.emberX, this.sparks[i].y - this.emberY);
      if (distance <= closestDistance) {
        closestDistance = distance;
        closestIndex = i;
      }
    }
    if (closestIndex === -1) return;

    const [spark] = this.sparks.splice(closestIndex, 1);
    this.sparksCaught += 1;
    const points = SPARK_BASE_POINTS + this.sparksCaught * SPARK_COMBO_BONUS;
    this.score += points;
    this.onSparkCaught?.({ spark, points });

    const angle = randRange(0, Math.PI * 2);
    this.emberVX += Math.cos(angle) * SPARK_RECOIL_SPEED;
    this.emberVY += Math.sin(angle) * SPARK_RECOIL_SPEED;
  }

  private updateSparks(deltaSeconds: number): void {
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const spark = this.sparks[i];
      spark.age += deltaSeconds;
      if (spark.age >= SPARK_LIFETIME) {
        this.sparks.splice(i, 1);
      }
    }

    this.nextSparkInSeconds -= deltaSeconds;
    if (this.nextSparkInSeconds <= 0) {
      this.nextSparkInSeconds = randRange(SPARK_SPAWN_INTERVAL_MIN, SPARK_SPAWN_INTERVAL_MAX);
      this.sparks.push(this.spawnSpark());
    }
  }

  private spawnSpark(): Spark {
    const marginX = this.width * SPARK_MARGIN_RATIO;
    const marginY = this.height * SPARK_MARGIN_RATIO;
    let x = randRange(marginX, Math.max(marginX, this.width - marginX));
    let y = randRange(marginY, Math.max(marginY, this.height - marginY));

    // 火球からあまり近い位置に出すと何もせず拾えてしまうので、離れた位置へ出し直す。
    for (let attempt = 0; attempt < 6; attempt++) {
      if (Math.hypot(x - this.emberX, y - this.emberY) >= SPARK_MIN_DISTANCE_FROM_EMBER) break;
      x = randRange(marginX, Math.max(marginX, this.width - marginX));
      y = randRange(marginY, Math.max(marginY, this.height - marginY));
    }

    return { id: nextSparkId++, x, y, age: 0, bobPhase: randRange(0, Math.PI * 2) };
  }
}
