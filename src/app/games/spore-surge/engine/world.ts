export interface Player {
  x: number;
  y: number;
  radius: number;
  hp: number;
  maxHp: number;
  speed: number;
  attackDamage: number;
  attackCooldown: number;
  projectileCount: number;
  magnetSpeed: number;
  pickupRadius: number;
}

export interface Enemy {
  id: number;
  x: number;
  y: number;
  radius: number;
  hp: number;
  maxHp: number;
  speed: number;
  damage: number;
}

export interface Projectile {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
}

export interface Pollen {
  id: number;
  x: number;
  y: number;
  radius: number;
  value: number;
}

export type UpgradeId =
  | "attack-speed"
  | "damage"
  | "move-speed"
  | "max-hp"
  | "magnet"
  | "multi-shot";

export interface UpgradeOption {
  id: UpgradeId;
  label: string;
  description: string;
}

export interface EnemyKilledEvent {
  enemy: Enemy;
}

export interface LevelUpEvent {
  level: number;
  options: readonly UpgradeOption[];
}

const UPGRADE_POOL: readonly UpgradeOption[] = [
  { id: "attack-speed", label: "連射速度UP", description: "胞子弾の発射間隔が短くなる" },
  { id: "damage", label: "威力UP", description: "胞子弾1発のダメージが増える" },
  { id: "move-speed", label: "移動速度UP", description: "自分の移動速度が上がる" },
  { id: "max-hp", label: "最大HP UP", description: "最大HPが増え、その場で少し回復する" },
  { id: "magnet", label: "花粉マグネットUP", description: "花粉を引き寄せる速さが上がる" },
  { id: "multi-shot", label: "マルチショット", description: "一度に発射する胞子弾が1本増える" },
] as const;

const PLAYER_RADIUS = 16;
const PLAYER_BASE_SPEED = 220;
const PLAYER_MAX_HP = 100;

const ENEMY_RADIUS = 14;
const ENEMY_BASE_SPEED = 60;
const ENEMY_MAX_SPEED = 160;
const ENEMY_BASE_HP = 18;
const ENEMY_CONTACT_DPS = 18;
const ENEMY_HP_PER_LEVEL = 3;
const ENEMY_SPEED_PER_LEVEL = 3;

const SPAWN_INTERVAL_START = 1.6;
const SPAWN_INTERVAL_MIN = 0.45;
const SPAWN_RAMP_PER_SECOND = 0.01;

const PROJECTILE_SPEED = 360;
const PROJECTILE_RADIUS = 5;
const BASE_ATTACK_DAMAGE = 9;
const BASE_ATTACK_COOLDOWN = 0.55;
const ATTACK_SPREAD_RADIANS = (12 * Math.PI) / 180;

const POLLEN_RADIUS = 6;
const POLLEN_VALUE = 10;
const POLLEN_MAGNET_SPEED_BASE = 260;

const XP_TO_NEXT_BASE = 25;
const XP_GROWTH = 1.35;

const SCORE_PER_SECOND = 5;
const SCORE_PER_KILL = 25;

let nextId = 1;

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export class SporeSurgeWorld {
  width = 0;
  height = 0;

  player: Player = SporeSurgeWorld.createPlayer(0, 0);
  enemies: Enemy[] = [];
  projectiles: Projectile[] = [];
  pollens: Pollen[] = [];

  score = 0;
  kills = 0;
  elapsed = 0;
  level = 1;
  xp = 0;
  xpToNext = XP_TO_NEXT_BASE;

  isOver = false;
  isChoosingUpgrade = false;
  upgradeOptions: readonly UpgradeOption[] = [];

  onEnemyKilled: ((event: EnemyKilledEvent) => void) | null = null;
  onLevelUp: ((event: LevelUpEvent) => void) | null = null;

  private pointerTarget: { x: number; y: number } | null = null;
  private keyboardDirection = { x: 0, y: 0 };
  private spawnTimer = SPAWN_INTERVAL_START;
  private attackTimer = 0;

  constructor(width: number, height: number) {
    this.resize(width, height);
    this.reset();
  }

  private static createPlayer(x: number, y: number): Player {
    return {
      x,
      y,
      radius: PLAYER_RADIUS,
      hp: PLAYER_MAX_HP,
      maxHp: PLAYER_MAX_HP,
      speed: PLAYER_BASE_SPEED,
      attackDamage: BASE_ATTACK_DAMAGE,
      attackCooldown: BASE_ATTACK_COOLDOWN,
      projectileCount: 1,
      magnetSpeed: POLLEN_MAGNET_SPEED_BASE,
      pickupRadius: PLAYER_RADIUS + POLLEN_RADIUS,
    };
  }

  reset(): void {
    this.player = SporeSurgeWorld.createPlayer(this.width / 2, this.height / 2);
    this.enemies = [];
    this.projectiles = [];
    this.pollens = [];

    this.score = 0;
    this.kills = 0;
    this.elapsed = 0;
    this.level = 1;
    this.xp = 0;
    this.xpToNext = XP_TO_NEXT_BASE;

    this.isOver = false;
    this.isChoosingUpgrade = false;
    this.upgradeOptions = [];

    this.pointerTarget = null;
    this.keyboardDirection = { x: 0, y: 0 };
    this.spawnTimer = SPAWN_INTERVAL_START;
    this.attackTimer = 0;
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const scaleX = this.width > 0 ? width / this.width : 1;
    const scaleY = this.height > 0 ? height / this.height : 1;
    if (this.width > 0 && this.height > 0) {
      this.player.x *= scaleX;
      this.player.y *= scaleY;
      for (const enemy of this.enemies) {
        enemy.x *= scaleX;
        enemy.y *= scaleY;
      }
      for (const projectile of this.projectiles) {
        projectile.x *= scaleX;
        projectile.y *= scaleY;
      }
      for (const pollen of this.pollens) {
        pollen.x *= scaleX;
        pollen.y *= scaleY;
      }
    }
    this.width = width;
    this.height = height;
    this.clampPlayerPosition();
  }

  setMoveTarget(x: number, y: number): void {
    this.pointerTarget = { x, y };
  }

  clearMoveTarget(): void {
    this.pointerTarget = null;
  }

  setKeyboardDirection(x: number, y: number): void {
    this.keyboardDirection = { x, y };
  }

  chooseUpgrade(id: UpgradeId): void {
    if (!this.isChoosingUpgrade) return;
    this.applyUpgrade(id);
    this.isChoosingUpgrade = false;
    this.upgradeOptions = [];
    this.checkLevelUp();
  }

  step(deltaSeconds: number): void {
    if (this.isOver || this.isChoosingUpgrade) return;

    this.elapsed += deltaSeconds;
    this.updatePlayerMovement(deltaSeconds);
    this.updateSpawning(deltaSeconds);
    this.updateEnemies(deltaSeconds);
    this.updateProjectiles(deltaSeconds);
    this.updateAttack(deltaSeconds);
    this.updatePollens(deltaSeconds);

    this.score = this.kills * SCORE_PER_KILL + Math.floor(this.elapsed * SCORE_PER_SECOND);

    if (this.player.hp <= 0) {
      this.player.hp = 0;
      this.isOver = true;
    }
  }

  private updatePlayerMovement(deltaSeconds: number): void {
    const useKeyboard = this.keyboardDirection.x !== 0 || this.keyboardDirection.y !== 0;
    let dx: number;
    let dy: number;
    if (useKeyboard) {
      dx = this.keyboardDirection.x;
      dy = this.keyboardDirection.y;
    } else if (this.pointerTarget) {
      dx = this.pointerTarget.x - this.player.x;
      dy = this.pointerTarget.y - this.player.y;
    } else {
      return;
    }

    const len = Math.hypot(dx, dy);
    if (len < 1e-3) return;

    const nx = dx / len;
    const ny = dy / len;
    const maxStep = this.player.speed * deltaSeconds;
    const step = useKeyboard ? maxStep : Math.min(maxStep, len);
    this.player.x += nx * step;
    this.player.y += ny * step;
    this.clampPlayerPosition();
  }

  private clampPlayerPosition(): void {
    const r = this.player.radius;
    this.player.x = Math.min(Math.max(this.player.x, r), Math.max(r, this.width - r));
    this.player.y = Math.min(Math.max(this.player.y, r), Math.max(r, this.height - r));
  }

  private currentSpawnInterval(): number {
    return Math.max(
      SPAWN_INTERVAL_MIN,
      SPAWN_INTERVAL_START - this.elapsed * SPAWN_RAMP_PER_SECOND,
    );
  }

  private updateSpawning(deltaSeconds: number): void {
    this.spawnTimer -= deltaSeconds;
    if (this.spawnTimer > 0) return;
    this.spawnTimer = this.currentSpawnInterval();
    this.enemies.push(this.createEnemy());
  }

  private createEnemy(): Enemy {
    const edge = Math.floor(randRange(0, 4));
    const margin = ENEMY_RADIUS * 2;
    let x: number;
    let y: number;
    switch (edge) {
      case 0:
        x = randRange(0, this.width);
        y = -margin;
        break;
      case 1:
        x = this.width + margin;
        y = randRange(0, this.height);
        break;
      case 2:
        x = randRange(0, this.width);
        y = this.height + margin;
        break;
      default:
        x = -margin;
        y = randRange(0, this.height);
        break;
    }

    const levelBonus = this.level - 1;
    const hp = ENEMY_BASE_HP + levelBonus * ENEMY_HP_PER_LEVEL;
    return {
      id: nextId++,
      x,
      y,
      radius: ENEMY_RADIUS,
      hp,
      maxHp: hp,
      speed: Math.min(ENEMY_MAX_SPEED, ENEMY_BASE_SPEED + levelBonus * ENEMY_SPEED_PER_LEVEL),
      damage: ENEMY_CONTACT_DPS,
    };
  }

  private updateEnemies(deltaSeconds: number): void {
    for (const enemy of this.enemies) {
      const dx = this.player.x - enemy.x;
      const dy = this.player.y - enemy.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 1e-3) {
        enemy.x += (dx / dist) * enemy.speed * deltaSeconds;
        enemy.y += (dy / dist) * enemy.speed * deltaSeconds;
      }

      if (dist <= enemy.radius + this.player.radius) {
        this.player.hp -= enemy.damage * deltaSeconds;
      }
    }
  }

  private nearestEnemy(): Enemy | null {
    let nearest: Enemy | null = null;
    let nearestDist = Number.POSITIVE_INFINITY;
    for (const enemy of this.enemies) {
      const dist = Math.hypot(enemy.x - this.player.x, enemy.y - this.player.y);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = enemy;
      }
    }
    return nearest;
  }

  private updateAttack(deltaSeconds: number): void {
    this.attackTimer -= deltaSeconds;
    if (this.attackTimer > 0) return;
    if (this.enemies.length === 0) {
      this.attackTimer = 0;
      return;
    }
    this.fireAtNearestEnemy();
    this.attackTimer = this.player.attackCooldown;
  }

  private updateProjectiles(deltaSeconds: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const projectile = this.projectiles[i];
      projectile.x += projectile.vx * deltaSeconds;
      projectile.y += projectile.vy * deltaSeconds;

      let hitIndex = -1;
      for (let j = 0; j < this.enemies.length; j++) {
        const enemy = this.enemies[j];
        if (
          Math.hypot(enemy.x - projectile.x, enemy.y - projectile.y) <=
          enemy.radius + projectile.radius
        ) {
          hitIndex = j;
          break;
        }
      }

      if (hitIndex !== -1) {
        const enemy = this.enemies[hitIndex];
        enemy.hp -= projectile.damage;
        this.projectiles.splice(i, 1);
        if (enemy.hp <= 0) {
          this.killEnemy(hitIndex);
        }
        continue;
      }

      const margin = projectile.radius * 4;
      if (
        projectile.x < -margin ||
        projectile.x > this.width + margin ||
        projectile.y < -margin ||
        projectile.y > this.height + margin
      ) {
        this.projectiles.splice(i, 1);
      }
    }
  }

  private killEnemy(index: number): void {
    const [enemy] = this.enemies.splice(index, 1);
    this.kills += 1;
    this.pollens.push({
      id: nextId++,
      x: enemy.x,
      y: enemy.y,
      radius: POLLEN_RADIUS,
      value: POLLEN_VALUE,
    });
    this.onEnemyKilled?.({ enemy });
  }

  private fireAtNearestEnemy(): void {
    const target = this.nearestEnemy();
    if (!target) return;

    const baseAngle = Math.atan2(target.y - this.player.y, target.x - this.player.x);
    const shots = this.player.projectileCount;
    const startAngle = baseAngle - (ATTACK_SPREAD_RADIANS * (shots - 1)) / 2;

    for (let i = 0; i < shots; i++) {
      const angle = startAngle + ATTACK_SPREAD_RADIANS * i;
      this.projectiles.push({
        id: nextId++,
        x: this.player.x,
        y: this.player.y,
        vx: Math.cos(angle) * PROJECTILE_SPEED,
        vy: Math.sin(angle) * PROJECTILE_SPEED,
        radius: PROJECTILE_RADIUS,
        damage: this.player.attackDamage,
      });
    }
  }

  private updatePollens(deltaSeconds: number): void {
    for (let i = this.pollens.length - 1; i >= 0; i--) {
      const pollen = this.pollens[i];
      const dx = this.player.x - pollen.x;
      const dy = this.player.y - pollen.y;
      const dist = Math.hypot(dx, dy);

      if (dist <= this.player.pickupRadius + pollen.radius) {
        this.xp += pollen.value;
        this.pollens.splice(i, 1);
        this.checkLevelUp();
        continue;
      }

      if (dist > 1e-3) {
        const step = Math.min(dist, this.player.magnetSpeed * deltaSeconds);
        pollen.x += (dx / dist) * step;
        pollen.y += (dy / dist) * step;
      }
    }
  }

  private checkLevelUp(): void {
    if (this.xp < this.xpToNext) return;

    this.xp -= this.xpToNext;
    this.xpToNext = Math.round(this.xpToNext * XP_GROWTH);
    this.level += 1;
    this.isChoosingUpgrade = true;
    this.upgradeOptions = this.rollUpgradeOptions();
    this.onLevelUp?.({ level: this.level, options: this.upgradeOptions });
  }

  private rollUpgradeOptions(): readonly UpgradeOption[] {
    const pool = [...UPGRADE_POOL];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, 3);
  }

  private applyUpgrade(id: UpgradeId): void {
    switch (id) {
      case "attack-speed":
        this.player.attackCooldown = Math.max(0.12, this.player.attackCooldown * 0.82);
        break;
      case "damage":
        this.player.attackDamage += 4;
        break;
      case "move-speed":
        this.player.speed += 24;
        break;
      case "max-hp":
        this.player.maxHp += 20;
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + 20);
        break;
      case "magnet":
        this.player.magnetSpeed += 90;
        break;
      case "multi-shot":
        this.player.projectileCount += 1;
        break;
    }
  }
}
