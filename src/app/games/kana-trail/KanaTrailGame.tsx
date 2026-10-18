"use client";

import { Application, Graphics } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import type { TileCoord } from "./engine/grid";
import {
  GRID_COLS,
  GRID_ROWS,
  KanaTrailWorld,
  ROUND_SECONDS,
  type WordSubmitStatus,
} from "./engine/world";
import styles from "./KanaTrailGame.module.scss";

interface FeedbackState {
  status: WordSubmitStatus;
  word: string;
  points: number;
}

interface Particle {
  x: number;
  y: number;
  speed: number;
  size: number;
  phase: number;
}

const CALM_COLOR = 0x0b0c10;
const URGENT_COLOR = 0x2a0f12;
const PARTICLE_COUNT = 24;

function createParticle(): Particle {
  return {
    x: Math.random(),
    y: Math.random(),
    speed: 0.03 + Math.random() * 0.05,
    size: 1 + Math.random() * 2,
    phase: Math.random(),
  };
}

function lerpColor(from: number, to: number, t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  const fr = (from >> 16) & 0xff;
  const fg = (from >> 8) & 0xff;
  const fb = from & 0xff;
  const tr = (to >> 16) & 0xff;
  const tg = (to >> 8) & 0xff;
  const tb = to & 0xff;
  const r = Math.round(fr + (tr - fr) * clamped);
  const g = Math.round(fg + (tg - fg) * clamped);
  const b = Math.round(fb + (tb - fb) * clamped);
  return (r << 16) | (g << 8) | b;
}

function drawBackground(
  graphics: Graphics,
  width: number,
  height: number,
  elapsedSeconds: number,
  urgency: number,
  deltaSeconds: number,
  particles: Particle[],
): void {
  if (width <= 0 || height <= 0) return;
  graphics.clear();

  const baseColor = lerpColor(CALM_COLOR, URGENT_COLOR, urgency);
  graphics.rect(0, 0, width, height).fill({ color: baseColor });

  const pulse = 0.5 + 0.5 * Math.sin(elapsedSeconds * 1.6);
  for (const particle of particles) {
    particle.y -= particle.speed * deltaSeconds;
    if (particle.y < -0.05) {
      particle.y = 1.05;
      particle.x = Math.random();
    }
    const alpha = (0.12 + 0.22 * pulse) * (0.4 + 0.6 * particle.phase);
    graphics
      .circle(particle.x * width, particle.y * height, particle.size)
      .fill({ color: 0xffe9a8, alpha });
  }
}

function feedbackText(feedback: FeedbackState | null): string {
  if (!feedback || feedback.word.length === 0) {
    return "タイルをなぞって言葉を探そう";
  }
  switch (feedback.status) {
    case "accepted":
      return `「${feedback.word}」+${feedback.points}`;
    case "duplicate":
      return `「${feedback.word}」はもう見つけた`;
    case "invalid":
      return `「${feedback.word}」は辞書にない`;
    default:
      return "もっと長くつなごう(2文字以上)";
  }
}

export function KanaTrailGame() {
  const { ref: stageRef } = useElementSize<HTMLDivElement>();
  const [grid, setGrid] = useState<string[][]>([]);
  const [chainTiles, setChainTiles] = useState<TileCoord[]>([]);
  const [cursor, setCursor] = useState<TileCoord>({
    row: Math.floor(GRID_ROWS / 2),
    col: Math.floor(GRID_COLS / 2),
  });
  const [score, setScore] = useState(0);
  const [foundCount, setFoundCount] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(ROUND_SECONDS);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<KanaTrailWorld | null>(null);
  const appRef = useRef<Application | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const isDraggingRef = useRef(false);
  const cursorRef = useRef<TileCoord>(cursor);

  const syncChain = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    setChainTiles([...world.chain]);
  }, []);

  const moveCursor = useCallback((tile: TileCoord) => {
    cursorRef.current = tile;
    setCursor(tile);
  }, []);

  const resolveSubmit = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    const result = world.submitChain();
    setChainTiles([]);
    setScore(world.score);
    setFoundCount(world.foundWords.length);
    setFeedback({ status: result.status, word: result.word, points: result.points });
  }, []);

  const handleTilePointerDown = useCallback(
    (tile: TileCoord) => {
      const world = worldRef.current;
      if (!world) return;
      isDraggingRef.current = true;
      world.beginChain(tile);
      moveCursor(tile);
      syncChain();
    },
    [moveCursor, syncChain],
  );

  const handleTilePointerEnter = useCallback(
    (tile: TileCoord) => {
      if (!isDraggingRef.current) return;
      const world = worldRef.current;
      if (!world) return;
      if (world.extendChain(tile)) {
        moveCursor(tile);
        syncChain();
      }
    },
    [moveCursor, syncChain],
  );

  const handleTogglePause = useCallback(() => {
    if (!loopRef.current) return;
    setIsPaused(loopRef.current.togglePause());
  }, []);

  const handleRestart = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    world.reset();
    setGrid(world.grid.map((line) => [...line]));
    setChainTiles([]);
    setScore(0);
    setFoundCount(0);
    setFeedback(null);
    setIsOver(false);
    moveCursor({ row: Math.floor(world.rows / 2), col: Math.floor(world.cols / 2) });
    if (loopRef.current?.isPaused) {
      loopRef.current.resume();
      setIsPaused(false);
    }
  }, [moveCursor]);

  useEffect(() => {
    function handleWindowPointerEnd() {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      resolveSubmit();
    }
    window.addEventListener("pointerup", handleWindowPointerEnd);
    window.addEventListener("pointercancel", handleWindowPointerEnd);
    return () => {
      window.removeEventListener("pointerup", handleWindowPointerEnd);
      window.removeEventListener("pointercancel", handleWindowPointerEnd);
    };
  }, [resolveSubmit]);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    let disposed = false;

    const world = new KanaTrailWorld();
    worldRef.current = world;
    setGrid(world.grid.map((line) => [...line]));

    const app = new Application();
    const backgroundGraphics = new Graphics();
    const particles = Array.from({ length: PARTICLE_COUNT }, createParticle);

    function stepCursor(dRow: number, dCol: number): void {
      const next = {
        row: Math.min(Math.max(cursorRef.current.row + dRow, 0), world.rows - 1),
        col: Math.min(Math.max(cursorRef.current.col + dCol, 0), world.cols - 1),
      };
      moveCursor(next);
    }

    function selectCursorTile(): void {
      if (world.chain.length === 0) {
        world.beginChain(cursorRef.current);
      } else {
        world.extendChain(cursorRef.current);
      }
      syncChain();
    }

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: CALM_COLOR,
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
      app.stage.addChild(backgroundGraphics);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds, elapsedSeconds) => {
        world.step(deltaSeconds);
        setTimeRemaining(Math.ceil(world.timeRemaining));
        if (world.isOver) setIsOver(true);

        const width = app.renderer.width / app.renderer.resolution;
        const height = app.renderer.height / app.renderer.resolution;
        const urgency = 1 - world.timeRemaining / ROUND_SECONDS;
        drawBackground(
          backgroundGraphics,
          width,
          height,
          elapsedSeconds,
          urgency,
          deltaSeconds,
          particles,
        );
      }, 0.1);

      input.addListener({
        onKeyDown: (key) => {
          if (loop.isPaused && key !== " ") return;
          if (key === " ") {
            setIsPaused(loop.togglePause());
            return;
          }
          if (key === "r") {
            handleRestart();
            return;
          }
          if (world.isOver) return;

          if (key === "arrowup" || key === "w") stepCursor(-1, 0);
          else if (key === "arrowdown" || key === "s") stepCursor(1, 0);
          else if (key === "arrowleft" || key === "a") stepCursor(0, -1);
          else if (key === "arrowright" || key === "d") stepCursor(0, 1);
          else if (key === "enter") selectCursorTile();
          else if (key === "backspace") {
            world.undoLast();
            syncChain();
          } else if (key === "f") {
            resolveSubmit();
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
  }, [handleRestart, moveCursor, resolveSubmit, syncChain]);

  return (
    <GameShell
      title="Kana Trail"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="kana-trail-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="kana-trail-canvas" />
        <div className={styles.hud}>
          <span className={styles.timer} data-testid="kana-trail-timer">
            ⏱ {timeRemaining}s
          </span>
          <span className={styles.foundCount} data-testid="kana-trail-found-count">
            見つけた言葉 {foundCount}
          </span>
        </div>
        <div className={styles.boardWrapper}>
          <div className={styles.currentWord} data-testid="kana-trail-current-word">
            {chainTiles.map((tile) => grid[tile.row]?.[tile.col] ?? "").join("") || "　"}
          </div>
          <div className={styles.board} data-testid="kana-trail-board">
            {grid.map((line, row) =>
              line.map((letter, col) => {
                const isSelected = chainTiles.some((t) => t.row === row && t.col === col);
                const isCursor = cursor.row === row && cursor.col === col;
                return (
                  <button
                    // biome-ignore lint/suspicious/noArrayIndexKey: タイルは行・列の位置そのものが識別子で、並び替わらない
                    key={`${row}-${col}`}
                    type="button"
                    className={styles.tile}
                    data-testid={`kana-trail-tile-${row}-${col}`}
                    data-letter={letter}
                    data-selected={isSelected}
                    data-cursor={isCursor}
                    onPointerDown={() => handleTilePointerDown({ row, col })}
                    onPointerEnter={() => handleTilePointerEnter({ row, col })}
                  >
                    {letter}
                  </button>
                );
              }),
            )}
          </div>
        </div>
        <div className={styles.feedback} data-testid="kana-trail-feedback">
          {feedbackText(feedback)}
        </div>
        <div className={styles.hint}>
          タイルをなぞって(ドラッグ)隣接する文字をつなぎ、言葉を作って離すと確定。2文字以上、同じ言葉は1回だけ。キーボードは矢印でカーソル移動、Enterで追加、Fで確定。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="kana-trail-gameover">
            <div className={styles.gameOverTitle}>タイムアップ</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <div className={styles.gameOverWords}>見つけた言葉 {foundCount}個</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="kana-trail-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
