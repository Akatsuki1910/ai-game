export const CUP_GRADE = {
  perfect: "perfect",
  good: "good",
  short: "short",
  over: "over",
} as const;

export type CupGrade = (typeof CUP_GRADE)[keyof typeof CUP_GRADE];

export const LIFE_LOST_REASON = {
  missedCup: "missedCup",
  spilled: "spilled",
} as const;

export type LifeLostReason = (typeof LIFE_LOST_REASON)[keyof typeof LIFE_LOST_REASON];

export interface Cup {
  /** 湯呑みの中心x(画面幅比)。 */
  x: number;
  /** 湯呑みの口の幅(画面幅比)。 */
  width: number;
  /** 満杯の量(ml)。 */
  capacity: number;
  /** 狙う水位(満杯に対する比率)。 */
  targetRatio: number;
  filled: number;
  hasOverflowed: boolean;
  grade: CupGrade | null;
}

export interface StreamDrop {
  /** 注ぎ口からの落下位置(画面高さ比)。x は常に SPOUT_X。 */
  y: number;
  vy: number;
  volume: number;
}

export interface CupServedEvent {
  grade: CupGrade;
  fillRatio: number;
  targetRatio: number;
  points: number;
  x: number;
}

export const MAX_LIVES = 3;
export const SPILL_MAX = 240; // ml。こぼした量がこれに達するとライフを1失う。
export const MAX_FLOW = 240; // ml/秒。急須を最大まで傾けたときの流量。
export const SPOUT_X = 0.38; // 画面幅比。注ぎ口の位置は固定で、湯呑みの方が流れてくる。
export const SPOUT_Y = 0.36; // 画面高さ比
export const BELT_Y = 0.8; // 画面高さ比。ベルトコンベアの上面。
export const PERFECT_BAND = 0.06;
export const GOOD_BAND = 0.14;

const GRAVITY = 3.2; // 画面高さ/秒^2。画面比で持つことで画面サイズに関わらず落下時間が一定になる。
const TILT_RISE_RATE = 4; // /秒。押している間に急須が傾く速さ。
const TILT_FALL_RATE = 10; // /秒。離したあと急須が戻る速さ。
const PERFECT_POINTS = 300;
const GOOD_POINTS = 120;
const COMBO_STEP = 0.1;
const COMBO_CAP = 10;
const BASE_BELT_SPEED = 0.1; // 画面幅/秒
const BELT_SPEED_STEP = 0.006;
const MAX_BELT_SPEED = 0.24;
const MIN_CUP_WIDTH = 0.07;
const MAX_CUP_WIDTH = 0.13;
const CUP_ASPECT = 1.05; // 湯呑みの見た目の 高さ/幅 (px比)
const MIN_CUP_HEIGHT = 0.1;
const MAX_CUP_HEIGHT = 0.24;
// 満杯量 = 注ぎ口の下を通過する時間 × 最大流量 × この係数。速いベルトでも物理的に注ぎ切れる量に保つ。
const MIN_FILL_FACTOR = 0.45;
const MAX_FILL_FACTOR = 0.75;
const MIN_TARGET_RATIO = 0.6;
const MAX_TARGET_RATIO = 0.85;
const MIN_CUP_GAP = 0.16;
const MAX_CUP_GAP = 0.38;
const DESPAWN_X = -0.1;
// 最初の1杯は広く・遅く・少なめにして、落下の遅れに慣れる時間を作る。
const WARMUP_CUP = { x: 0.75, width: 0.16, fillFactor: 0.6, targetRatio: 0.7 } as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * 急須でお茶を注ぐ「Kyusu Pour」の純粋ロジック。
 * 注ぎ口は固定で、ベルトコンベアの湯呑みが右から流れてくる。押している間だけ急須が傾いて
 * お茶が落ち始めるが、落下には時間がかかるため、湯呑みの到着を先読みして注ぎ始め、
 * 空中のお茶まで見越して早めに止めないと、こぼしたり入れすぎたりする。
 * 座標は画面幅比(x)・画面高さ比(y)で持ち、リサイズの影響を受けないようにしている。
 */
export class KyusuPourWorld {
  tilt = 0;
  isPouring = false;
  score = 0;
  combo = 0;
  lives = MAX_LIVES;
  spilled = 0;
  servedCount = 0;
  beltTravel = 0;
  isOver = false;
  lastGrade: CupGrade | null = null;

  onCupServed: ((event: CupServedEvent) => void) | null = null;
  onLifeLost: ((reason: LifeLostReason) => void) | null = null;
  /** こぼれたお茶が落ちた高さ(画面高さ比)。しぶきの演出用。 */
  onSpill: ((y: number) => void) | null = null;

  private aspect = 16 / 9;
  private nextGap = MIN_CUP_GAP;
  private readonly cupList: Cup[] = [];
  private readonly dropList: StreamDrop[] = [];
  private readonly random: () => number;

  constructor(randomFn: () => number = Math.random) {
    this.random = randomFn;
    this.reset();
  }

  get cups(): readonly Readonly<Cup>[] {
    return this.cupList;
  }

  get drops(): readonly Readonly<StreamDrop>[] {
    return this.dropList;
  }

  get beltSpeed(): number {
    return Math.min(MAX_BELT_SPEED, BASE_BELT_SPEED + this.servedCount * BELT_SPEED_STEP);
  }

  /** 空中を落下中のお茶の総量(ml)。湯呑みのゲージに「これから入る量」として見せる。 */
  get pendingVolume(): number {
    return this.dropList.reduce((sum, drop) => sum + drop.volume, 0);
  }

  /** まだ採点されていない最も手前の湯呑み。注ぎ口の下にいるか、これから来るもの。 */
  get nextCup(): Readonly<Cup> | null {
    return this.cupList.find((cup) => cup.grade === null) ?? null;
  }

  reset(): void {
    this.tilt = 0;
    this.isPouring = false;
    this.score = 0;
    this.combo = 0;
    this.lives = MAX_LIVES;
    this.spilled = 0;
    this.servedCount = 0;
    this.beltTravel = 0;
    this.isOver = false;
    this.lastGrade = null;
    this.cupList.length = 0;
    this.dropList.length = 0;
    this.cupList.push(
      this.createCup(WARMUP_CUP.x, WARMUP_CUP.width, WARMUP_CUP.fillFactor, WARMUP_CUP.targetRatio),
    );
    this.nextGap = this.randRange(MIN_CUP_GAP, MAX_CUP_GAP);
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.aspect = width / height;
  }

  setPouring(isPouring: boolean): void {
    this.isPouring = isPouring;
  }

  /** 湯呑みの高さ(画面高さ比)。縁の位置 = BELT_Y - この値。 */
  cupHeight(cup: Readonly<Cup>): number {
    return clamp(cup.width * this.aspect * CUP_ASPECT, MIN_CUP_HEIGHT, MAX_CUP_HEIGHT);
  }

  isUnderSpout(cup: Readonly<Cup>): boolean {
    return Math.abs(cup.x - SPOUT_X) <= cup.width / 2;
  }

  step(deltaSeconds: number): void {
    if (this.isOver || deltaSeconds <= 0) return;

    const tiltRate = this.isPouring ? TILT_RISE_RATE : -TILT_FALL_RATE;
    this.tilt = clamp(this.tilt + tiltRate * deltaSeconds, 0, 1);
    const pouredVolume = this.tilt * MAX_FLOW * deltaSeconds;
    if (pouredVolume > 0) this.dropList.push({ y: SPOUT_Y, vy: 0, volume: pouredVolume });

    const travel = this.beltSpeed * deltaSeconds;
    this.beltTravel += travel;
    for (const cup of this.cupList) cup.x -= travel;

    this.stepDrops(deltaSeconds);
    if (this.isOver) return;
    this.gradePassedCups();
    if (this.isOver) return;
    this.spawnAndDespawnCups();
  }

  private stepDrops(deltaSeconds: number): void {
    const cupUnderSpout = this.cupList.find((cup) => cup.grade === null && this.isUnderSpout(cup));
    const rimY = cupUnderSpout ? BELT_Y - this.cupHeight(cupUnderSpout) : null;

    for (let i = this.dropList.length - 1; i >= 0; i--) {
      const drop = this.dropList[i];
      const previousY = drop.y;
      drop.vy += GRAVITY * deltaSeconds;
      drop.y += drop.vy * deltaSeconds;

      // 縁をこのフレームで越えたものだけ湯呑みに入れる。縁より下を落ちていた滴に後から湯呑みが
      // 滑り込んでも、それは湯呑みの外側に当たっているので受け止めない。
      if (cupUnderSpout && rimY !== null && previousY < rimY && drop.y >= rimY) {
        this.pourIntoCup(cupUnderSpout, drop.volume);
        this.dropList.splice(i, 1);
      } else if (drop.y >= BELT_Y) {
        this.onSpill?.(BELT_Y);
        this.addSpill(drop.volume);
        this.dropList.splice(i, 1);
      }
      if (this.isOver) return;
    }
  }

  private pourIntoCup(cup: Cup, volume: number): void {
    cup.filled += volume;
    if (cup.filled <= cup.capacity) return;
    const overflow = cup.filled - cup.capacity;
    cup.filled = cup.capacity;
    cup.hasOverflowed = true;
    this.onSpill?.(BELT_Y - this.cupHeight(cup));
    this.addSpill(overflow);
  }

  private addSpill(volume: number): void {
    this.spilled += volume;
    if (this.spilled < SPILL_MAX) return;
    this.spilled = 0;
    this.loseLife(LIFE_LOST_REASON.spilled);
  }

  private loseLife(reason: LifeLostReason): void {
    this.lives = Math.max(0, this.lives - 1);
    this.combo = 0;
    this.onLifeLost?.(reason);
    if (this.lives === 0) {
      this.isOver = true;
      this.isPouring = false;
    }
  }

  private gradePassedCups(): void {
    for (const cup of this.cupList) {
      if (cup.grade !== null || cup.x + cup.width / 2 >= SPOUT_X) continue;
      this.gradeCup(cup);
      if (this.isOver) return;
    }
  }

  private gradeCup(cup: Cup): void {
    const fillRatio = cup.filled / cup.capacity;
    const grade = judgeFill(fillRatio, cup.targetRatio, cup.hasOverflowed);
    cup.grade = grade;
    this.lastGrade = grade;
    this.servedCount += 1;

    const basePoints =
      grade === CUP_GRADE.perfect ? PERFECT_POINTS : grade === CUP_GRADE.good ? GOOD_POINTS : 0;
    const points = Math.round(basePoints * (1 + Math.min(this.combo, COMBO_CAP) * COMBO_STEP));
    this.score += points;

    this.onCupServed?.({
      grade,
      fillRatio,
      targetRatio: cup.targetRatio,
      points,
      x: cup.x,
    });

    if (points > 0) {
      this.combo += 1;
      return;
    }
    this.loseLife(LIFE_LOST_REASON.missedCup);
  }

  private spawnAndDespawnCups(): void {
    for (let i = this.cupList.length - 1; i >= 0; i--) {
      const cup = this.cupList[i];
      if (cup.x + cup.width / 2 < DESPAWN_X) this.cupList.splice(i, 1);
    }

    const lastCup = this.cupList.at(-1);
    if (lastCup && lastCup.x + lastCup.width / 2 > 1 - this.nextGap) return;

    const width = this.randRange(MIN_CUP_WIDTH, MAX_CUP_WIDTH);
    this.cupList.push(
      this.createCup(
        1 + width / 2,
        width,
        this.randRange(MIN_FILL_FACTOR, MAX_FILL_FACTOR),
        this.randRange(MIN_TARGET_RATIO, MAX_TARGET_RATIO),
      ),
    );
    this.nextGap = this.randRange(MIN_CUP_GAP, MAX_CUP_GAP);
  }

  private createCup(x: number, width: number, fillFactor: number, targetRatio: number): Cup {
    const secondsUnderSpout = width / this.beltSpeed;
    return {
      x,
      width,
      capacity: Math.round(secondsUnderSpout * MAX_FLOW * fillFactor),
      targetRatio,
      filled: 0,
      hasOverflowed: false,
      grade: null,
    };
  }

  private randRange(min: number, max: number): number {
    return min + this.random() * (max - min);
  }
}

/** 湯呑みの水位を採点する。溢れさせた湯呑みは水位に関わらず「入れすぎ」。 */
export function judgeFill(
  fillRatio: number,
  targetRatio: number,
  hasOverflowed: boolean,
): CupGrade {
  if (hasOverflowed) return CUP_GRADE.over;
  const difference = fillRatio - targetRatio;
  if (Math.abs(difference) <= PERFECT_BAND) return CUP_GRADE.perfect;
  if (Math.abs(difference) <= GOOD_BAND) return CUP_GRADE.good;
  return difference < 0 ? CUP_GRADE.short : CUP_GRADE.over;
}
