"use client";

import { Application, Graphics } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import { directionVector, getPorts, opposite, type PipeCell } from "./engine/grid.ts";
import {
  DELIVERIES_PER_WAVE,
  FlowTapWorld,
  GRID_COLS,
  GRID_ROWS,
  INITIAL_LIVES,
  SINK,
  SOURCE,
} from "./engine/world.ts";
import styles from "./FlowTapGame.module.scss";

interface CellCoord {
  row: number;
  col: number;
}

type EffectKind = "delivered" | "leak" | "jam";

interface VisualEffect {
  col: number;
  row: number;
  kind: EffectKind;
  age: number;
}

const EFFECT_LIFETIME = 0.5;
const DROPLET_COLOR = 0x6ee7ff;
const EFFECT_COLORS: Record<EffectKind, number> = {
  delivered: 0x7cf5c4,
  leak: 0xff6b6b,
  jam: 0xffe066,
};

function PipeIcon({ shape, rotation }: { shape: PipeCell["shape"]; rotation: number }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={styles.pipeIcon}
      style={{ transform: `rotate(${rotation * 90}deg)` }}
      aria-hidden="true"
    >
      {shape === "straight" ? (
        <line x1={50} y1={0} x2={50} y2={100} />
      ) : (
        <path d="M50 0 L50 50 L100 50" fill="none" />
      )}
    </svg>
  );
}

export function FlowTapGame() {
  const [grid, setGrid] = useState<PipeCell[][]>([]);
  const [cursor, setCursor] = useState<CellCoord>({
    row: Math.floor(GRID_ROWS / 2),
    col: Math.floor(GRID_COLS / 2),
  });
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(INITIAL_LIVES);
  const [combo, setCombo] = useState(0);
  const [wave, setWave] = useState(1);
  const [deliveriesInWave, setDeliveriesInWave] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<FlowTapWorld | null>(null);
  const appRef = useRef<Application | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const cursorRef = useRef<CellCoord>(cursor);

  const moveCursor = useCallback((next: CellCoord) => {
    cursorRef.current = next;
    setCursor(next);
  }, []);

  const handleRotateCell = useCallback(
    (col: number, row: number) => {
      const world = worldRef.current;
      if (!world) return;
      world.rotateCellAt(col, row);
      setGrid(world.grid.map((line) => [...line]));
      moveCursor({ col, row });
    },
    [moveCursor],
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
    setScore(0);
    setLives(INITIAL_LIVES);
    setCombo(0);
    setWave(1);
    setDeliveriesInWave(0);
    setIsOver(false);
    moveCursor({ row: Math.floor(world.rows / 2), col: Math.floor(world.cols / 2) });
    if (loopRef.current?.isPaused) {
      loopRef.current.resume();
      setIsPaused(false);
    }
  }, [moveCursor]);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    let disposed = false;

    const world = new FlowTapWorld();
    worldRef.current = world;
    setGrid(world.grid.map((line) => [...line]));

    const app = new Application();
    const dropletsGraphics = new Graphics();
    const effectsGraphics = new Graphics();
    let effects: VisualEffect[] = [];

    world.onDelivered = (event) => {
      effects = [...effects, { col: event.col, row: event.row, kind: "delivered", age: 0 }];
    };
    world.onLeak = (event) => {
      effects = [...effects, { col: event.col, row: event.row, kind: "leak", age: 0 }];
    };
    world.onJam = (event) => {
      effects = [...effects, { col: event.col, row: event.row, kind: "jam", age: 0 }];
      setGrid(world.grid.map((line) => [...line]));
    };
    world.onWaveAdvance = (nextWave) => {
      setWave(nextWave);
      setDeliveriesInWave(0);
      setGrid(world.grid.map((line) => [...line]));
    };

    function stepCursor(dCol: number, dRow: number): void {
      const next = {
        col: Math.min(Math.max(cursorRef.current.col + dCol, 0), world.cols - 1),
        row: Math.min(Math.max(cursorRef.current.row + dRow, 0), world.rows - 1),
      };
      moveCursor(next);
    }

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x0b0c10,
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
      app.stage.addChild(effectsGraphics, dropletsGraphics);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        world.step(deltaSeconds);

        setScore(world.score);
        setLives(world.lives);
        setCombo(world.combo);
        setDeliveriesInWave(world.deliveriesInWave);
        if (world.isOver) setIsOver(true);

        const cellWidth = app.screen.width / world.cols;
        const cellHeight = app.screen.height / world.rows;

        effects = effects.filter((effect) => effect.age < EFFECT_LIFETIME);
        effectsGraphics.clear();
        for (const effect of effects) {
          effect.age += deltaSeconds;
          const t = Math.min(1, effect.age / EFFECT_LIFETIME);
          const centerX = (effect.col + 0.5) * cellWidth;
          const centerY = (effect.row + 0.5) * cellHeight;
          const radius = Math.min(cellWidth, cellHeight) * (0.22 + t * 0.55);
          effectsGraphics
            .circle(centerX, centerY, radius)
            .stroke({ width: 3, color: EFFECT_COLORS[effect.kind], alpha: 1 - t });
        }

        dropletsGraphics.clear();
        for (const droplet of world.droplets) {
          const cell = world.grid[droplet.row]?.[droplet.col];
          if (!cell) continue;
          const centerX = (droplet.col + 0.5) * cellWidth;
          const centerY = (droplet.row + 0.5) * cellHeight;
          const entryPort = opposite(droplet.travelDir);
          const entryVec = directionVector(entryPort);
          const entryX = centerX + entryVec.dx * (cellWidth / 2);
          const entryY = centerY + entryVec.dy * (cellHeight / 2);

          const ports = getPorts(cell);
          let exitX = centerX;
          let exitY = centerY;
          if (ports.includes(entryPort)) {
            const exitPort = ports[0] === entryPort ? ports[1] : ports[0];
            const exitVec = directionVector(exitPort);
            exitX = centerX + exitVec.dx * (cellWidth / 2);
            exitY = centerY + exitVec.dy * (cellHeight / 2);
          }

          const t = Math.min(1, droplet.progress);
          const x = entryX + (exitX - entryX) * t;
          const y = entryY + (exitY - entryY) * t;
          dropletsGraphics.circle(x, y, Math.min(cellWidth, cellHeight) * 0.15).fill({
            color: DROPLET_COLOR,
          });
        }
      }, 0.1);

      input.addListener({
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
            return;
          }
          if (key === "r") {
            handleRestart();
            return;
          }
          if (loop.isPaused || world.isOver) return;

          if (key === "arrowup" || key === "w") stepCursor(0, -1);
          else if (key === "arrowdown" || key === "s") stepCursor(0, 1);
          else if (key === "arrowleft" || key === "a") stepCursor(-1, 0);
          else if (key === "arrowright" || key === "d") stepCursor(1, 0);
          else if (key === "enter") handleRotateCell(cursorRef.current.col, cursorRef.current.row);
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
  }, [handleRestart, handleRotateCell, moveCursor]);

  const waveProgressRatio = Math.min(1, deliveriesInWave / DELIVERIES_PER_WAVE);

  return (
    <GameShell
      title="Flow Tap"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
      pauseHint="タップ / Space キーで再開"
    >
      <div className={styles.stageInner} data-testid="flow-tap-stage">
        <div className={styles.hud}>
          <span className={styles.badge} data-testid="flow-tap-wave">
            WAVE {wave}
          </span>
          <span className={styles.badge} data-testid="flow-tap-lives">
            LIVES {lives}
          </span>
          <span className={styles.badge} data-testid="flow-tap-combo">
            COMBO {combo}
          </span>
        </div>
        <div className={styles.meters}>
          <div className={styles.meterRow}>
            <span className={styles.meterLabel}>次のウェーブまで</span>
            <div className={styles.meterTrack} data-testid="flow-tap-wave-progress">
              <div className={styles.meterFill} style={{ width: `${waveProgressRatio * 100}%` }} />
            </div>
          </div>
        </div>
        <div className={styles.boardWrapper}>
          <div ref={canvasHostRef} className={styles.canvasHost} data-testid="flow-tap-canvas" />
          <div className={styles.board} data-testid="flow-tap-board">
            {grid.map((line, row) =>
              line.map((cell, col) => {
                const isCursor = cursor.row === row && cursor.col === col;
                const isSource = row === SOURCE.row && col === SOURCE.col;
                const isSink = row === SINK.row && col === SINK.col;
                return (
                  <button
                    // biome-ignore lint/suspicious/noArrayIndexKey: マスは行・列の位置そのものが識別子で、並び替わらない
                    key={`${row}-${col}`}
                    type="button"
                    className={styles.cell}
                    data-testid={`flow-tap-cell-${row}-${col}`}
                    data-shape={cell.shape}
                    data-rotation={cell.rotation}
                    data-cursor={isCursor}
                    data-source={isSource}
                    data-sink={isSink}
                    onClick={() => handleRotateCell(col, row)}
                  >
                    <PipeIcon shape={cell.shape} rotation={cell.rotation} />
                  </button>
                );
              }),
            )}
          </div>
        </div>
        <div className={styles.hint}>
          パイプをタップ/クリックで90度回転させ、左上の source から右下の sink まで水を届けよう。
          時々どこかのパイプが自動で回ってしまう「ジャム」が起きるので直し続けよう。キーボードは矢印でカーソル移動、Enterで回転。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="flow-tap-gameover">
            <div className={styles.gameOverTitle}>配管が決壊した</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <div className={styles.gameOverWave}>到達ウェーブ {wave}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="flow-tap-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
