"use client";

import { Application, Graphics } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import {
  type DrillInput,
  depthToScreenY,
  MAX_HEAT,
  StrataDrillWorld,
  VISIBLE_DEPTH_RANGE,
} from "./engine/world";
import styles from "./StrataDrillGame.module.scss";

const DRILL_RADIUS_RATIO = 0.022;
const POINTER_STEER_GAIN = 6;
const BAND_THICKNESS_DEPTH = 1.8;
const DUST_PARTICLE_COUNT = 18;

function readKeyboardInput(input: InputManager): DrillInput {
  const isDrillingKey =
    input.isKeyDown(" ") || input.isKeyDown("arrowdown") || input.isKeyDown("s");
  const steerRight = input.isKeyDown("arrowright") || input.isKeyDown("d");
  const steerLeft = input.isKeyDown("arrowleft") || input.isKeyDown("a");
  const steerDir = (steerRight ? 1 : 0) - (steerLeft ? 1 : 0);
  return { isDrilling: isDrillingKey, steerDir };
}

export function StrataDrillGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [heatPercent, setHeatPercent] = useState(0);
  const [depth, setDepth] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);
  const [isOverheated, setIsOverheated] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<StrataDrillWorld | null>(null);
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
    setIsOverheated(false);
    setScore(0);
    setHeatPercent(0);
    setDepth(0);
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
    const world = new StrataDrillWorld(1, 1);
    worldRef.current = world;

    const dustGraphics = new Graphics();
    const bandGraphics = new Graphics();
    const drillGraphics = new Graphics();

    let pointerDrillingId: number | null = null;
    let pointerTargetXFrac = 0.5;

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x120d0a,
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
      app.stage.addChild(dustGraphics, bandGraphics, drillGraphics);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds, elapsedSeconds) => {
        const keyboardInput = readKeyboardInput(input);
        const isPointerDrilling = pointerDrillingId !== null;
        const stepInput: DrillInput = isPointerDrilling
          ? {
              isDrilling: true,
              steerDir: Math.min(
                1,
                Math.max(-1, (pointerTargetXFrac - world.drillXFrac) * POINTER_STEER_GAIN),
              ),
            }
          : keyboardInput;

        world.step(deltaSeconds, stepInput);
        setScore(Math.floor(world.score));
        setHeatPercent(Math.round((world.heat / MAX_HEAT) * 100));
        setDepth(Math.floor(world.depth));
        if (world.isOver) {
          setIsOver(true);
          setIsOverheated(world.isOverheated);
        }

        const bandThicknessPx = (BAND_THICKNESS_DEPTH / VISIBLE_DEPTH_RANGE) * world.height;

        // 操作していなくてもドリル周りの粉塵が常に舞っていることで、ループが生きていることを示す。
        dustGraphics.clear();
        for (let i = 0; i < DUST_PARTICLE_COUNT; i++) {
          const seed = i / DUST_PARTICLE_COUNT;
          const xFrac = (seed * 0.97 + Math.sin(seed * 12.9) * 0.03 + 1) % 1;
          const fallSpeed = 0.1 + seed * 0.12;
          const yFrac = (elapsedSeconds * fallSpeed + seed) % 1;
          dustGraphics
            .circle(xFrac * world.width, yFrac * world.height, 1.5 + (i % 3))
            .fill({ color: 0xffd9a8, alpha: 0.1 });
        }

        bandGraphics.clear();
        for (const feature of world.features) {
          if (feature.isResolved) continue;
          const y = depthToScreenY(world, feature.depth);
          if (y < -bandThicknessPx || y > world.height + bandThicknessPx) continue;
          const x = feature.fromFrac * world.width;
          const w = (feature.toFrac - feature.fromFrac) * world.width;
          const color = feature.kind === "ore" ? 0x7cf5c4 : 0xff6b6b;
          bandGraphics
            .rect(x, y - bandThicknessPx / 2, w, bandThicknessPx)
            .fill({ color, alpha: feature.kind === "ore" ? 0.85 : 0.9 });
        }

        drillGraphics.clear();
        const drillRadius = Math.max(10, world.width * DRILL_RADIUS_RATIO);
        const drillScreenX = world.drillXFrac * world.width;
        const drillScreenY = depthToScreenY(world, world.depth);
        drillGraphics
          .moveTo(drillScreenX, drillScreenY + drillRadius * 1.4)
          .lineTo(drillScreenX - drillRadius, drillScreenY - drillRadius)
          .lineTo(drillScreenX + drillRadius, drillScreenY - drillRadius)
          .closePath()
          .fill({ color: 0x6ee7ff, alpha: 0.95 })
          .stroke({ width: 2, color: 0xffffff, alpha: 0.7 });
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => {
          if (pointerDrillingId !== null) return;
          pointerDrillingId = pointer.id;
          pointerTargetXFrac = Math.min(1, Math.max(0, pointer.x / world.width));
        },
        onPointerMove: (pointer) => {
          if (pointer.id !== pointerDrillingId) return;
          pointerTargetXFrac = Math.min(1, Math.max(0, pointer.x / world.width));
        },
        onPointerUp: (pointer) => {
          if (pointer.id !== pointerDrillingId) return;
          pointerDrillingId = null;
        },
        onKeyDown: (key) => {
          if (key === "p") {
            setIsPaused(loop.togglePause());
          } else if (key === "r") {
            world.reset();
            setIsOver(false);
            setIsOverheated(false);
            setScore(0);
            setHeatPercent(0);
            setDepth(0);
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
      title="Strata Drill"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="strata-drill-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="strata-drill-canvas" />
        <div className={styles.hud}>
          <div className={styles.depthStat} data-testid="strata-drill-depth">
            DEPTH {depth.toLocaleString("ja-JP")}m
          </div>
          <div className={styles.heatGauge} data-testid="strata-drill-heat">
            HEAT {heatPercent}%
            <div className={styles.heatBarTrack}>
              <div
                className={styles.heatBarFill}
                data-danger={heatPercent >= 80 ? "true" : undefined}
                style={{ width: `${heatPercent}%` }}
              />
            </div>
          </div>
        </div>
        <div className={styles.hint}>
          押しっぱなしでドリル前進、指/マウスを左右に動かして操舵。緑の帯は鉱石（加点）、赤の帯は障害物（即終了）。熱が溜まりすぎると自壊するので時々離して冷やそう。
          Space/↓: ドリル / ←→: 操舵 / P: 一時停止 / R: リセット
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="strata-drill-gameover">
            <div className={styles.gameOverTitle}>
              {isOverheated ? "ドリルが過熱で自壊..." : "障害物に激突..."}
            </div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="strata-drill-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
