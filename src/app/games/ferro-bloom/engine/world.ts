export type MagnetMode = "attract" | "repel";

export interface Particle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** アンビエント(自然揺らぎ)の位相と速度。粒子ごとに固定してばらけさせる。 */
  wanderPhase: number;
  wanderSpeed: number;
}

export interface MagnetState {
  x: number;
  y: number;
  mode: MagnetMode;
  isActive: boolean;
}

export interface TargetZone {
  x: number;
  y: number;
  radius: number;
}

export interface TargetFilledEvent {
  combo: number;
  points: number;
}

const PARTICLE_COUNT = 80;
const PARTICLE_RADIUS = 5;
const MAX_SPEED = 420;
const DAMPING_PER_SECOND = 2.2;
const ATTRACT_STIFFNESS = 26;
const REPEL_STRENGTH = 42_000;
const REPEL_SOFTENING = 30;
const MAGNET_MAX_ACCEL = 2600;
const WANDER_ACCEL = 24;
const BOUNCE_RESTITUTION = 0.55;
export const COVERAGE_COMPLETE_THRESHOLD = 0.8;
const HOLD_SECONDS_REQUIRED = 1.4;
const SCORE_RATE_PER_SECOND = 40;
const TARGET_BASE_BONUS = 260;
const TARGET_COMBO_BONUS = 90;
const TARGET_RADIUS_START = 92;
const TARGET_RADIUS_MIN = 54;
const TARGET_RADIUS_STEP = 5;
export const ROUND_SECONDS = 75;

let nextParticleId = 1;

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * 砂鉄状の粒子群を磁石(引力/斥力)で操り、円形のターゲット領域へ導いて満たし続ける
 * リアルタイム造形パズルの純粋ロジック層。React / pixi.js には一切依存しない。
 */
export class FerroBloomWorld {
  width = 0;
  height = 0;
  particles: Particle[] = [];
  target: TargetZone = { x: 0, y: 0, radius: 0 };
  magnet: MagnetState = { x: 0, y: 0, mode: "attract", isActive: false };
  score = 0;
  timeRemaining = ROUND_SECONDS;
  isOver = false;
  combo = 0;
  coverageRatio = 0;
  private holdSeconds = 0;
  private elapsedSeconds = 0;

  onTargetFilled: ((event: TargetFilledEvent) => void) | null = null;

  constructor(width: number, height: number) {
    this.resize(width, height);
    this.reset();
  }

  reset(): void {
    this.score = 0;
    this.timeRemaining = ROUND_SECONDS;
    this.isOver = false;
    this.combo = 0;
    this.holdSeconds = 0;
    this.elapsedSeconds = 0;
    this.coverageRatio = 0;
    this.magnet = { x: this.width / 2, y: this.height / 2, mode: "attract", isActive: false };
    this.target = this.spawnTarget();
    this.particles = Array.from({ length: PARTICLE_COUNT }, () => this.spawnParticle());
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const scaleX = this.width > 0 ? width / this.width : 1;
    const scaleY = this.height > 0 ? height / this.height : 1;
    if (this.width > 0 && this.height > 0) {
      for (const particle of this.particles) {
        particle.x *= scaleX;
        particle.y *= scaleY;
      }
      this.target.x *= scaleX;
      this.target.y *= scaleY;
      this.magnet.x *= scaleX;
      this.magnet.y *= scaleY;
    }
    this.width = width;
    this.height = height;
  }

  /** ドラッグ/長押し中に磁石の位置を更新する。画面外にはみ出さない。 */
  setMagnetPosition(x: number, y: number): void {
    this.magnet.x = Math.min(Math.max(x, 0), this.width);
    this.magnet.y = Math.min(Math.max(y, 0), this.height);
  }

  /** キーボード操作用に、現在位置からの相対移動で磁石を動かす。 */
  moveMagnetBy(dx: number, dy: number): void {
    this.setMagnetPosition(this.magnet.x + dx, this.magnet.y + dy);
  }

  setMagnetActive(isActive: boolean): void {
    this.magnet.isActive = isActive;
  }

  setMagnetMode(mode: MagnetMode): void {
    this.magnet.mode = mode;
  }

  cycleMagnetMode(): void {
    this.magnet.mode = this.magnet.mode === "attract" ? "repel" : "attract";
  }

  /** ホールド進捗(0〜1)。UIでターゲットリングの充填演出に使う。 */
  get holdProgress(): number {
    return Math.min(1, this.holdSeconds / HOLD_SECONDS_REQUIRED);
  }

  private spawnParticle(): Particle {
    return {
      id: nextParticleId++,
      x: randRange(this.width * 0.2, this.width * 0.8),
      y: randRange(this.height * 0.2, this.height * 0.8),
      vx: 0,
      vy: 0,
      wanderPhase: randRange(0, Math.PI * 2),
      wanderSpeed: randRange(0.6, 1.4),
    };
  }

  private spawnTarget(): TargetZone {
    const radius = Math.max(
      TARGET_RADIUS_MIN,
      TARGET_RADIUS_START - this.combo * TARGET_RADIUS_STEP,
    );
    // 座標は width/height に対する比率で決める。resize() は既存座標を
    // scaleX/scaleY で乗算して引き継ぐため、絶対px基準の余白だと初期化直後の
    // 仮サイズ(1x1)から実サイズへ引き伸ばされた瞬間に画面外まで吹き飛んでしまう。
    const marginRatioX = this.width > 0 ? Math.min(0.45, (radius + 24) / this.width) : 0.3;
    const marginRatioY = this.height > 0 ? Math.min(0.45, (radius + 24) / this.height) : 0.3;
    return {
      x: randRange(this.width * marginRatioX, this.width * (1 - marginRatioX)),
      y: randRange(this.height * marginRatioY, this.height * (1 - marginRatioY)),
      radius,
    };
  }

  private computeCoverageRatio(): number {
    if (this.particles.length === 0) return 0;
    let inside = 0;
    for (const particle of this.particles) {
      if (
        Math.hypot(particle.x - this.target.x, particle.y - this.target.y) <= this.target.radius
      ) {
        inside++;
      }
    }
    return inside / this.particles.length;
  }

  private completeTarget(): void {
    const points = TARGET_BASE_BONUS + this.combo * TARGET_COMBO_BONUS;
    this.score += points;
    this.onTargetFilled?.({ combo: this.combo, points });
    this.combo += 1;
    this.holdSeconds = 0;
    this.target = this.spawnTarget();
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    this.timeRemaining = Math.max(0, this.timeRemaining - deltaSeconds);
    if (this.timeRemaining <= 0) {
      this.isOver = true;
      return;
    }
    this.elapsedSeconds += deltaSeconds;

    const dampingFactor = Math.exp(-DAMPING_PER_SECOND * deltaSeconds);
    const magnetActive = this.magnet.isActive;

    for (const particle of this.particles) {
      let ax = 0;
      let ay = 0;

      if (magnetActive) {
        const dx = this.magnet.x - particle.x;
        const dy = this.magnet.y - particle.y;

        if (this.magnet.mode === "attract") {
          ax += dx * ATTRACT_STIFFNESS;
          ay += dy * ATTRACT_STIFFNESS;
        } else {
          const dist = Math.max(Math.hypot(dx, dy), 1);
          const magnitude = REPEL_STRENGTH / (dist * dist + REPEL_SOFTENING);
          ax -= (dx / dist) * magnitude;
          ay -= (dy / dist) * magnitude;
        }

        const accelMagnitude = Math.hypot(ax, ay);
        if (accelMagnitude > MAGNET_MAX_ACCEL) {
          const scale = MAGNET_MAX_ACCEL / accelMagnitude;
          ax *= scale;
          ay *= scale;
        }
      }

      ax +=
        Math.cos(this.elapsedSeconds * particle.wanderSpeed + particle.wanderPhase) * WANDER_ACCEL;
      ay +=
        Math.sin(this.elapsedSeconds * particle.wanderSpeed * 1.3 + particle.wanderPhase) *
        WANDER_ACCEL;

      particle.vx = (particle.vx + ax * deltaSeconds) * dampingFactor;
      particle.vy = (particle.vy + ay * deltaSeconds) * dampingFactor;

      const speed = Math.hypot(particle.vx, particle.vy);
      if (speed > MAX_SPEED) {
        const scale = MAX_SPEED / speed;
        particle.vx *= scale;
        particle.vy *= scale;
      }

      particle.x += particle.vx * deltaSeconds;
      particle.y += particle.vy * deltaSeconds;

      if (particle.x < PARTICLE_RADIUS) {
        particle.x = PARTICLE_RADIUS;
        particle.vx = Math.abs(particle.vx) * BOUNCE_RESTITUTION;
      } else if (particle.x > this.width - PARTICLE_RADIUS) {
        particle.x = this.width - PARTICLE_RADIUS;
        particle.vx = -Math.abs(particle.vx) * BOUNCE_RESTITUTION;
      }
      if (particle.y < PARTICLE_RADIUS) {
        particle.y = PARTICLE_RADIUS;
        particle.vy = Math.abs(particle.vy) * BOUNCE_RESTITUTION;
      } else if (particle.y > this.height - PARTICLE_RADIUS) {
        particle.y = this.height - PARTICLE_RADIUS;
        particle.vy = -Math.abs(particle.vy) * BOUNCE_RESTITUTION;
      }
    }

    this.coverageRatio = this.computeCoverageRatio();
    this.score += this.coverageRatio * SCORE_RATE_PER_SECOND * deltaSeconds;

    if (this.coverageRatio >= COVERAGE_COMPLETE_THRESHOLD) {
      this.holdSeconds += deltaSeconds;
      if (this.holdSeconds >= HOLD_SECONDS_REQUIRED) {
        this.completeTarget();
      }
    } else {
      this.holdSeconds = 0;
    }
  }
}
