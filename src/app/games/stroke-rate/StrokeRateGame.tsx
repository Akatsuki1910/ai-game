"use client";

import { Application, Graphics } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import { MAX_LIVES, type OarSide, StrokeRateWorld } from "./engine/world";
import styles from "./StrokeRateGame.module.scss";

const WATER_COLOR = 0x0d3a4f;
const LANE_LINE_COLOR = 0x6ee7ff;
const BOAT_COLOR = 0xffe066;
const OAR_IDLE_COLOR = 0x9aa0ac;
const OAR_FLASH_COLOR = 0x7cf5c4;
const OBSTACLE_COLOR = 0xff6b6b;

const VIEW_DISTANCE_METERS = 70;
const TICK_SPACING_METERS = 15;
const LANE_MARGIN_RATIO = 0.14;
const OAR_FLASH_SECONDS = 0.25;

export function StrokeRateGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(MAX_LIVES);
  const [combo, setCombo] = useState(0);
  const [bestCombo, setBestCombo] = useState(0);
  const [rhythmPercent, setRhythmPercent] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<StrokeRateWorld | null>(null);
  const appRef = useRef<Application | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const stageSizeRef = useRef({ width: 1, height: 1 });
  const flashSecondsRef = useRef<{ left: number; right: number }>({ left: -1, right: -1 });
  const strokeRef = useRef<(side: OarSide) => void>(() => {});

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

  const handleOarButton = useCallback((side: OarSide) => {
    strokeRef.current(side);
  }, []);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    let disposed = false;

    const app = new Application();
    const world = new StrokeRateWorld();
    worldRef.current = world;

    const laneGraphics = new Graphics();
    const boatGraphics = new Graphics();

    const triggerStroke = (side: OarSide) => {
      world.stroke(side);
      flashSecondsRef.current[side] = world.elapsedSeconds;
    };
    strokeRef.current = triggerStroke;

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: WATER_COLOR,
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
      app.stage.addChild(laneGraphics, boatGraphics);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds, elapsedSeconds) => {
        world.step(deltaSeconds);

        setScore(world.score);
        setLives(world.lives);
        setCombo(world.combo);
        setBestCombo(world.bestCombo);
        setRhythmPercent(Math.round(world.rhythm * 100));
        if (world.isOver) setIsOver(true);

        const { width, height } = stageSizeRef.current;
        const laneMargin = width * LANE_MARGIN_RATIO;
        const laneWidth = Math.max(1, width - laneMargin * 2);
        const toScreenX = (laneX: number) => laneMargin + laneX * laneWidth;
        const boatScreenY = height * 0.84;
        const topScreenY = height * 0.08;

        laneGraphics.clear();
        laneGraphics
          .moveTo(toScreenX(0), topScreenY)
          .lineTo(toScreenX(0), boatScreenY + 20)
          .stroke({ width: 3, color: LANE_LINE_COLOR, alpha: 0.4 });
        laneGraphics
          .moveTo(toScreenX(1), topScreenY)
          .lineTo(toScreenX(1), boatScreenY + 20)
          .stroke({ width: 3, color: LANE_LINE_COLOR, alpha: 0.4 });

        // 流木が画面内に1つもない間(スタート直後の安全地帯など)でも、進んだ距離に
        // 紐づく水流の目印を流し続けることで、キャンバスが静止画にならないようにする。
        const firstTickDistance =
          Math.ceil((world.distanceTraveled - 5) / TICK_SPACING_METERS) * TICK_SPACING_METERS;
        for (
          let tickDistance = firstTickDistance;
          tickDistance <= world.distanceTraveled + VIEW_DISTANCE_METERS;
          tickDistance += TICK_SPACING_METERS
        ) {
          const tickAhead = tickDistance - world.distanceTraveled;
          if (tickAhead < -5 || tickAhead > VIEW_DISTANCE_METERS) continue;
          const tickRatio = tickAhead / VIEW_DISTANCE_METERS;
          const tickY = boatScreenY - tickRatio * (boatScreenY - topScreenY);
          laneGraphics
            .moveTo(toScreenX(0.08), tickY)
            .lineTo(toScreenX(0.18), tickY)
            .stroke({ width: 2, color: LANE_LINE_COLOR, alpha: 0.25 });
          laneGraphics
            .moveTo(toScreenX(0.82), tickY)
            .lineTo(toScreenX(0.92), tickY)
            .stroke({ width: 2, color: LANE_LINE_COLOR, alpha: 0.25 });
        }

        for (const obstacle of world.obstacles) {
          const ahead = world.distanceAhead(obstacle);
          if (ahead < -5 || ahead > VIEW_DISTANCE_METERS) continue;
          const ratio = ahead / VIEW_DISTANCE_METERS;
          const y = boatScreenY - ratio * (boatScreenY - topScreenY);
          const x = toScreenX(obstacle.laneX);
          const screenRadius = obstacle.radius * laneWidth;
          laneGraphics.circle(x, y, screenRadius).fill({ color: OBSTACLE_COLOR, alpha: 0.85 });
        }

        boatGraphics.clear();
        const boatScreenX = toScreenX(world.boatX);
        boatGraphics
          .poly([
            boatScreenX,
            boatScreenY - 22,
            boatScreenX - 14,
            boatScreenY + 16,
            boatScreenX + 14,
            boatScreenY + 16,
          ])
          .fill({ color: BOAT_COLOR, alpha: 0.95 });

        const leftFlashAlpha = Math.max(
          0,
          1 - (elapsedSeconds - flashSecondsRef.current.left) / OAR_FLASH_SECONDS,
        );
        const rightFlashAlpha = Math.max(
          0,
          1 - (elapsedSeconds - flashSecondsRef.current.right) / OAR_FLASH_SECONDS,
        );
        boatGraphics.circle(boatScreenX - 30, boatScreenY, 9).fill({
          color: leftFlashAlpha > 0 ? OAR_FLASH_COLOR : OAR_IDLE_COLOR,
          alpha: 0.5 + leftFlashAlpha * 0.5,
        });
        boatGraphics.circle(boatScreenX + 30, boatScreenY, 9).fill({
          color: rightFlashAlpha > 0 ? OAR_FLASH_COLOR : OAR_IDLE_COLOR,
          alpha: 0.5 + rightFlashAlpha * 0.5,
        });
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => {
          const half = stageSizeRef.current.width / 2;
          triggerStroke(pointer.x < half ? "left" : "right");
        },
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
          } else if (key === "r") {
            world.reset();
            setIsOver(false);
          } else if (key === "arrowleft" || key === "a") {
            triggerStroke("left");
          } else if (key === "arrowright" || key === "d") {
            triggerStroke("right");
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
    stageSizeRef.current = { width: size.width, height: size.height };
  }, [size.width, size.height]);

  return (
    <GameShell
      title="Stroke Rate"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="stroke-rate-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="stroke-rate-canvas" />
        <div className={styles.hud}>
          <span className={styles.combo} data-testid="stroke-rate-combo">
            COMBO {combo} (BEST {bestCombo})
          </span>
          <span className={styles.lives} data-testid="stroke-rate-lives">
            {"♥".repeat(Math.max(0, lives))}
            {"♡".repeat(Math.max(0, MAX_LIVES - lives))}
          </span>
          <div className={styles.rhythmTrack} data-testid="stroke-rate-rhythm">
            <div className={styles.rhythmFill} style={{ width: `${rhythmPercent}%` }} />
          </div>
        </div>
        <div className={styles.oarButtons}>
          <button
            type="button"
            className={styles.oarButton}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => handleOarButton("left")}
            data-testid="stroke-rate-oar-left"
          >
            左オール
          </button>
          <button
            type="button"
            className={styles.oarButton}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => handleOarButton("right")}
            data-testid="stroke-rate-oar-right"
          >
            右オール
          </button>
        </div>
        <div className={styles.hint}>
          左右交互にクリック/タップ(または画面の左半分/右半分、A/←とD/→)でオールを漕ぐ。等間隔で交互に漕ぐほどリズムが上がって速くなる。同じ側を連続で漕ぐと減速するが艇を素早く操舵できる。流木を避けよう。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="stroke-rate-gameover">
            <div className={styles.gameOverTitle}>艇が流木に乗り上げた…</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <div className={styles.gameOverSub}>ベストコンボ {bestCombo}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="stroke-rate-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
