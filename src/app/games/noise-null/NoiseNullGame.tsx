"use client";

import { Application, Graphics } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import { NoiseNullWorld, RESIDUAL_HISTORY_LENGTH } from "./engine/world";
import styles from "./NoiseNullGame.module.scss";

const AMPLITUDE_RATE_PER_SECOND = 0.9;
const PHASE_RATE_PER_SECOND = 2.4;
const PAD_RADIUS_RATIO = 0.38;

interface PadGeometry {
  centerX: number;
  centerY: number;
  radius: number;
}

export function NoiseNullGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [calm, setCalm] = useState(100);
  const [residual, setResidual] = useState(1);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<NoiseNullWorld | null>(null);
  const appRef = useRef<Application | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const padGeometryRef = useRef<PadGeometry>({ centerX: 0, centerY: 0, radius: 1 });

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
    const world = new NoiseNullWorld();
    worldRef.current = world;

    const dialGraphics = new Graphics();
    const trendGraphics = new Graphics();
    const linkGraphics = new Graphics();
    const antiTargetGraphics = new Graphics();
    const playerGraphics = new Graphics();
    let draggingPointerId: number | null = null;

    const updatePlayerFromPointer = (x: number, y: number) => {
      const { centerX, centerY, radius } = padGeometryRef.current;
      world.setPlayerFromPad(x - centerX, y - centerY, radius);
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x05060a,
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
      app.stage.addChild(
        dialGraphics,
        trendGraphics,
        linkGraphics,
        antiTargetGraphics,
        playerGraphics,
      );
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        if (input.isKeyDown("arrowup") || input.isKeyDown("w")) {
          world.nudgeAmplitude(AMPLITUDE_RATE_PER_SECOND * deltaSeconds);
        }
        if (input.isKeyDown("arrowdown") || input.isKeyDown("s")) {
          world.nudgeAmplitude(-AMPLITUDE_RATE_PER_SECOND * deltaSeconds);
        }
        if (input.isKeyDown("arrowleft") || input.isKeyDown("a")) {
          world.nudgePhase(-PHASE_RATE_PER_SECOND * deltaSeconds);
        }
        if (input.isKeyDown("arrowright") || input.isKeyDown("d")) {
          world.nudgePhase(PHASE_RATE_PER_SECOND * deltaSeconds);
        }

        world.step(deltaSeconds);
        setScore(Math.floor(world.score));
        setCalm(Math.round(world.calm));
        setResidual(Math.round(world.lastResidual * 100) / 100);
        if (world.isOver) setIsOver(true);

        const { centerX, centerY, radius } = padGeometryRef.current;

        dialGraphics.clear();
        for (const ratio of [1, 0.66, 0.33]) {
          dialGraphics
            .circle(centerX, centerY, radius * ratio)
            .stroke({ width: 1, color: 0xffffff, alpha: 0.12 });
        }
        dialGraphics
          .moveTo(centerX - radius, centerY)
          .lineTo(centerX + radius, centerY)
          .stroke({ width: 1, color: 0xffffff, alpha: 0.08 });
        dialGraphics
          .moveTo(centerX, centerY - radius)
          .lineTo(centerX, centerY + radius)
          .stroke({ width: 1, color: 0xffffff, alpha: 0.08 });

        const antiTargetX = centerX - world.lastTargetVector.x * radius;
        const antiTargetY = centerY - world.lastTargetVector.y * radius;
        const playerX = centerX + Math.cos(world.playerPhase) * world.playerAmplitude * radius;
        const playerY = centerY + Math.sin(world.playerPhase) * world.playerAmplitude * radius;

        const isQuiet = world.lastResidual <= world.quietThreshold;
        const linkColor = world.lastBurstActive ? 0xff6b6b : isQuiet ? 0x7cf5c4 : 0xffb454;

        linkGraphics.clear();
        linkGraphics
          .moveTo(playerX, playerY)
          .lineTo(antiTargetX, antiTargetY)
          .stroke({ width: 3, color: linkColor, alpha: 0.85 });

        antiTargetGraphics.clear();
        antiTargetGraphics
          .circle(antiTargetX, antiTargetY, world.lastBurstActive ? 20 : 14)
          .stroke({ width: 3, color: world.lastBurstActive ? 0xff6b6b : 0x6ee7ff, alpha: 0.9 });

        playerGraphics.clear();
        playerGraphics
          .circle(playerX, playerY, 12)
          .fill({ color: 0x6ee7ff, alpha: 0.95 })
          .stroke({ width: 2, color: 0xffffff, alpha: 0.8 });

        const history = world.residualHistory;
        trendGraphics.clear();
        if (history.length > 1) {
          const graphLeft = 16;
          const graphWidth = 140;
          const graphHeight = 36;
          const baseY = app.screen.height - 16;
          trendGraphics
            .moveTo(graphLeft, baseY)
            .lineTo(graphLeft + graphWidth, baseY)
            .stroke({ width: 1, color: 0xffffff, alpha: 0.15 });
          history.forEach((value, index) => {
            const x = graphLeft + (index / (RESIDUAL_HISTORY_LENGTH - 1)) * graphWidth;
            const y = baseY - Math.min(1, value / 1.3) * graphHeight;
            if (index === 0) {
              trendGraphics.moveTo(x, y);
            } else {
              trendGraphics.lineTo(x, y);
            }
          });
          trendGraphics.stroke({ width: 2, color: 0x6ee7ff, alpha: 0.8 });
        }
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => {
          draggingPointerId = pointer.id;
          updatePlayerFromPointer(pointer.x, pointer.y);
        },
        onPointerMove: (pointer) => {
          if (draggingPointerId !== pointer.id) return;
          updatePlayerFromPointer(pointer.x, pointer.y);
        },
        onPointerUp: (pointer) => {
          if (draggingPointerId !== pointer.id) return;
          draggingPointerId = null;
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
    padGeometryRef.current = {
      centerX: size.width / 2,
      centerY: size.height / 2,
      radius: Math.min(size.width, size.height) * PAD_RADIUS_RATIO,
    };
  }, [size.width, size.height]);

  return (
    <GameShell
      title="Noise Null"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="noise-null-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="noise-null-canvas" />
        <div className={styles.hud}>
          <span className={styles.badge} data-testid="noise-null-calm">
            CALM {calm}%
          </span>
          <span className={styles.badge} data-testid="noise-null-residual">
            残差 {residual.toFixed(2)}
          </span>
        </div>
        <div className={styles.hint}>
          ドラッグ（または矢印キー/WASD）で水色の輪をリング（打ち消しポイント）に重ね続けよう。
          ズレるとCALMが減り、重ねるほどCALMが回復してスコアが伸びる。時々来る突発ノイズ(赤)はやり過ごせ。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="noise-null-gameover">
            <div className={styles.gameOverTitle}>ノイズに埋もれた…</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="noise-null-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
