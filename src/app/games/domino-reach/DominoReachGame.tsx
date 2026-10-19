"use client";

import { Application, Container, Graphics } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import styles from "./DominoReachGame.module.scss";
import type { DominoType, Phase } from "./engine/world.ts";
import { BUILD_SECONDS, DominoReachWorld, START_LIVES } from "./engine/world.ts";

const TRACK_INSET_RATIO = 0.08;
const FLOOR_Y_RATIO = 0.52;
const FLOOR_COLOR = 0x3a3f4d;
const PIT_COLOR = 0x1a0f12;
const PIT_EDGE_COLOR = 0xff6b6b;
const START_COLOR = 0x7cf5c4;
const GOAL_COLORS: Record<Phase, number> = {
  build: 0x6ee7ff,
  simulating: 0x6ee7ff,
  success: 0x7cf5c4,
  failed: 0xff6b6b,
  gameover: 0xff6b6b,
};
const DOMINO_COLOR: Record<DominoType, number> = {
  standard: 0x6ee7ff,
  booster: 0xffb454,
};

interface DominoView {
  readonly container: Container;
  readonly body: Graphics;
}

function worldToPixelX(worldX: number, trackLength: number, width: number): number {
  const usableWidth = width * (1 - TRACK_INSET_RATIO * 2);
  return width * TRACK_INSET_RATIO + (worldX / trackLength) * usableWidth;
}

function pixelXToWorld(pixelX: number, trackLength: number, width: number): number {
  const usableWidth = width * (1 - TRACK_INSET_RATIO * 2);
  const ratio = (pixelX - width * TRACK_INSET_RATIO) / usableWidth;
  return ratio * trackLength;
}

function dominoPixelHeight(height: number): number {
  return Math.min(54, Math.max(20, height * 0.16));
}

function drawDomino(graphics: Graphics, pixelHeight: number, color: number): void {
  const width = pixelHeight * 0.26;
  graphics
    .clear()
    .roundRect(-width / 2, -pixelHeight, width, pixelHeight, width * 0.3)
    .fill({ color, alpha: 0.92 })
    .stroke({ width: 1.5, color: 0xffffff, alpha: 0.35 });
}

export function DominoReachGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [stage, setStage] = useState(1);
  const [lives, setLives] = useState(START_LIVES);
  const [phase, setPhase] = useState<Phase>("build");
  const [timeRemaining, setTimeRemaining] = useState(BUILD_SECONDS);
  const [placedCount, setPlacedCount] = useState(0);
  const [inventory, setInventory] = useState({ standard: 0, booster: 0 });
  const [armedType, setArmedType] = useState<DominoType | null>(null);
  const [isPaused, setIsPaused] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<DominoReachWorld | null>(null);
  const appRef = useRef<Application | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  const previewPixelXRef = useRef<number | null>(null);

  const handleTogglePause = useCallback(() => {
    if (!loopRef.current) return;
    setIsPaused(loopRef.current.togglePause());
  }, []);

  const handleArm = useCallback((type: DominoType) => {
    worldRef.current?.arm(type);
  }, []);

  const handleStart = useCallback(() => {
    worldRef.current?.startSimulation();
  }, []);

  const handleClear = useCallback(() => {
    worldRef.current?.clearPlacements();
  }, []);

  const handleRetry = useCallback(() => {
    worldRef.current?.retryStage();
  }, []);

  const handleNextStage = useCallback(() => {
    worldRef.current?.continueToNextStage();
  }, []);

  const handleRestart = useCallback(() => {
    worldRef.current?.reset();
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
    const world = new DominoReachWorld();
    worldRef.current = world;

    const trackGraphics = new Graphics();
    const markerGraphics = new Graphics();
    const dominoLayer = new Container();
    const previewGraphics = new Graphics();
    const dominoViews = new Map<string, DominoView>();

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
      app.stage.addChild(trackGraphics, markerGraphics, dominoLayer, previewGraphics);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds, elapsedSeconds) => {
        world.step(deltaSeconds);

        setScore(world.score);
        setStage(world.stage);
        setLives(world.lives);
        setPhase(world.phase);
        setTimeRemaining(Math.ceil(world.timeRemaining));
        setPlacedCount(world.placed.length);
        setInventory({ ...world.inventory });
        setArmedType(world.armedType);

        const { width, height } = sizeRef.current;
        if (width <= 0 || height <= 0) return;

        const floorY = height * FLOOR_Y_RATIO;
        const { track } = world;

        trackGraphics.clear();
        trackGraphics.moveTo(0, floorY).lineTo(width, floorY).stroke({
          width: 3,
          color: FLOOR_COLOR,
        });
        for (const pit of track.pits) {
          const pitX1 = worldToPixelX(pit.start, track.length, width);
          const pitX2 = worldToPixelX(pit.end, track.length, width);
          trackGraphics.rect(pitX1, floorY - 4, pitX2 - pitX1, 26).fill({
            color: PIT_COLOR,
            alpha: 0.9,
          });
          trackGraphics
            .moveTo(pitX1, floorY)
            .lineTo(pitX2, floorY)
            .stroke({ width: 3, color: PIT_EDGE_COLOR, alpha: 0.7 });
        }

        markerGraphics.clear();
        const startX = worldToPixelX(0, track.length, width);
        const pulse = 0.6 + Math.sin(elapsedSeconds * 4) * 0.4;
        markerGraphics
          .circle(startX, floorY - 14, 9)
          .fill({ color: START_COLOR, alpha: 0.5 + pulse * 0.5 });

        const goalX = worldToPixelX(track.length, track.length, width);
        const goalBob = Math.sin(elapsedSeconds * 3) * 4;
        markerGraphics
          .poly([
            goalX - 10,
            floorY - 10 + goalBob,
            goalX + 10,
            floorY - 10 + goalBob,
            goalX,
            floorY - 34 + goalBob,
          ])
          .fill({ color: GOAL_COLORS[world.phase], alpha: 0.9 });

        if ((world.phase === "failed" || world.phase === "gameover") && world.simResult) {
          const breakX = worldToPixelX(
            Math.min(world.simResult.frontier, track.length),
            track.length,
            width,
          );
          markerGraphics
            .moveTo(breakX, floorY - 20)
            .lineTo(breakX, floorY + 6)
            .stroke({ width: 3, color: PIT_EDGE_COLOR, alpha: 0.9 });
        }

        const dominoHeight = dominoPixelHeight(height);
        const liveIds = new Set(world.placed.map((d) => d.id));
        for (const [id, view] of dominoViews) {
          if (!liveIds.has(id)) {
            dominoLayer.removeChild(view.container);
            view.container.destroy({ children: true });
            dominoViews.delete(id);
          }
        }
        world.placed.forEach((domino, index) => {
          let view = dominoViews.get(domino.id);
          if (!view) {
            const container = new Container();
            const body = new Graphics();
            container.addChild(body);
            dominoLayer.addChild(container);
            view = { container, body };
            dominoViews.set(domino.id, view);
          }
          drawDomino(
            view.body,
            dominoHeight,
            DOMINO_COLOR[domino.isBooster ? "booster" : "standard"],
          );

          const progress = world.toppleProgress(domino.id);
          const sway = progress <= 0 ? Math.sin(elapsedSeconds * 2 + index) * 0.05 : 0;
          view.container.rotation = progress > 0 ? progress * (Math.PI / 2) : sway;
          view.container.position.set(worldToPixelX(domino.x, track.length, width), floorY);
        });

        previewGraphics.clear();
        if (world.phase === "build" && world.armedType && previewPixelXRef.current !== null) {
          const previewBody = previewGraphics;
          const previewWorldX = pixelXToWorld(previewPixelXRef.current, track.length, width);
          const canPlace = previewWorldX >= 0 && previewWorldX <= track.length;
          drawDomino(previewBody, dominoHeight, DOMINO_COLOR[world.armedType]);
          previewBody.alpha = canPlace ? 0.4 : 0.15;
          previewBody.position.set(previewPixelXRef.current, floorY);
        }
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => {
          previewPixelXRef.current = pointer.x;
          const { width } = sizeRef.current;
          if (width <= 0) return;
          const worldX = pixelXToWorld(pointer.x, world.track.length, width);
          world.handleTap(worldX);
        },
        onPointerMove: (pointer) => {
          previewPixelXRef.current = pointer.x;
        },
        onPointerUp: () => {
          previewPixelXRef.current = null;
        },
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
          } else if (key === "r") {
            world.reset();
          } else if (key === "1") {
            world.arm("standard");
          } else if (key === "2") {
            world.arm("booster");
          } else if (key === "g") {
            world.startSimulation();
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
      for (const view of dominoViews.values()) view.container.destroy({ children: true });
      dominoViews.clear();
      if (appRef.current) {
        appRef.current.destroy(true, { children: true });
        appRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    sizeRef.current = { width: size.width, height: size.height };
  }, [size.width, size.height]);

  const phaseLabel: Record<Phase, string> = {
    build: "配置中",
    simulating: "連鎖中…",
    success: "ゴール成功",
    failed: "連鎖失敗",
    gameover: "ゲームオーバー",
  };

  return (
    <GameShell
      title="Domino Reach"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="domino-reach-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="domino-reach-canvas" />
        <div className={styles.hud}>
          <span className={styles.hudItem} data-testid="domino-reach-stage-label">
            ステージ {stage}
          </span>
          <span className={styles.hudItem} data-testid="domino-reach-lives">
            {"❤".repeat(Math.max(0, lives))}
            {"♡".repeat(Math.max(0, START_LIVES - lives))}
          </span>
          {phase === "build" && (
            <span className={styles.hudItem} data-testid="domino-reach-timer">
              ⏱ {timeRemaining}s
            </span>
          )}
          <span className={styles.hudItem} data-testid="domino-reach-phase">
            {phaseLabel[phase]}
          </span>
          <span className={styles.hudItem} data-testid="domino-reach-placed-count">
            設置 {placedCount} 本
          </span>
        </div>
        <div className={styles.hint}>
          パレットでドミノを選び、コース上をタップ/クリックで設置。隙間(溝)はブースタードミノ(橙)でしか越えられない。GOで連鎖開始、ゴールの旗まで倒れきれば成功。未武装のままタップすると置いたドミノを回収できる。
        </div>
        {phase === "build" && (
          <div className={styles.controls}>
            <div className={styles.paletteRow}>
              <button
                type="button"
                className={styles.paletteButton}
                data-armed={armedType === "standard"}
                disabled={inventory.standard <= 0}
                onClick={() => handleArm("standard")}
                data-testid="domino-reach-palette-standard"
              >
                標準 ×{inventory.standard}
              </button>
              <button
                type="button"
                className={styles.paletteButton}
                data-armed={armedType === "booster"}
                disabled={inventory.booster <= 0}
                onClick={() => handleArm("booster")}
                data-testid="domino-reach-palette-booster"
              >
                ブースター ×{inventory.booster}
              </button>
            </div>
            <div className={styles.actionRow}>
              <button
                type="button"
                className={styles.clearButton}
                disabled={placedCount === 0}
                onClick={handleClear}
                data-testid="domino-reach-clear"
              >
                配置をクリア
              </button>
              <button
                type="button"
                className={styles.goButton}
                disabled={placedCount === 0}
                onClick={handleStart}
                data-testid="domino-reach-go"
              >
                GO
              </button>
            </div>
          </div>
        )}
        {phase === "success" && (
          <div
            className={`${styles.overlay} ${styles.overlaySuccess}`}
            data-testid="domino-reach-success"
          >
            <div className={styles.overlayTitle}>ゴール成功!</div>
            <div className={styles.overlaySub}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button
              type="button"
              className={styles.overlayButton}
              onClick={handleNextStage}
              data-testid="domino-reach-next"
            >
              次のステージへ
            </button>
          </div>
        )}
        {phase === "failed" && (
          <div
            className={`${styles.overlay} ${styles.overlayFailed}`}
            data-testid="domino-reach-failed"
          >
            <div className={styles.overlayTitle}>連鎖が途切れた…</div>
            <div className={styles.overlaySub}>残りライフ {lives}</div>
            <button
              type="button"
              className={styles.overlayButton}
              onClick={handleRetry}
              data-testid="domino-reach-retry"
            >
              同じステージに再挑戦
            </button>
          </div>
        )}
        {phase === "gameover" && (
          <div
            className={`${styles.overlay} ${styles.overlayFailed}`}
            data-testid="domino-reach-gameover"
          >
            <div className={styles.overlayTitle}>ゲームオーバー</div>
            <div className={styles.overlaySub}>
              到達ステージ {stage} / SCORE {score.toLocaleString("ja-JP")}
            </div>
            <button
              type="button"
              className={styles.overlayButton}
              onClick={handleRestart}
              data-testid="domino-reach-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
