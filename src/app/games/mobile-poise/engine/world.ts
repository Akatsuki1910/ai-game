const MIN_HOOKS = 3;
const MAX_HOOKS = 6;
const OFFSET_POOL = [-4, -3, -2, -1, 1, 2, 3, 4];
const MASS_MIN = 1;
const MASS_MAX = 6;
const MAX_OFFSET_MAGNITUDE = 4;

const ROD_Y_RATIO = 0.3;
const ROD_HALF_WIDTH_RATIO = 0.36;
const ROD_EXTRA_MARGIN_UNITS = 0.6;
const HANG_DROP_RATIO = 0.16;
const TRAY_Y_RATIO = 0.78;
const TRAY_WIDTH_RATIO = 0.7;
const TRAY_START_RATIO = 0.15;

const HOOK_HIT_RADIUS = 26;
const CHARM_MIN_RADIUS = 14;
const CHARM_MAX_RADIUS = 30;

const MAX_TILT_RAD = 0.6;
const ANGLE_SCALE = 0.015;
const SMOOTH_RATE = 6;
const BREEZE_FREQUENCY = 0.5;

let nextId = 1;

export interface Hook {
  readonly id: number;
  readonly offsetUnits: number;
}

export interface Charm {
  readonly id: number;
  readonly mass: number;
  hookId: number | null;
}

export interface Point {
  x: number;
  y: number;
}

export interface RoundClearedEvent {
  level: number;
  points: number;
}

function randInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function shuffle<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function hookCountForLevel(level: number): number {
  return Math.min(MIN_HOOKS + (level - 1), MAX_HOOKS);
}

export function toleranceForLevel(level: number): number {
  return Math.max(0.5, 1.4 - 0.1 * (level - 1));
}

export function holdRequiredSecondsForLevel(level: number): number {
  return Math.min(1.0 + 0.1 * (level - 1), 2.0);
}

export function breezeAmplitudeForLevel(level: number): number {
  return Math.min(0.05 + 0.15 * (level - 1), 0.9);
}

export function roundTimeSecondsForLevel(level: number): number {
  return Math.max(22, 42 - 2 * (level - 1));
}

/**
 * モビール(吊るし飾り)のおもりを配置して棒を水平に保つリアルタイム・バランスパズル。
 * 棒は中心のピボットで吊られていて、掛けたおもりのトルク合計で傾く。
 * 目標トルクはラウンド生成時に「必ず解ける組み合わせ」として裏で1つ決めておき、
 * プレイヤーはどのおもりをどのフックに掛けるかでそれを(別解も含め)再現する。
 */
export class MobilePoiseWorld {
  width = 0;
  height = 0;
  level = 1;
  score = 0;
  isOver = false;

  hooks: Hook[] = [];
  charms: Charm[] = [];
  targetTorque = 0;
  toleranceBand = 0;
  holdRequiredSeconds = 0;
  breezeAmplitude = 0;
  roundTimeRemaining = 0;

  holdTimer = 0;
  tiltAngle = 0;
  totalTorque = 0;

  private elapsed = 0;

  onRoundCleared: ((event: RoundClearedEvent) => void) | null = null;

  constructor(width: number, height: number) {
    this.resize(width, height);
    this.reset();
  }

  reset(): void {
    this.level = 1;
    this.score = 0;
    this.isOver = false;
    this.tiltAngle = 0;
    this.elapsed = 0;
    this.generateRound(this.level);
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.width = width;
    this.height = height;
  }

  assignCharmToHook(charmId: number, hookId: number): void {
    const charm = this.charms.find((c) => c.id === charmId);
    const hook = this.hooks.find((h) => h.id === hookId);
    if (!charm || !hook) return;
    const occupant = this.charms.find((c) => c.hookId === hookId && c.id !== charmId);
    const previousHookId = charm.hookId;
    charm.hookId = hookId;
    if (occupant) occupant.hookId = previousHookId;
  }

  unassignCharm(charmId: number): void {
    const charm = this.charms.find((c) => c.id === charmId);
    if (!charm) return;
    charm.hookId = null;
  }

  getUnassignedCharms(): Charm[] {
    return this.charms.filter((c) => c.hookId === null);
  }

  pivotPoint(): Point {
    return { x: this.width / 2, y: this.height * ROD_Y_RATIO };
  }

  rodSpacingPx(): number {
    return (this.width * ROD_HALF_WIDTH_RATIO) / MAX_OFFSET_MAGNITUDE;
  }

  rodEndpoints(): [Point, Point] {
    const extent = (MAX_OFFSET_MAGNITUDE + ROD_EXTRA_MARGIN_UNITS) * this.rodSpacingPx();
    return [
      this.rotateAroundPivot({ x: -extent, y: 0 }),
      this.rotateAroundPivot({ x: extent, y: 0 }),
    ];
  }

  hookPosition(hook: Hook): Point {
    return this.rotateAroundPivot({ x: hook.offsetUnits * this.rodSpacingPx(), y: 0 });
  }

  charmPosition(charm: Charm): Point {
    if (charm.hookId !== null) {
      const hook = this.hooks.find((h) => h.id === charm.hookId);
      if (hook) {
        return this.rotateAroundPivot({
          x: hook.offsetUnits * this.rodSpacingPx(),
          y: this.height * HANG_DROP_RATIO,
        });
      }
    }
    const unassigned = this.getUnassignedCharms();
    const index = unassigned.findIndex((c) => c.id === charm.id);
    const count = unassigned.length;
    const trayWidth = this.width * TRAY_WIDTH_RATIO;
    const startX = this.width * TRAY_START_RATIO;
    const x = count <= 1 ? this.width / 2 : startX + (trayWidth * index) / (count - 1);
    return { x, y: this.height * TRAY_Y_RATIO };
  }

  charmRadius(charm: Charm): number {
    const t = (charm.mass - MASS_MIN) / (MASS_MAX - MASS_MIN);
    return CHARM_MIN_RADIUS + t * (CHARM_MAX_RADIUS - CHARM_MIN_RADIUS);
  }

  findHookAt(x: number, y: number): Hook | undefined {
    return this.hooks.find((hook) => {
      const p = this.hookPosition(hook);
      return Math.hypot(p.x - x, p.y - y) <= HOOK_HIT_RADIUS;
    });
  }

  findCharmAt(x: number, y: number): Charm | undefined {
    return this.charms.find((charm) => {
      const p = this.charmPosition(charm);
      return Math.hypot(p.x - x, p.y - y) <= this.charmRadius(charm) + 8;
    });
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    this.elapsed += deltaSeconds;
    this.roundTimeRemaining = Math.max(0, this.roundTimeRemaining - deltaSeconds);

    const rawTorque = this.charms.reduce((sum, charm) => {
      if (charm.hookId === null) return sum;
      const hook = this.hooks.find((h) => h.id === charm.hookId);
      return hook ? sum + charm.mass * hook.offsetUnits : sum;
    }, 0);

    const deviation = rawTorque - this.targetTorque;
    const breeze = Math.sin(this.elapsed * BREEZE_FREQUENCY) * this.breezeAmplitude;
    this.totalTorque = deviation + breeze;

    const targetAngle = Math.min(
      MAX_TILT_RAD,
      Math.max(-MAX_TILT_RAD, this.totalTorque * ANGLE_SCALE),
    );
    const smoothing = Math.min(1, SMOOTH_RATE * deltaSeconds);
    this.tiltAngle += (targetAngle - this.tiltAngle) * smoothing;

    const allFilled = this.charms.every((charm) => charm.hookId !== null);
    const withinBand = Math.abs(this.totalTorque) <= this.toleranceBand;

    if (allFilled && withinBand) {
      this.holdTimer += deltaSeconds;
    } else {
      this.holdTimer = 0;
    }

    if (this.holdTimer >= this.holdRequiredSeconds) {
      const points = 100 + this.hooks.length * 20 + Math.floor(this.roundTimeRemaining) * 2;
      this.score += points;
      this.onRoundCleared?.({ level: this.level, points });
      this.level += 1;
      this.generateRound(this.level);
      return;
    }

    if (this.roundTimeRemaining <= 0) {
      this.isOver = true;
    }
  }

  private generateRound(level: number): void {
    const hookCount = hookCountForLevel(level);
    const offsets = shuffle(OFFSET_POOL)
      .slice(0, hookCount)
      .sort((a, b) => a - b);
    this.hooks = offsets.map((offsetUnits) => ({ id: nextId++, offsetUnits }));

    this.charms = Array.from({ length: hookCount }, () => ({
      id: nextId++,
      mass: randInt(MASS_MIN, MASS_MAX),
      hookId: null,
    }));

    const secretHookOrder = shuffle(this.hooks);
    this.targetTorque = this.charms.reduce(
      (sum, charm, index) => sum + charm.mass * secretHookOrder[index].offsetUnits,
      0,
    );

    this.toleranceBand = toleranceForLevel(level);
    this.holdRequiredSeconds = holdRequiredSecondsForLevel(level);
    this.breezeAmplitude = breezeAmplitudeForLevel(level);
    this.roundTimeRemaining = roundTimeSecondsForLevel(level);
    this.holdTimer = 0;
  }

  private rotateAroundPivot(local: Point): Point {
    const pivot = this.pivotPoint();
    const cos = Math.cos(this.tiltAngle);
    const sin = Math.sin(this.tiltAngle);
    return {
      x: pivot.x + local.x * cos - local.y * sin,
      y: pivot.y + local.x * sin + local.y * cos,
    };
  }
}
