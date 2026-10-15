"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import {
  CHUTE_COUNT,
  LIVES_MAX,
  type MissEvent,
  SCRAP_COLORS,
  type ScrapColor,
  ShredderLineWorld,
  type SortEvent,
} from "./engine/world";
import styles from "./ShredderLineGame.module.scss";

const SCRAP_HEX = {
  copper: 0xff9f55,
  steel: 0x7fb8ff,
  glass: 0x7af0c2,
} as const satisfies Record<ScrapColor, number>;

const SCRAP_CSS = {
  copper: "#ff9f55",
  steel: "#7fb8ff",
  glass: "#7af0c2",
} as const satisfies Record<ScrapColor, string>;

const SCRAP_LABEL = {
  copper: "銅",
  steel: "鉄",
  glass: "硝子",
} as const satisfies Record<ScrapColor, string>;

const BELT_Y_RATIO = 0.36;
const BELT_START_X_RATIO = 0.1;
const BELT_END_X_RATIO = 0.9;
const CHUTE_Y_RATIO = 0.82;
const CHUTE_X_RATIOS = [0.25, 0.5, 0.75] as const;
const HIT_PADDING = 18;
const URGENT_PROGRESS = 0.78;
const URGENT_COLOR = 0xff6b6b;
const POPUP_LIFETIME = 0.9;

interface PixelPoint {
  x: number;
  y: number;
}

function pieceRadius(width: number, height: number): number {
  const shortest = Math.min(width, height);
  return Math.min(26, Math.max(14, shortest * 0.04));
}

function chuteRadius(width: number, height: number): number {
  const shortest = Math.min(width, height);
  return Math.min(42, Math.max(24, shortest * 0.065));
}

function piecePixelPosition(progress: number, width: number, height: number): PixelPoint {
  return {
    x: width * (BELT_START_X_RATIO + progress * (BELT_END_X_RATIO - BELT_START_X_RATIO)),
    y: height * BELT_Y_RATIO,
  };
}

function chutePixelPosition(index: number, width: number, height: number): PixelPoint {
  return { x: width * CHUTE_X_RATIOS[index], y: height * CHUTE_Y_RATIO };
}

function findChuteAt(x: number, y: number, width: number, height: number): number | null {
  const radius = chuteRadius(width, height) + HIT_PADDING;
  for (let index = 0; index < CHUTE_COUNT; index++) {
    const pos = chutePixelPosition(index, width, height);
    if (Math.hypot(pos.x - x, pos.y - y) <= radius) return index;
  }
  return null;
}

interface DragState {
  pieceId: number;
  x: number;
  y: number;
}

interface FloatingPopup {
  text: Text;
  age: number;
}

export function ShredderLineGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(LIVES_MAX);
  const [combo, setCombo] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const pieceMarkerRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<ShredderLineWorld | null>(null);
  const appRef = useRef<Application | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const sizeRef = useRef({ width: 0, height: 0 });

  const handleTogglePause = useCallback(() => {
    if (!loopRef.current) return;
    setIsPaused(loopRef.current.togglePause());
  }, []);

  const handleRestart = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    world.reset();
    setIsOver(false);
    if (loopRef.current?.isPaused) {
      loopRef.current.resume();
      setIsPaused(false);
    }
  }, []);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    let disposed = false;

    const app = new Application();
    const world = new ShredderLineWorld();
    worldRef.current = world;

    const beltGraphics = new Graphics();
    const chuteGraphics = new Graphics();
    const pieceGraphics = new Graphics();
    const popupHost = new Container();
    const floatingPopups: FloatingPopup[] = [];
    const draggingByPointer = new Map<number, DragState>();

    const spawnPopup = (label: string, color: number, x: number, y: number): void => {
      const text = new Text({
        text: label,
        style: { fill: color, fontSize: 16, fontWeight: "700" },
      });
      text.anchor.set(0.5, 0.5);
      text.position.set(x, y);
      popupHost.addChild(text);
      floatingPopups.push({ text, age: 0 });
    };

    world.onSort = ({ result, chuteIndex, points, color }: SortEvent) => {
      const { width, height } = sizeRef.current;
      if (width === 0 || height === 0 || !color) return;
      const pos = chutePixelPosition(chuteIndex, width, height);
      if (result === "correct") {
        spawnPopup(`+${points}`, SCRAP_HEX[color], pos.x, pos.y - 20);
      } else if (result === "wrong") {
        spawnPopup("不一致", URGENT_COLOR, pos.x, pos.y - 20);
      }
    };
    world.onMiss = ({ color }: MissEvent) => {
      const { width, height } = sizeRef.current;
      if (width === 0 || height === 0) return;
      const pos = piecePixelPosition(1, width, height);
      spawnPopup("回収失敗", SCRAP_HEX[color], pos.x, pos.y - 24);
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x0b0d14,
        backgroundAlpha: 1,
        antialias: true,
        preference: "webgl",
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
      });

      if (disposed) {
        app.destroy(true, { children: true });
        return;
      }

      host.appendChild(app.canvas);
      app.stage.addChild(beltGraphics, chuteGraphics, pieceGraphics, popupHost);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        world.step(deltaSeconds);

        setScore(world.score);
        setLives(world.lives);
        setCombo(world.combo);
        if (world.isOver) setIsOver(true);

        const { width, height } = sizeRef.current;
        if (width > 0 && height > 0) {
          const pRadius = pieceRadius(width, height);
          const cRadius = chuteRadius(width, height);

          beltGraphics.clear();
          const beltStart = piecePixelPosition(0, width, height);
          const beltEnd = piecePixelPosition(1, width, height);
          beltGraphics
            .moveTo(beltStart.x, beltStart.y)
            .lineTo(beltEnd.x, beltEnd.y)
            .stroke({ width: Math.max(10, pRadius * 1.6), color: 0x2b2f3a, alpha: 0.85 });
          beltGraphics
            .poly([
              beltEnd.x,
              beltEnd.y - pRadius * 1.3,
              beltEnd.x + pRadius * 1.4,
              beltEnd.y,
              beltEnd.x,
              beltEnd.y + pRadius * 1.3,
            ])
            .fill({ color: URGENT_COLOR, alpha: 0.85 });

          chuteGraphics.clear();
          for (let index = 0; index < CHUTE_COUNT; index++) {
            const pos = chutePixelPosition(index, width, height);
            const color = SCRAP_HEX[SCRAP_COLORS[index]];
            chuteGraphics
              .poly([
                pos.x - cRadius,
                pos.y - cRadius * 0.5,
                pos.x + cRadius,
                pos.y - cRadius * 0.5,
                pos.x + cRadius * 0.4,
                pos.y + cRadius * 0.7,
                pos.x - cRadius * 0.4,
                pos.y + cRadius * 0.7,
              ])
              .fill({ color, alpha: 0.3 })
              .stroke({ width: 3, color, alpha: 0.9 });
          }

          pieceGraphics.clear();
          const dragByPieceId = new Map<number, DragState>();
          for (const drag of draggingByPointer.values()) dragByPieceId.set(drag.pieceId, drag);

          let urgentId: number | null = null;
          let urgentProgress = -1;
          for (const piece of world.pieces) {
            const drag = dragByPieceId.get(piece.id);
            const pos = drag ?? piecePixelPosition(piece.progress, width, height);
            const isUrgent = !piece.isHeld && piece.progress >= URGENT_PROGRESS;
            const fillColor = SCRAP_HEX[piece.color];

            if (piece.isHeld) {
              pieceGraphics
                .circle(pos.x, pos.y, pRadius + 6)
                .stroke({ width: 3, color: 0xffffff, alpha: 0.85 });
            } else if (isUrgent) {
              pieceGraphics
                .circle(pos.x, pos.y, pRadius + 5)
                .stroke({ width: 3, color: URGENT_COLOR, alpha: 0.9 });
            }
            pieceGraphics
              .circle(pos.x, pos.y, pRadius)
              .fill({ color: fillColor, alpha: 0.95 })
              .stroke({ width: 2, color: 0xffffff, alpha: 0.6 });

            if (!piece.isHeld && piece.progress > urgentProgress) {
              urgentProgress = piece.progress;
              urgentId = piece.id;
            }
          }

          if (pieceMarkerRef.current) {
            const urgentPiece = world.pieces.find((p) => p.id === urgentId);
            if (urgentPiece) {
              const pos = piecePixelPosition(urgentPiece.progress, width, height);
              pieceMarkerRef.current.style.left = `${pos.x}px`;
              pieceMarkerRef.current.style.top = `${pos.y}px`;
              pieceMarkerRef.current.style.display = "block";
              pieceMarkerRef.current.dataset.color = urgentPiece.color;
              pieceMarkerRef.current.dataset.pieceId = String(urgentPiece.id);
            } else {
              pieceMarkerRef.current.style.display = "none";
              delete pieceMarkerRef.current.dataset.pieceId;
            }
          }

          for (let i = floatingPopups.length - 1; i >= 0; i--) {
            const entry = floatingPopups[i];
            entry.age += deltaSeconds;
            entry.text.position.y -= deltaSeconds * 26;
            entry.text.alpha = Math.max(0, 1 - entry.age / POPUP_LIFETIME);
            if (entry.age >= POPUP_LIFETIME) {
              popupHost.removeChild(entry.text);
              entry.text.destroy();
              floatingPopups.splice(i, 1);
            }
          }
        }
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => {
          if (loop.isPaused) return;
          const { width, height } = sizeRef.current;
          if (width === 0 || height === 0) return;
          const radius = pieceRadius(width, height) + HIT_PADDING;
          let hit: number | null = null;
          for (const piece of world.pieces) {
            if (piece.isHeld) continue;
            const pos = piecePixelPosition(piece.progress, width, height);
            if (Math.hypot(pos.x - pointer.x, pos.y - pointer.y) <= radius) {
              hit = piece.id;
              break;
            }
          }
          if (hit !== null && world.grabPiece(hit)) {
            draggingByPointer.set(pointer.id, { pieceId: hit, x: pointer.x, y: pointer.y });
          }
        },
        onPointerMove: (pointer) => {
          if (loop.isPaused) return;
          const drag = draggingByPointer.get(pointer.id);
          if (!drag) return;
          drag.x = pointer.x;
          drag.y = pointer.y;
        },
        onPointerUp: (pointer) => {
          const drag = draggingByPointer.get(pointer.id);
          draggingByPointer.delete(pointer.id);
          if (!drag) return;
          if (loop.isPaused) {
            world.releasePiece(drag.pieceId);
            return;
          }
          const { width, height } = sizeRef.current;
          if (width === 0 || height === 0) {
            world.releasePiece(drag.pieceId);
            return;
          }
          const chuteIndex = findChuteAt(pointer.x, pointer.y, width, height);
          if (chuteIndex !== null) {
            world.sortPiece(drag.pieceId, chuteIndex);
          } else {
            world.releasePiece(drag.pieceId);
          }
        },
        onKeyDown: (key) => {
          if (loop.isPaused && key !== " ") return;
          if (key === " ") {
            setIsPaused(loop.togglePause());
            return;
          }
          if (key === "r") {
            world.reset();
            draggingByPointer.clear();
            setIsOver(false);
            return;
          }
          if (/^[1-3]$/.test(key)) {
            const chuteIndex = Number(key) - 1;
            const targetId = world.mostUrgentPieceId();
            if (targetId !== null) world.sortPiece(targetId, chuteIndex);
          }
        },
      });

      loopRef.current = loop;
      loop.start();
    })();

    return () => {
      disposed = true;
      loopRef.current?.stop();
      loopRef.current = null;
      inputRef.current?.dispose();
      inputRef.current = null;
      if (appRef.current) {
        appRef.current.destroy(true, { children: true });
        appRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    sizeRef.current = { width: size.width, height: size.height };
  }, [size.width, size.height]);

  return (
    <GameShell
      title="Shredder Line"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="shredder-line-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="shredder-line-canvas" />
        <div
          ref={pieceMarkerRef}
          className={styles.pieceMarker}
          data-testid="shredder-line-piece-marker"
        />
        <div className={styles.hud}>
          <span className={styles.combo} data-testid="shredder-line-combo">
            COMBO {combo}
          </span>
          <span className={styles.lives} data-testid="shredder-line-lives" data-lives={lives}>
            ライフ {lives} / {LIVES_MAX}
          </span>
        </div>
        <div className={styles.hint}>
          ベルトを流れるスクラップを同じ色のシュートへドラッグして仕分けよう。シュレッダー(右端)に届くと失敗。
          キーボードは1〜3キーで最も危険なスクラップを対応するシュートへ即投入。Space: 一時停止 / R:
          リセット
        </div>
        <div className={styles.panel} data-testid="shredder-line-legend">
          {SCRAP_COLORS.map((color, index) => (
            <span
              key={color}
              className={styles.legendItem}
              data-testid={`shredder-line-chute-${index}`}
              data-color={color}
              style={{ backgroundColor: SCRAP_CSS[color] }}
              title={`シュート${index + 1}: ${SCRAP_LABEL[color]}`}
            />
          ))}
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="shredder-line-gameover">
            <div className={styles.gameOverTitle}>操業停止</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="shredder-line-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
