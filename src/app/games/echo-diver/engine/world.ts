export interface Rock {
  x: number;
  y: number;
  r: number;
}

export interface Pearl {
  x: number;
  y: number;
}

export interface Ping {
  x: number;
  y: number;
  age: number;
}

export interface SubState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
}

export interface LeviathanState {
  x: number;
  y: number;
  angle: number;
  mode: "patrol" | "hunt";
  targetX: number;
  targetY: number;
}

export interface PearlPickupEvent {
  x: number;
  y: number;
  points: number;
}

const ROCK_COUNT = 15;
const PEARL_COUNT = 5;
const ARENA_MARGIN = 0.94;

const SUB_RADIUS_FRAC = 0.026;
const ROCK_RADIUS_MIN_FRAC = 0.035;
const ROCK_RADIUS_MAX_FRAC = 0.075;
const PEARL_RADIUS_FRAC = 0.016;
const LEVIATHAN_RADIUS_FRAC = 0.05;
const AMBIENT_RADIUS_FRAC = 0.11;

const THRUST_ACCEL_FRAC = 1.7;
const DRAG_PER_SECOND = 2.1;
const MAX_SPEED_FRAC = 0.36;

const PING_SPEED_FRAC = 0.62;
export const PING_LIFETIME = 1.8;
const MAX_ACTIVE_PINGS = 3;

export const MAX_CHARGES = 3;
const CHARGE_REGEN_SECONDS = 2.0;

const LEVIATHAN_BASE_SPEED_FRAC = 0.15;
const LEVIATHAN_MAX_SPEED_FRAC = 0.3;
const LEVIATHAN_SPEED_RAMP_PER_SEC_FRAC = 0.0028;
const LEVIATHAN_PATROL_SPEED_FRAC = 0.08;
const LEVIATHAN_SENSE_RADIUS_FRAC = 0.13;

const SAFE_ZONE_RADIUS_FRAC = 0.17;
const PEARL_SCORE = 15;
const SURVIVAL_SCORE_PER_SECOND = 6;

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** 円同士が重ならない位置を乱数で探す。見つからなければ最後に試した位置を返す。 */
function findOpenSpot(
  arenaSize: number,
  radius: number,
  avoid: { x: number; y: number; r: number }[],
  attempts = 40,
): { x: number; y: number } {
  const margin = radius * 1.4;
  let best = { x: arenaSize / 2, y: arenaSize / 2 };
  for (let i = 0; i < attempts; i++) {
    const x = randRange(margin, arenaSize - margin);
    const y = randRange(margin, arenaSize - margin);
    best = { x, y };
    const ok = avoid.every((a) => Math.hypot(x - a.x, y - a.y) >= radius + a.r);
    if (ok) return { x, y };
  }
  return best;
}

/**
 * 深海洞窟を漂う潜水艇のワールド。ソナー(ping)を出さないと岩・真珠・怪物レビヤタンは
 * ほぼ見えない。ソナーは自分の周囲を照らすが、同時にレビヤタンをその発信位置へ引き寄せる。
 */
export class EchoDiverWorld {
  width = 0;
  height = 0;
  arenaSize = 0;
  offsetX = 0;
  offsetY = 0;

  subRadius = 0;
  rockRadiusMin = 0;
  rockRadiusMax = 0;
  pearlRadius = 0;
  leviathanRadius = 0;
  ambientRadius = 0;

  thrustAccel = 0;
  maxSpeed = 0;
  pingSpeed = 0;
  leviathanBaseSpeed = 0;
  leviathanMaxSpeed = 0;
  leviathanSpeedRampPerSec = 0;
  leviathanPatrolSpeed = 0;
  leviathanSenseRadius = 0;
  safeZoneRadius = 0;

  sub: SubState = { x: 0, y: 0, vx: 0, vy: 0, angle: 0 };
  leviathan: LeviathanState = { x: 0, y: 0, angle: 0, mode: "patrol", targetX: 0, targetY: 0 };
  rocks: Rock[] = [];
  pearls: Pearl[] = [];
  pings: Ping[] = [];

  thrust = { x: 0, y: 0 };

  charges = MAX_CHARGES;
  private chargeTimer = 0;

  elapsed = 0;
  score = 0;
  pearlsCollected = 0;
  isOver = false;
  /** rocks の配置が変わるたびに増える版数。描画側の再構築要否判定に使う。 */
  layoutVersion = 0;

  onPearlCollected: ((event: PearlPickupEvent) => void) | null = null;
  onPing: (() => void) | null = null;
  onCaught: (() => void) | null = null;

  constructor(width: number, height: number) {
    this.resize(width, height);
    this.reset();
  }

  reset(): void {
    this.elapsed = 0;
    this.score = 0;
    this.pearlsCollected = 0;
    this.charges = MAX_CHARGES;
    this.chargeTimer = 0;
    this.pings = [];
    this.thrust = { x: 0, y: 0 };
    this.isOver = false;

    const center = this.arenaSize / 2;
    this.sub = { x: center, y: center, vx: 0, vy: 0, angle: 0 };

    this.rocks = [];
    const placed: { x: number; y: number; r: number }[] = [
      { x: center, y: center, r: this.arenaSize * SAFE_ZONE_RADIUS_FRAC },
    ];
    for (let i = 0; i < ROCK_COUNT; i++) {
      const r = randRange(this.rockRadiusMin, this.rockRadiusMax);
      const spot = findOpenSpot(this.arenaSize, r, placed);
      this.rocks.push({ x: spot.x, y: spot.y, r });
      placed.push({ x: spot.x, y: spot.y, r });
    }

    this.pearls = [];
    for (let i = 0; i < PEARL_COUNT; i++) {
      this.pearls.push(this.spawnPearlPosition());
    }

    const edgeAngle = randRange(0, Math.PI * 2);
    this.leviathan = {
      x: center + Math.cos(edgeAngle) * this.arenaSize * 0.42,
      y: center + Math.sin(edgeAngle) * this.arenaSize * 0.42,
      angle: 0,
      mode: "patrol",
      targetX: center,
      targetY: center,
    };
    this.pickLeviathanPatrolTarget();

    this.layoutVersion++;
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const newArenaSize = Math.min(width, height) * ARENA_MARGIN;
    const scale = this.arenaSize > 0 ? newArenaSize / this.arenaSize : 1;

    this.width = width;
    this.height = height;
    this.offsetX = (width - newArenaSize) / 2;
    this.offsetY = (height - newArenaSize) / 2;
    this.arenaSize = newArenaSize;

    this.subRadius = newArenaSize * SUB_RADIUS_FRAC;
    this.rockRadiusMin = newArenaSize * ROCK_RADIUS_MIN_FRAC;
    this.rockRadiusMax = newArenaSize * ROCK_RADIUS_MAX_FRAC;
    this.pearlRadius = newArenaSize * PEARL_RADIUS_FRAC;
    this.leviathanRadius = newArenaSize * LEVIATHAN_RADIUS_FRAC;
    this.ambientRadius = newArenaSize * AMBIENT_RADIUS_FRAC;

    this.thrustAccel = newArenaSize * THRUST_ACCEL_FRAC;
    this.maxSpeed = newArenaSize * MAX_SPEED_FRAC;
    this.pingSpeed = newArenaSize * PING_SPEED_FRAC;
    this.leviathanBaseSpeed = newArenaSize * LEVIATHAN_BASE_SPEED_FRAC;
    this.leviathanMaxSpeed = newArenaSize * LEVIATHAN_MAX_SPEED_FRAC;
    this.leviathanSpeedRampPerSec = newArenaSize * LEVIATHAN_SPEED_RAMP_PER_SEC_FRAC;
    this.leviathanPatrolSpeed = newArenaSize * LEVIATHAN_PATROL_SPEED_FRAC;
    this.leviathanSenseRadius = newArenaSize * LEVIATHAN_SENSE_RADIUS_FRAC;
    this.safeZoneRadius = newArenaSize * SAFE_ZONE_RADIUS_FRAC;

    if (scale !== 1) {
      this.sub.x *= scale;
      this.sub.y *= scale;
      this.sub.vx *= scale;
      this.sub.vy *= scale;
      for (const rock of this.rocks) {
        rock.x *= scale;
        rock.y *= scale;
        rock.r *= scale;
      }
      for (const pearl of this.pearls) {
        pearl.x *= scale;
        pearl.y *= scale;
      }
      for (const ping of this.pings) {
        ping.x *= scale;
        ping.y *= scale;
      }
      this.leviathan.x *= scale;
      this.leviathan.y *= scale;
      this.leviathan.targetX *= scale;
      this.leviathan.targetY *= scale;
    }
  }

  /** ステージ(canvas)座標の一点へ向かって推進する。ポインタ操作向け。 */
  setThrustTowardStagePoint(stageX: number, stageY: number): void {
    const localX = stageX - this.offsetX;
    const localY = stageY - this.offsetY;
    const dx = localX - this.sub.x;
    const dy = localY - this.sub.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) {
      this.thrust = { x: 0, y: 0 };
      return;
    }
    this.thrust = { x: dx / dist, y: dy / dist };
  }

  /** 方向ベクトル（正規化不要）で推進する。キーボード操作向け。 */
  setThrust(dx: number, dy: number): void {
    this.thrust = { x: dx, y: dy };
  }

  /** ソナーを発信できれば発信する。周囲を照らすが、レビヤタンをその場所へ引き寄せる。 */
  triggerPing(): boolean {
    if (this.isOver) return false;
    if (this.charges < 1) return false;
    if (this.pings.length >= MAX_ACTIVE_PINGS) return false;
    this.charges -= 1;
    this.pings.push({ x: this.sub.x, y: this.sub.y, age: 0 });
    this.leviathan.mode = "hunt";
    this.leviathan.targetX = this.sub.x;
    this.leviathan.targetY = this.sub.y;
    this.onPing?.();
    return true;
  }

  /** 指定座標がソナーの余韻または自機の常時微光の範囲内にあれば 0〜1 で可視度を返す。 */
  visibilityAt(x: number, y: number): number {
    let vis = 0;
    const ambientDist = Math.hypot(x - this.sub.x, y - this.sub.y);
    if (ambientDist < this.ambientRadius) {
      vis = Math.max(vis, 1 - ambientDist / this.ambientRadius);
    }
    for (const ping of this.pings) {
      const d = Math.hypot(x - ping.x, y - ping.y);
      const radius = ping.age * this.pingSpeed;
      if (d <= radius) {
        vis = Math.max(vis, Math.max(0, 1 - ping.age / PING_LIFETIME));
      }
    }
    return Math.min(1, vis);
  }

  private spawnPearlPosition(): Pearl {
    const avoid = this.rocks.map((r) => ({ x: r.x, y: r.y, r: r.r }));
    avoid.push({ x: this.sub.x, y: this.sub.y, r: this.safeZoneRadius * 0.6 });
    const spot = findOpenSpot(this.arenaSize, this.pearlRadius * 2, avoid);
    return { x: spot.x, y: spot.y };
  }

  private pickLeviathanPatrolTarget(): void {
    const margin = this.leviathanRadius * 1.5;
    this.leviathan.targetX = randRange(margin, this.arenaSize - margin);
    this.leviathan.targetY = randRange(margin, this.arenaSize - margin);
  }

  private updateSub(deltaSeconds: number): void {
    const thrustLen = Math.hypot(this.thrust.x, this.thrust.y);
    if (thrustLen > 0.001) {
      const ux = this.thrust.x / thrustLen;
      const uy = this.thrust.y / thrustLen;
      this.sub.vx += ux * this.thrustAccel * deltaSeconds;
      this.sub.vy += uy * this.thrustAccel * deltaSeconds;
      this.sub.angle = Math.atan2(uy, ux);
    }

    const dragFactor = Math.max(0, 1 - DRAG_PER_SECOND * deltaSeconds);
    this.sub.vx *= dragFactor;
    this.sub.vy *= dragFactor;

    const speed = Math.hypot(this.sub.vx, this.sub.vy);
    if (speed > this.maxSpeed && speed > 0) {
      const s = this.maxSpeed / speed;
      this.sub.vx *= s;
      this.sub.vy *= s;
    }

    let nx = this.sub.x + this.sub.vx * deltaSeconds;
    let ny = this.sub.y + this.sub.vy * deltaSeconds;

    if (nx < this.subRadius) {
      nx = this.subRadius;
      this.sub.vx = Math.max(0, this.sub.vx);
    } else if (nx > this.arenaSize - this.subRadius) {
      nx = this.arenaSize - this.subRadius;
      this.sub.vx = Math.min(0, this.sub.vx);
    }
    if (ny < this.subRadius) {
      ny = this.subRadius;
      this.sub.vy = Math.max(0, this.sub.vy);
    } else if (ny > this.arenaSize - this.subRadius) {
      ny = this.arenaSize - this.subRadius;
      this.sub.vy = Math.min(0, this.sub.vy);
    }

    for (const rock of this.rocks) {
      const dx = nx - rock.x;
      const dy = ny - rock.y;
      const dist = Math.hypot(dx, dy);
      const minDist = this.subRadius + rock.r;
      if (dist > 0.0001 && dist < minDist) {
        const ux = dx / dist;
        const uy = dy / dist;
        nx += ux * (minDist - dist);
        ny += uy * (minDist - dist);
        const vn = this.sub.vx * ux + this.sub.vy * uy;
        if (vn < 0) {
          this.sub.vx -= vn * ux;
          this.sub.vy -= vn * uy;
        }
      }
    }

    this.sub.x = nx;
    this.sub.y = ny;
  }

  private updatePearls(): void {
    for (const pearl of this.pearls) {
      const dist = Math.hypot(pearl.x - this.sub.x, pearl.y - this.sub.y);
      if (dist < this.subRadius + this.pearlRadius) {
        this.pearlsCollected++;
        this.score += PEARL_SCORE;
        this.onPearlCollected?.({ x: pearl.x, y: pearl.y, points: PEARL_SCORE });
        const next = this.spawnPearlPosition();
        pearl.x = next.x;
        pearl.y = next.y;
      }
    }
  }

  private updateLeviathan(deltaSeconds: number): void {
    const lev = this.leviathan;
    const rampedSpeed = Math.min(
      this.leviathanMaxSpeed,
      this.leviathanBaseSpeed + this.elapsed * this.leviathanSpeedRampPerSec,
    );

    const distToSub = Math.hypot(lev.x - this.sub.x, lev.y - this.sub.y);
    if (distToSub < this.leviathanSenseRadius) {
      lev.mode = "hunt";
      lev.targetX = this.sub.x;
      lev.targetY = this.sub.y;
    }

    const speed = lev.mode === "hunt" ? rampedSpeed : this.leviathanPatrolSpeed;
    const dx = lev.targetX - lev.x;
    const dy = lev.targetY - lev.y;
    const dist = Math.hypot(dx, dy);
    if (dist < this.leviathanRadius * 0.5) {
      if (lev.mode === "hunt") {
        lev.mode = "patrol";
      }
      this.pickLeviathanPatrolTarget();
    } else {
      const ux = dx / dist;
      const uy = dy / dist;
      lev.x += ux * speed * deltaSeconds;
      lev.y += uy * speed * deltaSeconds;
      lev.angle = Math.atan2(uy, ux);
    }

    lev.x = Math.min(this.arenaSize - this.leviathanRadius, Math.max(this.leviathanRadius, lev.x));
    lev.y = Math.min(this.arenaSize - this.leviathanRadius, Math.max(this.leviathanRadius, lev.y));

    if (distToSub < this.subRadius + this.leviathanRadius) {
      this.isOver = true;
      this.onCaught?.();
    }
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;
    this.elapsed += deltaSeconds;
    this.score += deltaSeconds * SURVIVAL_SCORE_PER_SECOND;

    this.chargeTimer += deltaSeconds;
    while (this.chargeTimer >= CHARGE_REGEN_SECONDS && this.charges < MAX_CHARGES) {
      this.chargeTimer -= CHARGE_REGEN_SECONDS;
      this.charges++;
    }
    if (this.charges >= MAX_CHARGES) this.chargeTimer = 0;

    for (let i = this.pings.length - 1; i >= 0; i--) {
      const ping = this.pings[i];
      ping.age += deltaSeconds;
      if (ping.age >= PING_LIFETIME) this.pings.splice(i, 1);
    }

    this.updateSub(deltaSeconds);
    this.updatePearls();
    this.updateLeviathan(deltaSeconds);
  }
}
