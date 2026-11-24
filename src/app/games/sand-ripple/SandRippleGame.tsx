"use client";

import { Application, Graphics } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import { GRID_COLS, GRID_ROWS, ROUND_SECONDS, SandRippleWorld } from "./engine/world";
import styles from "./SandRippleGame.module.scss";

const SAND_BASE_COLOR = 0xe3d6ae;
const SAND_RAKED_COLOR = 0xfdf2d8;
const ROCK_COLOR = 0x4b4038;
const RING_HINT_COLOR = 0xffd27a;

function drawSand(graphics: Graphics, world: SandRippleWorld): void {
  if (world.width <= 0 || world.height <= 0) return;
  const cellWidth = world.width / GRID_COLS;
  const cellHeight = world.height / GRID_ROWS;

  graphics.clear();
  world.forEachCell((col, row, rakedLevel, isRock, isRingBonus) => {
    if (isRock) return;
    const x = col * cellWidth;
    const y = row * cellHeight;

    // 風が吹いて砂面が揺れているように見せるための、常時かかる微細な明暗の揺らぎ。
    const shimmer = Math.sin(world.elapsedSeconds * 1.6 + col * 0.35 + row * 0.22) * 0.04;
    const baseAlpha = Math.min(1, Math.max(0, 0.55 + shimmer));

    graphics.rect(x, y, cellWidth, cellHeight).fill({ color: SAND_BASE_COLOR, alpha: baseAlpha });
    if (rakedLevel > 0) {
      graphics
        .rect(x + cellWidth * 0.08, y + cellHeight * 0.08, cellWidth * 0.84, cellHeight * 0.84)
        .fill({ color: SAND_RAKED_COLOR, alpha: rakedLevel * 0.85 });
    }
    if (isRingBonus) {
      graphics
        .rect(x, y, cellWidth, cellHeight)
        .stroke({ width: 1, color: RING_HINT_COLOR, alpha: 0.18 + shimmer });
    }
  });
}

function drawRocks(graphics: Graphics, world: SandRippleWorld): void {
  graphics.clear();
  for (const rock of world.rocks) {
    const circle = world.rockToPixel(rock);
    graphics
      .circle(circle.x, circle.y, circle.radius)
      .fill({ color: ROCK_COLOR, alpha: 0.95 })
      .stroke({ width: 2, color: 0x2b241f, alpha: 0.6 });
    graphics
      .circle(circle.x - circle.radius * 0.3, circle.y - circle.radius * 0.3, circle.radius * 0.35)
      .fill({
        color: 0x6b5d4f,
        alpha: 0.35,
      });
  }
}

export function SandRippleGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [coveragePercent, setCoveragePercent] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(ROUND_SECONDS);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<SandRippleWorld | null>(null);
  const appRef = useRef<Application | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);

  const handleTogglePause = useCallback(() => {
    if (!loopRef.current) return;
    setIsPaused(loopRef.current.togglePause());
  }, []);

  const handleRestart = useCallback(() => {
    worldRef.current?.reset();
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
    const world = new SandRippleWorld(1, 1);
    worldRef.current = world;

    const sandGraphics = new Graphics();
    const rockGraphics = new Graphics();
    const lastPointByPointer = new Map<number, { x: number; y: number }>();

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0xe3d6ae,
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
      app.stage.addChild(sandGraphics, rockGraphics);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        world.step(deltaSeconds);
        setScore(Math.floor(world.score));
        setCoveragePercent(Math.floor(world.coveragePercent));
        setTimeRemaining(Math.ceil(world.timeRemaining));
        if (world.isOver) setIsOver(true);

        drawSand(sandGraphics, world);
        drawRocks(rockGraphics, world);
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => {
          lastPointByPointer.set(pointer.id, { x: pointer.x, y: pointer.y });
          world.rakeStroke(pointer.x, pointer.y, pointer.x, pointer.y);
        },
        onPointerMove: (pointer) => {
          const last = lastPointByPointer.get(pointer.id);
          if (!last) return;
          world.rakeStroke(last.x, last.y, pointer.x, pointer.y);
          lastPointByPointer.set(pointer.id, { x: pointer.x, y: pointer.y });
        },
        onPointerUp: (pointer) => {
          lastPointByPointer.delete(pointer.id);
        },
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
          } else if (key === "r") {
            world.reset();
            setIsOver(false);
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
    if (size.width === 0 || size.height === 0) return;
    worldRef.current?.resize(size.width, size.height);
  }, [size.width, size.height]);

  return (
    <GameShell
      title="Sand Ripple"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="sand-ripple-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="sand-ripple-canvas" />
        <div className={styles.hud}>
          <span className={styles.timer} data-testid="sand-ripple-timer">
            ⏱ {timeRemaining}s
          </span>
          <span className={styles.coverage} data-testid="sand-ripple-coverage">
            掃き面積 {coveragePercent}%
          </span>
        </div>
        <div className={styles.hint}>
          ドラッグで砂をかいて模様を描こう。石のまわり(縁が光る範囲)を掃くと得点2倍以上。かいた砂は時間が経つと風で元に戻るので、こまめに掃き直そう。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="sand-ripple-gameover">
            <div className={styles.gameOverTitle}>庭づくり終了</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="sand-ripple-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
