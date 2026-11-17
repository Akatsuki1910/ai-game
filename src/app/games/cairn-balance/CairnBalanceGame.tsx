"use client";

import { Application, Graphics } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import styles from "./CairnBalanceGame.module.scss";
import { CairnBalanceWorld, type ShapePoint } from "./engine/cairnStack";

const MOVE_SPEED_PX_PER_SEC = 240;
const ROTATE_SPEED_RAD_PER_SEC = 1.3;

const STONE_COLORS = [0x8a8178, 0x9c9186, 0x766d62, 0xb0a494] as const;
const STABLE_COLOR = 0x7cf5c4;
const UNSTABLE_COLOR = 0xff6b6b;
const COM_MARKER_COLOR = 0xffe066;

interface StoneLike {
  halfWidth: number;
  height: number;
  shapePoints: ShapePoint[];
}

function drawStonePolygon(
  graphics: Graphics,
  stone: StoneLike,
  centerX: number,
  centerY: number,
  rotation: number,
  fillColor: number,
  alpha: number,
): void {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const points: number[] = [];
  for (const p of stone.shapePoints) {
    const localX = p.x * stone.halfWidth;
    const localY = p.y * (stone.height / 2);
    points.push(centerX + localX * cos - localY * sin, centerY + (localX * sin + localY * cos));
  }
  graphics
    .poly(points)
    .fill({ color: fillColor, alpha })
    .stroke({ width: 2, color: 0x000000, alpha: 0.25 });
}

export function CairnBalanceGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);
  const [isStable, setIsStable] = useState(true);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<CairnBalanceWorld | null>(null);
  const appRef = useRef<Application | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const rotateLeftRef = useRef(false);
  const rotateRightRef = useRef(false);

  const handleTogglePause = useCallback(() => {
    if (!loopRef.current) return;
    setIsPaused(loopRef.current.togglePause());
  }, []);

  const handleRestart = useCallback(() => {
    worldRef.current?.reset();
    setIsOver(false);
    setScore(0);
    if (loopRef.current?.isPaused) {
      loopRef.current.resume();
      setIsPaused(false);
    }
  }, []);

  const startRotatingLeft = useCallback((e: { preventDefault: () => void }) => {
    e.preventDefault();
    rotateLeftRef.current = true;
  }, []);
  const stopRotatingLeft = useCallback(() => {
    rotateLeftRef.current = false;
  }, []);
  const startRotatingRight = useCallback((e: { preventDefault: () => void }) => {
    e.preventDefault();
    rotateRightRef.current = true;
  }, []);
  const stopRotatingRight = useCallback(() => {
    rotateRightRef.current = false;
  }, []);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    let disposed = false;

    const app = new Application();
    const world = new CairnBalanceWorld(1, 1);
    worldRef.current = world;

    const groundGraphics = new Graphics();
    const stackGraphics = new Graphics();
    const pendingGraphics = new Graphics();

    const stopHoldingRotation = () => {
      rotateLeftRef.current = false;
      rotateRightRef.current = false;
    };
    window.addEventListener("pointerup", stopHoldingRotation);
    window.addEventListener("pointercancel", stopHoldingRotation);

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x16130f,
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
      app.stage.addChild(groundGraphics, stackGraphics, pendingGraphics);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      let activePointerId: number | null = null;

      const loop = new GameLoop((deltaSeconds) => {
        let moveDir = 0;
        if (input.isKeyDown("arrowleft") || input.isKeyDown("a")) moveDir -= 1;
        if (input.isKeyDown("arrowright") || input.isKeyDown("d")) moveDir += 1;
        if (moveDir !== 0) world.movePendingBy(moveDir * MOVE_SPEED_PX_PER_SEC * deltaSeconds);

        let rotateDir = 0;
        if (input.isKeyDown("q") || rotateLeftRef.current) rotateDir -= 1;
        if (input.isKeyDown("e") || rotateRightRef.current) rotateDir += 1;
        if (rotateDir !== 0)
          world.rotatePendingBy(rotateDir * ROTATE_SPEED_RAD_PER_SEC * deltaSeconds);

        world.step(deltaSeconds);
        setScore(world.score);
        if (world.isOver) setIsOver(true);

        const groundY = world.groundY();
        const topStone = world.placedStones.at(-1);
        const support = world.currentSupport();
        const supportY = topStone ? topStone.centerY - topStone.height / 2 : groundY;
        const preview = world.previewStability();
        setIsStable(preview.isStable);

        groundGraphics.clear();
        groundGraphics
          .rect(0, groundY, world.width, world.height - groundY)
          .fill({ color: 0x241d14 });
        const bandColor = preview.isStable ? STABLE_COLOR : UNSTABLE_COLOR;
        groundGraphics
          .rect(support.centerX - support.halfWidth, supportY - 4, support.halfWidth * 2, 8)
          .fill({ color: bandColor, alpha: 0.35 });

        stackGraphics.clear();
        world.placedStones.forEach((stone, index) => {
          drawStonePolygon(
            stackGraphics,
            stone,
            stone.centerX,
            stone.centerY,
            stone.rotation,
            STONE_COLORS[index % STONE_COLORS.length],
            1,
          );
        });

        pendingGraphics.clear();
        const windOffset = world.currentWindOffset();
        const bodyX = world.pendingCenterX + windOffset;
        const bodyY = world.pendingCenterY();
        drawStonePolygon(
          pendingGraphics,
          world.pendingStone,
          bodyX,
          bodyY,
          world.pendingRotation,
          preview.isStable ? STABLE_COLOR : UNSTABLE_COLOR,
          0.55,
        );
        pendingGraphics
          .moveTo(preview.comX, bodyY)
          .lineTo(preview.comX, supportY)
          .stroke({ width: 2, color: COM_MARKER_COLOR, alpha: 0.55 });
        pendingGraphics.circle(preview.comX, bodyY, 4).fill({ color: COM_MARKER_COLOR });
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => {
          activePointerId = pointer.id;
          world.movePendingTo(pointer.x);
        },
        onPointerMove: (pointer) => {
          if (pointer.id !== activePointerId) return;
          world.movePendingTo(pointer.x);
        },
        onPointerUp: (pointer) => {
          if (pointer.id !== activePointerId) return;
          activePointerId = null;
          world.dropPending();
        },
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
          } else if (key === "r") {
            world.reset();
            setIsOver(false);
            setScore(0);
          } else if (key === "enter") {
            world.dropPending();
          }
        },
      });

      loopRef.current = loop;
      loop.start();
    })();

    return () => {
      disposed = true;
      window.removeEventListener("pointerup", stopHoldingRotation);
      window.removeEventListener("pointercancel", stopHoldingRotation);
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
    if (size.width === 0 || size.height === 0) return;
    worldRef.current?.resize(size.width, size.height);
  }, [size.width, size.height]);

  return (
    <GameShell
      title="Cairn Balance"
      score={score}
      scoreLabel="段数"
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="cairn-balance-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="cairn-balance-canvas" />
        <div className={styles.hud}>
          <span
            className={isStable ? styles.statusStable : styles.statusUnstable}
            data-testid="cairn-balance-status"
          >
            {isStable ? "安定しそう" : "崩れそう"}
          </span>
        </div>
        <div className={styles.rotateControls}>
          <button
            type="button"
            className={styles.rotateButton}
            data-testid="cairn-balance-rotate-left"
            onPointerDown={startRotatingLeft}
            onPointerUp={stopRotatingLeft}
            onPointerLeave={stopRotatingLeft}
            onPointerCancel={stopRotatingLeft}
          >
            ↺
          </button>
          <button
            type="button"
            className={styles.rotateButton}
            data-testid="cairn-balance-rotate-right"
            onPointerDown={startRotatingRight}
            onPointerUp={stopRotatingRight}
            onPointerLeave={stopRotatingRight}
            onPointerCancel={stopRotatingRight}
          >
            ↻
          </button>
        </div>
        <div className={styles.hint}>
          ドラッグで石を左右に動かし、離すと落とす。回転ボタン（↺↻）で向きを調整し、黄色い点（重心）が光る帯の中に収まるように置こう。風で石は揺れる。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="cairn-balance-gameover">
            <div className={styles.gameOverTitle}>崩れた…</div>
            <div className={styles.gameOverScore}>積めた段数 {score}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="cairn-balance-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
