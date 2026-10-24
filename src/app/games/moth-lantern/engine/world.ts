export interface Moth {
  id: number;
  x: number;
  y: number;
  angle: number;
  isLit: boolean;
  /** 一度光に当たると true になり、以後は光が離れても祠へ進み続ける（鬼火にも捕まらない）。 */
  isGuided: boolean;
  timeInDark: number;
}

export interface Wisp {
  id: number;
  x: number;
  y: number;
  angle: number;
}

export interface MothDeliveredEvent {
  moth: Moth;
}

export interface MothLostEvent {
  moth: Moth;
  cause: "stray" | "wisp";
}

export const LIVES_MAX = 8;

const LANTERN_LIGHT_RADIUS = 150;
const LANTERN_MARKER_RADIUS = 14;
const LANTERN_SPEED = 380;

const MOTH_RADIUS = 7;
const MOTH_WANDER_SPEED = 46;
const MOTH_GUIDED_SPEED = 220;
const MOTH_WANDER_TURN_RATE = 2.4;
const MOTH_LOST_SECONDS = 14;

const MOTH_SPAWN_INTERVAL_START = 2.4;
const MOTH_SPAWN_INTERVAL_MIN = 0.8;
const MOTH_SPAWN_RAMP_PER_SECOND = 0.01;

const SHRINE_RADIUS = 46;

const WISP_RADIUS = 11;
const WISP_HUNT_SPEED = 95;
const WISP_WANDER_SPEED = 55;
const WISP_WANDER_TURN_RATE = 1.6;
const INITIAL_WISP_COUNT = 0;
const MAX_WISP_COUNT = 4;
const WISP_ADD_INTERVAL_SECONDS = 18;

const SCORE_PER_DELIVERY = 25;
const SCORE_PER_SECOND = 4;

let nextId = 1;

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomEdgePoint(width: number, height: number, margin: number): { x: number; y: number } {
  const edge = Math.floor(randRange(0, 4));
  switch (edge) {
    case 0:
      return { x: randRange(0, width), y: -margin };
    case 1:
      return { x: width + margin, y: randRange(0, height) };
    case 2:
      return { x: randRange(0, width), y: height + margin };
    default:
      return { x: -margin, y: randRange(0, height) };
  }
}

/**
 * 夜の庭園を舞台に、ランタンの光で蛾の群れを中央の祠へ導くワールド。
 * 一度でも光に当たった蛾は「導かれた」状態になり、以後は光が離れても祠へ
 * 進み続け鬼火にも襲われない。まだ当たっていない蛾は闇を徘徊し、一定時間で
 * 迷うか、鬼火(wisp)に捕まるとすぐに失われる。
 */
export class MothLanternWorld {
  width = 0;
  height = 0;

  lantern = { x: 0, y: 0 };
  moths: Moth[] = [];
  wisps: Wisp[] = [];

  delivered = 0;
  lostCount = 0;
  lives = LIVES_MAX;
  elapsed = 0;
  score = 0;
  isOver = false;

  onMothDelivered: ((event: MothDeliveredEvent) => void) | null = null;
  onMothLost: ((event: MothLostEvent) => void) | null = null;

  private pointerTarget: { x: number; y: number } | null = null;
  private keyboardDirection = { x: 0, y: 0 };
  private mothSpawnTimer = MOTH_SPAWN_INTERVAL_START;
  private wispAddTimer = WISP_ADD_INTERVAL_SECONDS;

  constructor(width: number, height: number) {
    this.resize(width, height);
    this.reset();
  }

  get shrineX(): number {
    return this.width / 2;
  }

  get shrineY(): number {
    return this.height / 2;
  }

  get shrineRadius(): number {
    return SHRINE_RADIUS;
  }

  get lanternLightRadius(): number {
    return LANTERN_LIGHT_RADIUS;
  }

  get lanternMarkerRadius(): number {
    return LANTERN_MARKER_RADIUS;
  }

  get mothRadius(): number {
    return MOTH_RADIUS;
  }

  get wispRadius(): number {
    return WISP_RADIUS;
  }

  reset(): void {
    this.lantern = { x: this.width / 2, y: this.height * 0.75 };
    this.moths = [];
    this.wisps = [];
    for (let i = 0; i < INITIAL_WISP_COUNT; i++) {
      const spot = randomEdgePoint(this.width, this.height, WISP_RADIUS * 2);
      this.wisps.push({ id: nextId++, x: spot.x, y: spot.y, angle: randRange(0, Math.PI * 2) });
    }

    this.delivered = 0;
    this.lostCount = 0;
    this.lives = LIVES_MAX;
    this.elapsed = 0;
    this.score = 0;
    this.isOver = false;

    this.pointerTarget = null;
    this.keyboardDirection = { x: 0, y: 0 };
    this.mothSpawnTimer = MOTH_SPAWN_INTERVAL_START;
    this.wispAddTimer = WISP_ADD_INTERVAL_SECONDS;
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const scaleX = this.width > 0 ? width / this.width : 1;
    const scaleY = this.height > 0 ? height / this.height : 1;
    if (this.width > 0 && this.height > 0) {
      this.lantern.x *= scaleX;
      this.lantern.y *= scaleY;
      for (const moth of this.moths) {
        moth.x *= scaleX;
        moth.y *= scaleY;
      }
      for (const wisp of this.wisps) {
        wisp.x *= scaleX;
        wisp.y *= scaleY;
      }
    }
    this.width = width;
    this.height = height;
    this.clampLanternPosition();
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

  step(deltaSeconds: number): void {
    if (this.isOver) return;

    this.elapsed += deltaSeconds;
    this.updateLanternMovement(deltaSeconds);
    this.updateSpawning(deltaSeconds);
    this.updateMoths(deltaSeconds);
    this.updateWisps(deltaSeconds);

    this.score = this.delivered * SCORE_PER_DELIVERY + Math.floor(this.elapsed * SCORE_PER_SECOND);

    if (this.lives <= 0) {
      this.lives = 0;
      this.isOver = true;
    }
  }

  private updateLanternMovement(deltaSeconds: number): void {
    const useKeyboard = this.keyboardDirection.x !== 0 || this.keyboardDirection.y !== 0;
    let dx: number;
    let dy: number;
    if (useKeyboard) {
      dx = this.keyboardDirection.x;
      dy = this.keyboardDirection.y;
    } else if (this.pointerTarget) {
      dx = this.pointerTarget.x - this.lantern.x;
      dy = this.pointerTarget.y - this.lantern.y;
    } else {
      return;
    }

    const len = Math.hypot(dx, dy);
    if (len < 1e-3) return;

    const nx = dx / len;
    const ny = dy / len;
    const maxStep = LANTERN_SPEED * deltaSeconds;
    const step = useKeyboard ? maxStep : Math.min(maxStep, len);
    this.lantern.x += nx * step;
    this.lantern.y += ny * step;
    this.clampLanternPosition();
  }

  private clampLanternPosition(): void {
    const r = LANTERN_MARKER_RADIUS;
    this.lantern.x = Math.min(Math.max(this.lantern.x, r), Math.max(r, this.width - r));
    this.lantern.y = Math.min(Math.max(this.lantern.y, r), Math.max(r, this.height - r));
  }

  private currentMothSpawnInterval(): number {
    return Math.max(
      MOTH_SPAWN_INTERVAL_MIN,
      MOTH_SPAWN_INTERVAL_START - this.elapsed * MOTH_SPAWN_RAMP_PER_SECOND,
    );
  }

  private updateSpawning(deltaSeconds: number): void {
    this.mothSpawnTimer -= deltaSeconds;
    if (this.mothSpawnTimer <= 0) {
      this.mothSpawnTimer = this.currentMothSpawnInterval();
      const spot = randomEdgePoint(this.width, this.height, MOTH_RADIUS * 2);
      this.moths.push({
        id: nextId++,
        x: spot.x,
        y: spot.y,
        angle: randRange(0, Math.PI * 2),
        isLit: false,
        isGuided: false,
        timeInDark: 0,
      });
    }

    if (this.wisps.length < MAX_WISP_COUNT) {
      this.wispAddTimer -= deltaSeconds;
      if (this.wispAddTimer <= 0) {
        this.wispAddTimer = WISP_ADD_INTERVAL_SECONDS;
        const spot = randomEdgePoint(this.width, this.height, WISP_RADIUS * 2);
        this.wisps.push({ id: nextId++, x: spot.x, y: spot.y, angle: randRange(0, Math.PI * 2) });
      }
    }
  }

  private updateMoths(deltaSeconds: number): void {
    for (let i = this.moths.length - 1; i >= 0; i--) {
      const moth = this.moths[i];
      const distToLantern = Math.hypot(moth.x - this.lantern.x, moth.y - this.lantern.y);
      moth.isLit = distToLantern <= LANTERN_LIGHT_RADIUS;
      if (moth.isLit) {
        moth.timeInDark = 0;
        moth.isGuided = true;
      }

      if (moth.isGuided) {
        const dx = this.shrineX - moth.x;
        const dy = this.shrineY - moth.y;
        const len = Math.hypot(dx, dy);
        if (len > 1e-3) {
          moth.angle = Math.atan2(dy, dx);
          const step = Math.min(MOTH_GUIDED_SPEED * deltaSeconds, len);
          moth.x += (dx / len) * step;
          moth.y += (dy / len) * step;
        }
      } else {
        moth.timeInDark += deltaSeconds;
        if (moth.timeInDark >= MOTH_LOST_SECONDS) {
          this.loseMoth(i, "stray");
          continue;
        }

        moth.angle += (Math.random() * 2 - 1) * MOTH_WANDER_TURN_RATE * deltaSeconds;
        moth.x += Math.cos(moth.angle) * MOTH_WANDER_SPEED * deltaSeconds;
        moth.y += Math.sin(moth.angle) * MOTH_WANDER_SPEED * deltaSeconds;
        this.bounceWithinBounds(moth);
      }

      const distToShrine = Math.hypot(moth.x - this.shrineX, moth.y - this.shrineY);
      if (distToShrine <= SHRINE_RADIUS) {
        this.deliverMoth(i);
      }
    }
  }

  private bounceWithinBounds(moth: Moth): void {
    const r = MOTH_RADIUS;
    if (moth.x < r) {
      moth.x = r;
      moth.angle = Math.PI - moth.angle;
    } else if (moth.x > this.width - r) {
      moth.x = this.width - r;
      moth.angle = Math.PI - moth.angle;
    }
    if (moth.y < r) {
      moth.y = r;
      moth.angle = -moth.angle;
    } else if (moth.y > this.height - r) {
      moth.y = this.height - r;
      moth.angle = -moth.angle;
    }
  }

  private deliverMoth(index: number): void {
    const [moth] = this.moths.splice(index, 1);
    this.delivered += 1;
    this.onMothDelivered?.({ moth });
  }

  private loseMoth(index: number, cause: "stray" | "wisp"): void {
    const [moth] = this.moths.splice(index, 1);
    this.lostCount += 1;
    this.lives = Math.max(0, this.lives - 1);
    this.onMothLost?.({ moth, cause });
  }

  private updateWisps(deltaSeconds: number): void {
    for (const wisp of this.wisps) {
      const target = this.nearestUnlitMoth(wisp);
      if (target) {
        const dx = target.x - wisp.x;
        const dy = target.y - wisp.y;
        const len = Math.hypot(dx, dy);
        if (len > 1e-3) {
          wisp.angle = Math.atan2(dy, dx);
          const step = Math.min(WISP_HUNT_SPEED * deltaSeconds, len);
          wisp.x += (dx / len) * step;
          wisp.y += (dy / len) * step;
        }
      } else {
        wisp.angle += (Math.random() * 2 - 1) * WISP_WANDER_TURN_RATE * deltaSeconds;
        wisp.x += Math.cos(wisp.angle) * WISP_WANDER_SPEED * deltaSeconds;
        wisp.y += Math.sin(wisp.angle) * WISP_WANDER_SPEED * deltaSeconds;
      }

      const r = WISP_RADIUS;
      wisp.x = Math.min(Math.max(wisp.x, r), Math.max(r, this.width - r));
      wisp.y = Math.min(Math.max(wisp.y, r), Math.max(r, this.height - r));
    }

    for (let i = this.moths.length - 1; i >= 0; i--) {
      const moth = this.moths[i];
      if (moth.isGuided) continue;
      const caught = this.wisps.some(
        (wisp) => Math.hypot(wisp.x - moth.x, wisp.y - moth.y) <= WISP_RADIUS + MOTH_RADIUS,
      );
      if (caught) this.loseMoth(i, "wisp");
    }
  }

  /** まだ光に当たっていない(導かれていない)蛾だけが鬼火の標的・被害対象になる。 */
  private nearestUnlitMoth(from: { x: number; y: number }): Moth | null {
    let nearest: Moth | null = null;
    let nearestDist = Number.POSITIVE_INFINITY;
    for (const moth of this.moths) {
      if (moth.isGuided) continue;
      const dist = Math.hypot(moth.x - from.x, moth.y - from.y);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = moth;
      }
    }
    return nearest;
  }
}
