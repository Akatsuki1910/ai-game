export interface Gem {
  id: number;
  x: number;
}

export interface GemCollectedEvent {
  gem: Gem;
  points: number;
}

/** ワールド座標系の基準となる縦幅。画面サイズが変わってもゲーム内の物理法則はこの値で一定にする。 */
export const LOGICAL_HEIGHT = 600;
/** ワイヤーの高さ(ロジカル座標)。プレイヤーは常にこの高さに留まる。 */
export const WIRE_Y = 300;
/** これを超えて傾くと踏みとどまれず転落する角度(ラジアン、約60度)。 */
export const FALL_ANGLE = Math.PI / 3;
/** この距離以内にジェムが来たら自動で拾う。 */
export const GEM_COLLECT_RADIUS = 26;

// 傾くほど加速度的に倒れやすくなる、逆さ振り子特有の不安定平衡の強さ。
// あまり強くすると一瞬の反応遅れだけで転落してしまうため、無操作でも数秒は猶予があるように抑えてある。
const GRAVITY_TORQUE = 2.6;
// プレイヤーが体重をかけたときに立て直す力
const CONTROL_TORQUE = 7.2;
// 筋肉・空気抵抗による角速度の減衰(1フレームごとの乗算)
const ANGULAR_DAMPING = 0.996;
// 風のランダムウォークが1秒あたりに変化しうる幅
const WIND_JITTER = 1.1;
// 開始直後の風の最大強度
const WIND_MAX_BASE = 0.12;
// 経過時間に応じて風の最大強度が強まっていく速さ
const WIND_MAX_GROWTH_PER_SECOND = 0.02;
const WIND_MAX_CAP = 3.0;
// 直立時の前進速度(px/秒)
const BASE_FORWARD_SPEED = 130;
// 傾いているときの減速の強さ(1に近いほど、限界角度付近でほぼ停止する)
const TILT_SPEED_PENALTY = 0.85;
const GEM_SPACING_MIN = 240;
const GEM_SPACING_MAX = 420;
const GEM_SCORE_BASE = 20;
// ふらついていないほど加点されるボーナスの最大値
const GEM_PRECISION_BONUS_MAX = 20;
// 現在の表示幅の何倍先までジェムを生成しておくか(リサイズで急に画面が広がっても足りるように余裕を持たせる)
const SPAWN_AHEAD_MULTIPLIER = 1.6;
const PRUNE_BEHIND_MARGIN = 300;
const DISTANCE_SCORE_DIVISOR = 8;

let nextGemId = 1;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * 綱渡りのワールド。逆さ振り子(倒立振子)として傾き角 theta を積分し、
 * プレイヤーは「どちらに体重をかけるか」だけを操作する。
 * theta=0 は不安定平衡で、風のランダムウォークが常にわずかに揺さぶり続ける。
 */
export class HighWireWorld {
  width = 0;
  height = 0;

  /** 傾き角(ラジアン)。正の値は右に傾いている。 */
  theta = 0;
  /** 角速度(ラジアン/秒)。 */
  omega = 0;
  private lean: -1 | 0 | 1 = 0;

  /** ワイヤー上を進んだ距離(ロジカル座標のX)。 */
  distance = 0;
  private windTorque = 0;
  private elapsedSeconds = 0;

  gems: Gem[] = [];
  private lastSpawnX = 0;
  /** ジェムを拾って得た得点の合計。距離ぶんの得点と合算して score になる。 */
  private gemBonus = 0;

  score = 0;
  gemsCollected = 0;
  isOver = false;

  onGemCollected: ((event: GemCollectedEvent) => void) | null = null;

  constructor(width: number, height: number) {
    this.width = width > 0 ? width : 1;
    this.height = height > 0 ? height : 1;
    this.reset();
  }

  reset(): void {
    this.theta = 0;
    this.omega = 0;
    this.lean = 0;
    this.distance = 0;
    this.windTorque = 0;
    this.elapsedSeconds = 0;
    this.gems = [];
    this.lastSpawnX = 0;
    this.gemBonus = 0;
    this.score = 0;
    this.gemsCollected = 0;
    this.isOver = false;
    this.ensureGemsAhead();
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.width = width;
    this.height = height;
    this.ensureGemsAhead();
  }

  /** 画面の縦幅に対する物理スケール(ロジカル座標→画面ピクセル)。 */
  get scale(): number {
    return this.height > 0 ? this.height / LOGICAL_HEIGHT : 1;
  }

  /** 現在の画面幅を、ロジカル座標の横幅に換算した値。 */
  get logicalViewWidth(): number {
    return this.scale > 0 ? this.width / this.scale : this.width;
  }

  /** 描画側が使う、追従カメラの左端のワールドX座標。プレイヤーは画面のやや左寄りに固定表示する。 */
  get cameraX(): number {
    return Math.max(0, this.distance - this.logicalViewWidth * 0.35);
  }

  /** 現在の風の最大強度。経過時間とともに強まり、上限でクランプされる。 */
  get windMax(): number {
    return Math.min(WIND_MAX_CAP, WIND_MAX_BASE + this.elapsedSeconds * WIND_MAX_GROWTH_PER_SECOND);
  }

  get windTorqueValue(): number {
    return this.windTorque;
  }

  /** 左右どちらに体重をかけるか(-1=左, 0=中立, 1=右)。押している間、毎フレーム呼ぶ想定。 */
  setLean(direction: -1 | 0 | 1): void {
    this.lean = direction;
  }

  /** バランスを崩すテストや将来の演出フック向けに、直接傾きを変更する補助メソッド。 */
  setTilt(theta: number, omega = 0): void {
    this.theta = theta;
    this.omega = omega;
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    this.elapsedSeconds += deltaSeconds;

    // 風はランダムウォークで変化し、経時的に強まる上限の範囲でクランプされる
    this.windTorque = clamp(
      this.windTorque + randRange(-WIND_JITTER, WIND_JITTER) * deltaSeconds,
      -this.windMax,
      this.windMax,
    );

    const gravityTorque = GRAVITY_TORQUE * Math.sin(this.theta);
    const controlTorque = CONTROL_TORQUE * this.lean;
    this.omega += (gravityTorque + this.windTorque + controlTorque) * deltaSeconds;
    this.omega *= ANGULAR_DAMPING;
    this.theta += this.omega * deltaSeconds;

    if (Math.abs(this.theta) >= FALL_ANGLE) {
      this.theta = Math.sign(this.theta) * FALL_ANGLE;
      this.isOver = true;
      return;
    }

    const tiltRatio = Math.abs(this.theta) / FALL_ANGLE;
    const forwardSpeed = BASE_FORWARD_SPEED * (1 - tiltRatio * TILT_SPEED_PENALTY);
    this.distance += forwardSpeed * deltaSeconds;

    this.collectGems();
    this.score = Math.floor(this.distance / DISTANCE_SCORE_DIVISOR) + this.gemBonus;
    this.ensureGemsAhead();
  }

  private collectGems(): void {
    for (let i = this.gems.length - 1; i >= 0; i--) {
      const gem = this.gems[i];
      if (Math.abs(gem.x - this.distance) > GEM_COLLECT_RADIUS) continue;

      this.gems.splice(i, 1);
      this.gemsCollected += 1;

      const steadiness = clamp(1 - Math.abs(this.theta) / FALL_ANGLE, 0, 1);
      const points = GEM_SCORE_BASE + Math.round(steadiness * GEM_PRECISION_BONUS_MAX);
      this.gemBonus += points;
      this.onGemCollected?.({ gem, points });
    }
  }

  private ensureGemsAhead(): void {
    const horizon = this.cameraX + this.logicalViewWidth * SPAWN_AHEAD_MULTIPLIER;
    while (this.lastSpawnX < horizon) {
      this.lastSpawnX += randRange(GEM_SPACING_MIN, GEM_SPACING_MAX);
      this.gems.push({ id: nextGemId++, x: this.lastSpawnX });
    }

    const pruneBefore = this.cameraX - PRUNE_BEHIND_MARGIN;
    while (this.gems.length > 0 && this.gems[0].x < pruneBefore) {
      this.gems.shift();
    }
  }
}
