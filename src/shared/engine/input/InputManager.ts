export interface PointerState {
  /** ブラウザが振る pointerId。マルチタッチでは指ごとに異なる。 */
  id: number;
  /** 対象要素基準のローカル座標。 */
  x: number;
  y: number;
  /** ポインターが押し始めた位置。ドラッグの起点判定に使う。 */
  startX: number;
  startY: number;
  /** マウス/最初のタッチ指など「主」ポインターかどうか。 */
  isPrimary: boolean;
  pointerType: "mouse" | "touch" | "pen" | string;
}

export interface InputListener {
  onPointerDown?: (pointer: PointerState) => void;
  onPointerMove?: (pointer: PointerState) => void;
  onPointerUp?: (pointer: PointerState) => void;
  onKeyDown?: (key: string) => void;
  onKeyUp?: (key: string) => void;
}

/**
 * マウス / タッチ / ペン / キーボードを同一インターフェースで扱う入力層。
 *
 * PointerEvent はマウス・タッチ・ペンを単一のイベント系列に統合しているため、
 * ここではそれをそのまま採用し、ゲーム側は「ポインター」という抽象だけを見ればよい。
 * ジェスチャ（ドラッグ量やタップ判定）はこの上に各ゲームが薄いロジックを足す想定。
 */
export class InputManager {
  private readonly pointers = new Map<number, PointerState>();
  private readonly keys = new Set<string>();
  private readonly listeners = new Set<InputListener>();

  constructor(private readonly target: HTMLElement) {
    // ブラウザ標準のスクロール/ピンチズームとゲーム操作が競合しないようにする。
    this.target.style.touchAction = "none";
    this.target.style.userSelect = "none";

    this.target.addEventListener("pointerdown", this.handlePointerDown);
    this.target.addEventListener("pointermove", this.handlePointerMove);
    window.addEventListener("pointerup", this.handlePointerUp);
    window.addEventListener("pointercancel", this.handlePointerUp);
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
  }

  addListener(listener: InputListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  isKeyDown(key: string): boolean {
    return this.keys.has(key.toLowerCase());
  }

  getPointers(): PointerState[] {
    return Array.from(this.pointers.values());
  }

  getPrimaryPointer(): PointerState | undefined {
    return this.getPointers().find((p) => p.isPrimary) ?? this.getPointers()[0];
  }

  dispose(): void {
    this.target.removeEventListener("pointerdown", this.handlePointerDown);
    this.target.removeEventListener("pointermove", this.handlePointerMove);
    window.removeEventListener("pointerup", this.handlePointerUp);
    window.removeEventListener("pointercancel", this.handlePointerUp);
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    this.listeners.clear();
    this.pointers.clear();
    this.keys.clear();
  }

  private toLocalPoint(event: PointerEvent): { x: number; y: number } {
    const rect = this.target.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private handlePointerDown = (event: PointerEvent): void => {
    const { x, y } = this.toLocalPoint(event);
    const state: PointerState = {
      id: event.pointerId,
      x,
      y,
      startX: x,
      startY: y,
      isPrimary: event.isPrimary,
      pointerType: event.pointerType,
    };
    this.pointers.set(event.pointerId, state);
    this.target.setPointerCapture?.(event.pointerId);
    for (const listener of this.listeners) listener.onPointerDown?.(state);
  };

  private handlePointerMove = (event: PointerEvent): void => {
    const existing = this.pointers.get(event.pointerId);
    const { x, y } = this.toLocalPoint(event);
    const state: PointerState = existing
      ? { ...existing, x, y }
      : {
          id: event.pointerId,
          x,
          y,
          startX: x,
          startY: y,
          isPrimary: event.isPrimary,
          pointerType: event.pointerType,
        };
    this.pointers.set(event.pointerId, state);
    if (existing) {
      for (const listener of this.listeners) listener.onPointerMove?.(state);
    }
  };

  private handlePointerUp = (event: PointerEvent): void => {
    const state = this.pointers.get(event.pointerId);
    this.pointers.delete(event.pointerId);
    if (state) {
      for (const listener of this.listeners) listener.onPointerUp?.(state);
    }
  };

  private handleKeyDown = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase();
    const isRepeat = this.keys.has(key);
    this.keys.add(key);
    if (!isRepeat) {
      for (const listener of this.listeners) listener.onKeyDown?.(key);
    }
  };

  private handleKeyUp = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase();
    this.keys.delete(key);
    for (const listener of this.listeners) listener.onKeyUp?.(key);
  };
}
