export const SPOKE_COUNT = 6;
export const INTEGRITY_MAX = 100;
/** 捕獲圏(中心からの半径比)。この帯の中にいる間にpluckすると捕獲できる。 */
export const CATCH_BAND_MIN = 0.25;
export const CATCH_BAND_MAX = 0.55;
export const MAX_BUGS = 5;
export const REPAIR_DURATION_SECONDS = 1.2;

export interface WebBug {
  readonly id: number;
  readonly spokeIndex: number;
  /** 1: 外周(出現) 〜 0: 中心(巣主に到達=食い破られる)。 */
  radius: number;
}

export type PluckResult = "caught" | "frayed" | "miss";

export interface CatchEvent {
  spokeIndex: number;
  points: number;
  comboAfter: number;
}

export interface BreachEvent {
  spokeIndex: number;
}

export interface RepairEvent {
  spokeIndex: number;
}

const INITIAL_BUG_SPEED = 0.16;
const MAX_BUG_SPEED = 0.42;
const BUG_SPEED_GROWTH_PER_CATCH = 0.014;

const INITIAL_SPAWN_INTERVAL = 1.4;
const MIN_SPAWN_INTERVAL = 0.5;
const SPAWN_INTERVAL_DECAY_PER_CATCH = 0.045;

const BREACH_DAMAGE = 14;
const SCORE_PER_CATCH = 100;
const COMBO_BONUS_PER_STREAK = 12;

/**
 * 糸(スポーク)を伝って中心へ迫る虫を、捕獲圏のタイミングでpluckして捕らえる
 * リアルタイム反射神経パズルの純粋ロジック層。React / pixi.js には依存しない。
 */
export class OrbWeaverWorld {
  private _bugs: WebBug[] = [];
  private _frayed: boolean[] = [];
  private _repairProgress: number[] = [];
  private readonly repairingSpokes = new Set<number>();
  private spawnTimer = 0;
  private successCount = 0;
  private nextId = 0;

  score = 0;
  combo = 0;
  integrity = INTEGRITY_MAX;
  isOver = false;

  onCatch: ((event: CatchEvent) => void) | null = null;
  onBreach: ((event: BreachEvent) => void) | null = null;
  onRepair: ((event: RepairEvent) => void) | null = null;

  constructor() {
    this.reset();
  }

  get bugs(): readonly WebBug[] {
    return this._bugs;
  }

  get frayedSpokes(): readonly boolean[] {
    return this._frayed;
  }

  get bugSpeed(): number {
    return Math.min(
      MAX_BUG_SPEED,
      INITIAL_BUG_SPEED + this.successCount * BUG_SPEED_GROWTH_PER_CATCH,
    );
  }

  get spawnInterval(): number {
    return Math.max(
      MIN_SPAWN_INTERVAL,
      INITIAL_SPAWN_INTERVAL - this.successCount * SPAWN_INTERVAL_DECAY_PER_CATCH,
    );
  }

  repairProgressAt(spokeIndex: number): number {
    return this._repairProgress[spokeIndex] ?? 0;
  }

  reset(): void {
    this._bugs = [];
    this._frayed = Array.from({ length: SPOKE_COUNT }, () => false);
    this._repairProgress = Array.from({ length: SPOKE_COUNT }, () => 0);
    this.repairingSpokes.clear();
    this.spawnTimer = 0;
    this.successCount = 0;
    this.nextId = 0;
    this.score = 0;
    this.combo = 0;
    this.integrity = INTEGRITY_MAX;
    this.isOver = false;
  }

  /** 糸を補修中かどうかを設定する(ポインタ/キーを押している間だけtrueにする想定)。 */
  setRepairing(spokeIndex: number, isRepairing: boolean): void {
    if (isRepairing) {
      this.repairingSpokes.add(spokeIndex);
    } else {
      this.repairingSpokes.delete(spokeIndex);
    }
  }

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    for (const spokeIndex of this.repairingSpokes) {
      if (!this._frayed[spokeIndex]) continue;
      const progress = this.repairProgressAt(spokeIndex) + deltaSeconds / REPAIR_DURATION_SECONDS;
      if (progress >= 1) {
        this._frayed[spokeIndex] = false;
        this._repairProgress[spokeIndex] = 0;
        this.repairingSpokes.delete(spokeIndex);
        this.onRepair?.({ spokeIndex });
      } else {
        this._repairProgress[spokeIndex] = progress;
      }
    }

    const speed = this.bugSpeed;
    for (let i = this._bugs.length - 1; i >= 0; i--) {
      const bug = this._bugs[i];
      bug.radius -= speed * deltaSeconds;
      if (bug.radius <= 0) {
        this._bugs.splice(i, 1);
        this._frayed[bug.spokeIndex] = true;
        this._repairProgress[bug.spokeIndex] = 0;
        this.combo = 0;
        this.integrity = Math.max(0, this.integrity - BREACH_DAMAGE);
        this.onBreach?.({ spokeIndex: bug.spokeIndex });
        if (this.integrity <= 0) {
          this.isOver = true;
          return;
        }
      }
    }
    if (this.isOver) return;

    this.spawnTimer -= deltaSeconds;
    if (this.spawnTimer <= 0) {
      this.trySpawn();
      this.spawnTimer = this.spawnInterval;
    }
  }

  /** 指定した糸をはじく。糸が破れていれば補修が先に必要(捕獲不可)。 */
  pluck(spokeIndex: number): PluckResult {
    if (this.isOver) return "miss";
    if (this._frayed[spokeIndex]) return "frayed";

    let target: WebBug | null = null;
    for (const bug of this._bugs) {
      if (bug.spokeIndex !== spokeIndex) continue;
      if (bug.radius < CATCH_BAND_MIN || bug.radius > CATCH_BAND_MAX) continue;
      if (!target || bug.radius < target.radius) target = bug;
    }
    if (!target) return "miss";

    const targetId = target.id;
    this._bugs = this._bugs.filter((bug) => bug.id !== targetId);
    this.combo += 1;
    this.successCount += 1;
    const points = SCORE_PER_CATCH + this.combo * COMBO_BONUS_PER_STREAK;
    this.score += points;
    this.onCatch?.({ spokeIndex, points, comboAfter: this.combo });
    return "caught";
  }

  private trySpawn(): void {
    if (this._bugs.length >= MAX_BUGS) return;
    const spokeIndex = Math.floor(Math.random() * SPOKE_COUNT);
    this._bugs.push({ id: this.nextId++, spokeIndex, radius: 1 });
  }
}
