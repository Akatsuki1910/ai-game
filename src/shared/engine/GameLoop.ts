export type GameLoopCallback = (deltaSeconds: number, elapsedSeconds: number) => void;

/**
 * requestAnimationFrame を薄くラップしたゲームループ。
 * 各ゲームは pixi.js / three.js 自前の ticker を使わず、これを使うことで
 * pause/resume やタブ非アクティブ時の巨大な delta を共通のルールで扱える。
 */
export class GameLoop {
  private rafId: number | null = null;
  private lastTimeMs = 0;
  private elapsedSeconds = 0;
  private running = false;
  private paused = false;

  constructor(
    private readonly callback: GameLoopCallback,
    private readonly maxDeltaSeconds = 0.1,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this.lastTimeMs = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.lastTimeMs = performance.now();
  }

  togglePause(): boolean {
    if (this.paused) {
      this.resume();
    } else {
      this.pause();
    }
    return this.paused;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get isRunning(): boolean {
    return this.running;
  }

  private tick = (timeMs: number): void => {
    if (!this.running) return;

    const rawDelta = (timeMs - this.lastTimeMs) / 1000;
    this.lastTimeMs = timeMs;
    const deltaSeconds = Math.min(Math.max(rawDelta, 0), this.maxDeltaSeconds);

    if (!this.paused) {
      this.elapsedSeconds += deltaSeconds;
      this.callback(deltaSeconds, this.elapsedSeconds);
    }

    this.rafId = requestAnimationFrame(this.tick);
  };
}
