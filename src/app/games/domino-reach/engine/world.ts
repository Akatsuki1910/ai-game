import { type ChainResult, type PlacedDomino, simulateChain } from "./chain.ts";
import { createTrack, type Inventory, inventoryFor, type TrackConfig } from "./track.ts";

export type DominoType = "standard" | "booster";
export type Phase = "build" | "simulating" | "success" | "failed" | "gameover";

export const BUILD_SECONDS = 40;
export const START_LIVES = 3;
export const MIN_SPACING = 20;
/** 連鎖の波が画面上を進む速さ(ワールド単位/秒)。演出用の見た目のタイミング。 */
export const FALL_SPEED = 260;
/** 1枚が倒れ切るまでのアニメーション時間(秒)。 */
export const FLIP_SECONDS = 0.25;
const SETTLE_SECONDS = 0.6;
/** 既に置いたドミノをタップで回収できる許容距離(ワールド単位)。 */
const PICK_RADIUS = 24;

let nextDominoId = 1;

/** そのワールド座標にドミノを新しく置けるか(ピット内・既存ドミノとの近接を禁止)。 */
export function isValidPlacement(
  x: number,
  placed: readonly PlacedDomino[],
  track: TrackConfig,
): boolean {
  if (x < 0 || x > track.length) return false;
  if (track.pits.some((pit) => x >= pit.start && x <= pit.end)) return false;
  if (placed.some((domino) => Math.abs(domino.x - x) < MIN_SPACING)) return false;
  return true;
}

/**
 * ドミノを並べて連鎖を起爆する「配置→実行」型パズルのゲーム状態。
 * 配置フェーズ(build)はプレイヤーが好きに編集でき、GOで実行フェーズ(simulating)へ
 * 遷移し、純粋関数 simulateChain の結果を一定時間かけて見せてから success/failed/
 * gameover のいずれかに落ち着く。
 */
export class DominoReachWorld {
  stage = 1;
  lives = START_LIVES;
  score = 0;
  phase: Phase = "build";
  track: TrackConfig;
  placed: PlacedDomino[] = [];
  inventory: Inventory = { standard: 0, booster: 0 };
  armedType: DominoType | null = null;
  timeRemaining = BUILD_SECONDS;
  simResult: ChainResult | null = null;
  simElapsed = 0;

  constructor() {
    this.track = createTrack(this.stage);
    this.startStage();
  }

  reset(): void {
    this.stage = 1;
    this.lives = START_LIVES;
    this.score = 0;
    this.startStage();
  }

  private startStage(): void {
    this.track = createTrack(this.stage);
    this.inventory = inventoryFor(this.track);
    this.placed = [];
    this.armedType = null;
    this.phase = "build";
    this.timeRemaining = BUILD_SECONDS;
    this.simResult = null;
    this.simElapsed = 0;
  }

  /** パレットでドミノの種類を選ぶ。同じ種類を選ぶと選択解除。 */
  arm(type: DominoType): void {
    if (this.phase !== "build") return;
    this.armedType = this.armedType === type ? null : type;
  }

  /** コース上のタップの共通入口。武装中なら設置、そうでなければ既存ドミノの回収を試みる。 */
  handleTap(x: number): void {
    if (this.phase !== "build") return;
    if (this.armedType) {
      this.place(x, this.armedType);
    } else {
      this.removeNearest(x);
    }
  }

  place(x: number, type: DominoType): boolean {
    if (this.phase !== "build") return false;
    if (this.inventory[type] <= 0) return false;
    if (!isValidPlacement(x, this.placed, this.track)) return false;
    this.placed.push({ id: `d${nextDominoId++}`, x, isBooster: type === "booster" });
    this.inventory = { ...this.inventory, [type]: this.inventory[type] - 1 };
    return true;
  }

  removeNearest(x: number): boolean {
    if (this.phase !== "build") return false;
    let nearestIndex = -1;
    let nearestDistance = Number.POSITIVE_INFINITY;
    this.placed.forEach((domino, index) => {
      const distance = Math.abs(domino.x - x);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });
    if (nearestIndex === -1 || nearestDistance > PICK_RADIUS) return false;
    const [removed] = this.placed.splice(nearestIndex, 1);
    const key: DominoType = removed.isBooster ? "booster" : "standard";
    this.inventory = { ...this.inventory, [key]: this.inventory[key] + 1 };
    return true;
  }

  /** 配置を全てやり直す(在庫へ戻す)。ステージやライフはそのまま。 */
  clearPlacements(): void {
    if (this.phase !== "build") return;
    this.inventory = inventoryFor(this.track);
    this.placed = [];
    this.armedType = null;
  }

  startSimulation(): void {
    if (this.phase !== "build" || this.placed.length === 0) return;
    this.simResult = simulateChain(this.placed, this.track.length);
    this.phase = "simulating";
    this.simElapsed = 0;
  }

  /** 失敗後、ライフが残っていれば同じ難易度の新しいコースへ再挑戦する。 */
  retryStage(): void {
    if (this.phase !== "failed") return;
    this.startStage();
  }

  continueToNextStage(): void {
    if (this.phase !== "success") return;
    this.stage += 1;
    this.startStage();
  }

  step(deltaSeconds: number): void {
    if (this.phase === "build") {
      this.timeRemaining = Math.max(0, this.timeRemaining - deltaSeconds);
      if (this.timeRemaining <= 0) {
        this.simResult = simulateChain(this.placed, this.track.length);
        this.phase = "simulating";
        this.simElapsed = 0;
      }
      return;
    }

    if (this.phase === "simulating") {
      this.simElapsed += deltaSeconds;
      if (this.simElapsed >= this.simulationDurationSeconds()) {
        this.resolveSimulation();
      }
    }
  }

  simulationDurationSeconds(): number {
    if (!this.simResult) return SETTLE_SECONDS;
    const lastEvent = this.simResult.timeline.at(-1);
    const travel = lastEvent ? lastEvent.x : 0;
    return travel / FALL_SPEED + FLIP_SECONDS + SETTLE_SECONDS;
  }

  /**
   * 指定したドミノが今どれだけ倒れているか(0=直立, 1=完全に倒れた)。
   * build中は常に0。simulating中は波がそこへ到達した時刻からFLIP_SECONDSで
   * 倒れ切るように補間し、success/failed/gameoverでは結果を凍結して見せる。
   */
  toppleProgress(dominoId: string): number {
    if (this.phase === "build" || !this.simResult) return 0;
    const event = this.simResult.timeline.find((e) => e.id === dominoId);
    if (!event) return 0;
    if (this.phase !== "simulating") return 1;
    const elapsedSinceHit = this.simElapsed - event.x / FALL_SPEED;
    return Math.min(1, Math.max(0, elapsedSinceHit / FLIP_SECONDS));
  }

  private resolveSimulation(): void {
    if (!this.simResult) return;
    if (this.simResult.reachedGoal) {
      this.score += 100 * this.stage;
      this.phase = "success";
    } else {
      this.lives -= 1;
      this.phase = this.lives > 0 ? "failed" : "gameover";
    }
  }
}
