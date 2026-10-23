export interface Top {
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  radius: number;
  cooldown: number;
}

export type RoundResult = "win" | "lose";

export const MAX_SPIN = 100;
export const STARTING_LIVES = 3;
export const THRUST_SPIN_COST = 9;
export const THRUST_COOLDOWN = 0.32;

const TOP_RADIUS = 22;
const PASSIVE_SPIN_DECAY = 2.2; // %/秒。何もしなくても回転が緩むので、待つだけの戦略を抑止する。
const WALL_DAMAGE_FACTOR = 0.045;
const WALL_RESTITUTION = 0.72;
const FRICTION_PER_SECOND = 0.55;
const COLLISION_DAMAGE_FACTOR = 0.11;
const THRUST_SPEED_MIN = 170;
const THRUST_SPEED_MAX = 430;
const AI_MIN_COOLDOWN = 0.55;
const AI_BASE_COOLDOWN = 1.7;
const AI_COOLDOWN_STEP = 0.14;
const AI_BASE_POWER = 0.5;
const AI_POWER_STEP = 0.05;
const AI_AIM_JITTER = 0.5; // ラジアン。狙いに幅を持たせて毎回同じ軌道にならないようにする。
const BOWL_RADIUS_RATIO = 0.42;
const WIN_SCORE_BASE = 150;
const WIN_SCORE_PER_ROUND = 30;
const MAX_DRAG_DISTANCE = 140;
const START_OFFSET_RATIO = 0.55;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function normalizeAngle(angle: number): number {
  let normalized = angle % (Math.PI * 2);
  if (normalized > Math.PI) normalized -= Math.PI * 2;
  if (normalized < -Math.PI) normalized += Math.PI * 2;
  return normalized;
}

function aiCooldownForRound(round: number): number {
  return Math.max(AI_MIN_COOLDOWN, AI_BASE_COOLDOWN - (round - 1) * AI_COOLDOWN_STEP);
}

function aiPowerForRound(round: number): number {
  return Math.min(1, AI_BASE_POWER + (round - 1) * AI_POWER_STEP);
}

function createTop(): Top {
  return { x: 0, y: 0, vx: 0, vy: 0, spin: MAX_SPIN, radius: TOP_RADIUS, cooldown: 0 };
}

/**
 * ベーゴマ同士で削り合うリアルタイム対戦物理シム。
 * 「スピン」が体力と攻撃コストを兼ねるため、攻めるほど自分の寿命も削れる
 * という駆け引きが生まれる。土俵の外には出られず、スピンが尽きた側が負け。
 */
export class BeigomaDuelWorld {
  width = 0;
  height = 0;
  bowlX = 0;
  bowlY = 0;
  bowlRadius = 0;

  player: Top = createTop();
  opponent: Top = createTop();
  playerAimAngle = 0;
  playerChargePower = 0;
  playerIsCharging = false;
  round = 1;
  score = 0;
  lives = STARTING_LIVES;
  isOver = false;

  onRoundResult: ((result: RoundResult) => void) | null = null;

  constructor(width: number, height: number) {
    this.resize(width, height);
    this.reset();
  }

  reset(): void {
    this.round = 1;
    this.score = 0;
    this.lives = STARTING_LIVES;
    this.isOver = false;
    this.resetRound();
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const scaleX = this.width > 0 ? width / this.width : 1;
    const scaleY = this.height > 0 ? height / this.height : 1;
    if (this.width > 0 && this.height > 0) {
      for (const top of [this.player, this.opponent]) {
        top.x *= scaleX;
        top.y *= scaleY;
      }
    }
    this.width = width;
    this.height = height;
    this.bowlX = width / 2;
    this.bowlY = height / 2;
    this.bowlRadius = Math.min(width, height) * BOWL_RADIUS_RATIO;
  }

  beginCharge(): void {
    this.playerIsCharging = true;
  }

  endCharge(): void {
    this.playerIsCharging = false;
  }

  adjustAim(deltaRadians: number): void {
    this.playerAimAngle = normalizeAngle(this.playerAimAngle + deltaRadians);
  }

  adjustPower(delta: number): void {
    this.playerChargePower = clamp(this.playerChargePower + delta, 0, 1);
  }

  setAimFromDrag(dx: number, dy: number): void {
    const distance = Math.hypot(dx, dy);
    if (distance < 1e-3) return;
    this.playerAimAngle = Math.atan2(-dy, -dx);
    this.playerChargePower = clamp(distance / MAX_DRAG_DISTANCE, 0, 1);
  }

  launchThrust(): boolean {
    if (this.isOver || this.player.cooldown > 0 || this.player.spin <= 0) return false;
    const speed = lerp(THRUST_SPEED_MIN, THRUST_SPEED_MAX, this.playerChargePower);
    this.player.vx += Math.cos(this.playerAimAngle) * speed;
    this.player.vy += Math.sin(this.playerAimAngle) * speed;
    this.player.spin = Math.max(0, this.player.spin - THRUST_SPIN_COST);
    this.player.cooldown = THRUST_COOLDOWN;
    this.playerChargePower = 0;
    return true;
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    this.player.cooldown = Math.max(0, this.player.cooldown - deltaSeconds);
    this.updateOpponentAi(deltaSeconds);

    this.player.spin = Math.max(0, this.player.spin - PASSIVE_SPIN_DECAY * deltaSeconds);
    this.opponent.spin = Math.max(0, this.opponent.spin - PASSIVE_SPIN_DECAY * deltaSeconds);

    for (const top of [this.player, this.opponent]) {
      top.x += top.vx * deltaSeconds;
      top.y += top.vy * deltaSeconds;
      const damping = Math.max(0, 1 - FRICTION_PER_SECOND * deltaSeconds);
      top.vx *= damping;
      top.vy *= damping;
    }

    this.resolveWallCollision(this.player);
    this.resolveWallCollision(this.opponent);
    this.resolveTopCollision();

    // 同時に尽きた場合はプレイヤー側を先に判定する（判定順を固定し再現性を保つ）。
    if (this.player.spin <= 0) {
      this.handleRoundEnd("lose");
      return;
    }
    if (this.opponent.spin <= 0) {
      this.handleRoundEnd("win");
    }
  }

  private resetRound(): void {
    const offset = this.bowlRadius * START_OFFSET_RATIO;

    this.player.x = this.bowlX - offset;
    this.player.y = this.bowlY;
    this.player.vx = 0;
    this.player.vy = 0;
    this.player.spin = MAX_SPIN;
    this.player.cooldown = 0;

    this.opponent.x = this.bowlX + offset;
    this.opponent.y = this.bowlY;
    this.opponent.vx = 0;
    this.opponent.vy = 0;
    this.opponent.spin = MAX_SPIN;
    // 開始直後に即攻撃されないよう、通常クールダウンの半分だけ猶予を与える。
    this.opponent.cooldown = aiCooldownForRound(this.round) * 0.5;

    this.playerAimAngle = 0;
    this.playerChargePower = 0;
    this.playerIsCharging = false;
  }

  private updateOpponentAi(deltaSeconds: number): void {
    this.opponent.cooldown = Math.max(0, this.opponent.cooldown - deltaSeconds);
    if (this.opponent.cooldown > 0 || this.opponent.spin <= 0) return;

    const dx = this.player.x - this.opponent.x;
    const dy = this.player.y - this.opponent.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 1e-3) return;

    const jitter = (Math.random() - 0.5) * AI_AIM_JITTER;
    const angle = Math.atan2(dy, dx) + jitter;
    const power = clamp(aiPowerForRound(this.round) * (0.8 + Math.random() * 0.2), 0, 1);
    const speed = lerp(THRUST_SPEED_MIN, THRUST_SPEED_MAX, power);

    this.opponent.vx += Math.cos(angle) * speed;
    this.opponent.vy += Math.sin(angle) * speed;
    this.opponent.spin = Math.max(0, this.opponent.spin - THRUST_SPIN_COST);
    this.opponent.cooldown = aiCooldownForRound(this.round) * (0.85 + Math.random() * 0.3);
  }

  private resolveWallCollision(top: Top): void {
    const dx = top.x - this.bowlX;
    const dy = top.y - this.bowlY;
    const distance = Math.hypot(dx, dy);
    const limit = this.bowlRadius - top.radius;
    if (distance <= limit) return;

    const nx = distance > 1e-6 ? dx / distance : 1;
    const ny = distance > 1e-6 ? dy / distance : 0;
    top.x = this.bowlX + nx * limit;
    top.y = this.bowlY + ny * limit;

    const inward = top.vx * nx + top.vy * ny;
    if (inward > 0) {
      top.spin = Math.max(0, top.spin - inward * WALL_DAMAGE_FACTOR);
      top.vx -= nx * inward * (1 + WALL_RESTITUTION);
      top.vy -= ny * inward * (1 + WALL_RESTITUTION);
    }
  }

  private resolveTopCollision(): void {
    const dx = this.opponent.x - this.player.x;
    const dy = this.opponent.y - this.player.y;
    const distance = Math.hypot(dx, dy);
    const minDistance = this.player.radius + this.opponent.radius;
    if (distance >= minDistance || distance < 1e-6) return;

    const nx = dx / distance;
    const ny = dy / distance;
    const overlap = minDistance - distance;
    this.player.x -= (nx * overlap) / 2;
    this.player.y -= (ny * overlap) / 2;
    this.opponent.x += (nx * overlap) / 2;
    this.opponent.y += (ny * overlap) / 2;

    const relVx = this.player.vx - this.opponent.vx;
    const relVy = this.player.vy - this.opponent.vy;
    const impact = relVx * nx + relVy * ny;
    if (impact < 0) return; // すでに離れていく向きなら衝突応答は不要

    this.player.vx -= nx * impact;
    this.player.vy -= ny * impact;
    this.opponent.vx += nx * impact;
    this.opponent.vy += ny * impact;

    const playerSpeed = Math.hypot(this.player.vx, this.player.vy);
    const opponentSpeed = Math.hypot(this.opponent.vx, this.opponent.vy);
    const totalSpeed = playerSpeed + opponentSpeed + 1e-6;
    const impactMagnitude = Math.abs(impact);

    // 衝突後の速度が速い側ほど「強く打ち込んだ側」として相手に大きいダメージを与える。
    this.player.spin = Math.max(
      0,
      this.player.spin - impactMagnitude * COLLISION_DAMAGE_FACTOR * (opponentSpeed / totalSpeed),
    );
    this.opponent.spin = Math.max(
      0,
      this.opponent.spin - impactMagnitude * COLLISION_DAMAGE_FACTOR * (playerSpeed / totalSpeed),
    );
  }

  private handleRoundEnd(result: RoundResult): void {
    this.onRoundResult?.(result);
    if (result === "lose") {
      this.lives -= 1;
      if (this.lives <= 0) {
        this.isOver = true;
        return;
      }
    } else {
      this.score += WIN_SCORE_BASE + (this.round - 1) * WIN_SCORE_PER_ROUND;
      this.round += 1;
    }
    this.resetRound();
  }
}
