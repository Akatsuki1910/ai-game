"use client";

import { Application, Graphics } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import {
  AZIMUTH_MAX,
  ELEVATION_MAX,
  ELEVATION_MIN,
  LOCK_TOLERANCE_DEG,
  SatelliteUplinkWorld,
  STATIC_MAX,
} from "./engine/world";
import styles from "./SatelliteUplinkGame.module.scss";

const TURN_RATE_AZ_DEG_PER_SEC = 90;
const TURN_RATE_EL_DEG_PER_SEC = 60;
const STAR_COUNT = 70;

const DISH_COLOR = 0x6ee7ff;
const DISH_LOCKED_COLOR = 0x7cf5c4;
const SATELLITE_COLOR = 0xffe066;
const GRID_COLOR = 0x2b2f3a;

interface PixelPoint {
  x: number;
  y: number;
}

interface AimAngles {
  az: number;
  el: number;
}

function pxFromAim(az: number, el: number, width: number, height: number): PixelPoint {
  const elRatio = (el - ELEVATION_MIN) / (ELEVATION_MAX - ELEVATION_MIN);
  return {
    x: (az / AZIMUTH_MAX) * width,
    y: height * (1 - elRatio),
  };
}

function aimFromPointer(x: number, y: number, width: number, height: number): AimAngles {
  const az = (x / width) * AZIMUTH_MAX;
  const elRatio = 1 - y / height;
  const el = ELEVATION_MIN + elRatio * (ELEVATION_MAX - ELEVATION_MIN);
  return { az, el };
}

interface Star {
  xRatio: number;
  yRatio: number;
  radius: number;
  alpha: number;
}

function createStars(): Star[] {
  const stars: Star[] = [];
  for (let i = 0; i < STAR_COUNT; i++) {
    stars.push({
      xRatio: Math.random(),
      yRatio: Math.random(),
      radius: 0.6 + Math.random() * 1.4,
      alpha: 0.3 + Math.random() * 0.6,
    });
  }
  return stars;
}

export function SatelliteUplinkGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [isLocked, setIsLocked] = useState(false);
  const [lockStreakSeconds, setLockStreakSeconds] = useState(0);
  const [staticLevel, setStaticLevel] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const satelliteMarkerRef = useRef<HTMLDivElement | null>(null);
  const dishMarkerRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<SatelliteUplinkWorld | null>(null);
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
    const world = new SatelliteUplinkWorld();
    worldRef.current = world;
    const stars = createStars();

    const skyGraphics = new Graphics();
    const dishGraphics = new Graphics();
    const satelliteGraphics = new Graphics();

    let isPointerDown = false;
    let pointerX = 0;
    let pointerY = 0;

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x05060c,
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
      app.stage.addChild(skyGraphics, dishGraphics, satelliteGraphics);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        const { width, height } = sizeRef.current;

        let aimedByPointer = false;
        if (isPointerDown && width > 0 && height > 0) {
          const aim = aimFromPointer(pointerX, pointerY, width, height);
          world.setDishAim(aim.az, aim.el);
          aimedByPointer = true;
        }

        if (!aimedByPointer) {
          let azDelta = 0;
          let elDelta = 0;
          if (input.isKeyDown("arrowleft") || input.isKeyDown("a")) azDelta -= 1;
          if (input.isKeyDown("arrowright") || input.isKeyDown("d")) azDelta += 1;
          if (input.isKeyDown("arrowup") || input.isKeyDown("w")) elDelta += 1;
          if (input.isKeyDown("arrowdown") || input.isKeyDown("s")) elDelta -= 1;
          if (azDelta !== 0 || elDelta !== 0) {
            world.turnDish(
              azDelta * TURN_RATE_AZ_DEG_PER_SEC * deltaSeconds,
              elDelta * TURN_RATE_EL_DEG_PER_SEC * deltaSeconds,
            );
          }
        }

        world.step(deltaSeconds);

        setScore(world.score);
        setIsLocked(world.isLocked);
        setLockStreakSeconds(world.lockStreakSeconds);
        setStaticLevel(world.staticLevel);
        if (world.isOver) setIsOver(true);

        if (width === 0 || height === 0) return;

        skyGraphics.clear();
        for (const star of stars) {
          skyGraphics
            .circle(star.xRatio * width, star.yRatio * height, star.radius)
            .fill({ color: 0xffffff, alpha: star.alpha });
        }
        for (let step = 1; step < 4; step++) {
          const y = height * (step / 4);
          skyGraphics
            .moveTo(0, y)
            .lineTo(width, y)
            .stroke({ width: 1, color: GRID_COLOR, alpha: 0.5 });
        }

        const dishPos = pxFromAim(world.dishAz, world.dishEl, width, height);
        const toleranceRadiusPx = (LOCK_TOLERANCE_DEG / AZIMUTH_MAX) * width;
        const dishColor = world.isLocked ? DISH_LOCKED_COLOR : DISH_COLOR;
        dishGraphics
          .clear()
          .circle(dishPos.x, dishPos.y, toleranceRadiusPx)
          .stroke({ width: 2, color: dishColor, alpha: world.isLocked ? 0.9 : 0.45 })
          .moveTo(dishPos.x - 12, dishPos.y)
          .lineTo(dishPos.x + 12, dishPos.y)
          .moveTo(dishPos.x, dishPos.y - 12)
          .lineTo(dishPos.x, dishPos.y + 12)
          .stroke({ width: 2, color: dishColor, alpha: 0.95 });

        const satPos = pxFromAim(world.satAz, world.satEl, width, height);
        satelliteGraphics
          .clear()
          .circle(satPos.x, satPos.y, 7)
          .fill({ color: SATELLITE_COLOR, alpha: 0.95 })
          .circle(satPos.x, satPos.y, 12)
          .stroke({ width: 2, color: SATELLITE_COLOR, alpha: world.isLocked ? 0.9 : 0.3 });

        if (dishMarkerRef.current) {
          dishMarkerRef.current.style.left = `${dishPos.x}px`;
          dishMarkerRef.current.style.top = `${dishPos.y}px`;
          dishMarkerRef.current.dataset.az = world.dishAz.toFixed(1);
          dishMarkerRef.current.dataset.el = world.dishEl.toFixed(1);
        }
        if (satelliteMarkerRef.current) {
          satelliteMarkerRef.current.style.left = `${satPos.x}px`;
          satelliteMarkerRef.current.style.top = `${satPos.y}px`;
          satelliteMarkerRef.current.dataset.az = world.satAz.toFixed(1);
          satelliteMarkerRef.current.dataset.el = world.satEl.toFixed(1);
          satelliteMarkerRef.current.dataset.locked = String(world.isLocked);
        }
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => {
          if (loop.isPaused) return;
          isPointerDown = true;
          pointerX = pointer.x;
          pointerY = pointer.y;
        },
        onPointerMove: (pointer) => {
          if (!isPointerDown) return;
          pointerX = pointer.x;
          pointerY = pointer.y;
        },
        onPointerUp: () => {
          isPointerDown = false;
        },
        onKeyDown: (key) => {
          if (loop.isPaused && key !== " ") return;
          if (key === " ") {
            setIsPaused(loop.togglePause());
            return;
          }
          if (key === "r") {
            world.reset();
            isPointerDown = false;
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
    sizeRef.current = { width: size.width, height: size.height };
  }, [size.width, size.height]);

  return (
    <GameShell
      title="Satellite Uplink"
      score={score}
      scoreLabel="DATA"
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="satellite-uplink-stage">
        <div
          ref={canvasHostRef}
          className={styles.canvasHost}
          data-testid="satellite-uplink-canvas"
        />
        <div
          ref={satelliteMarkerRef}
          className={styles.satelliteMarker}
          data-testid="satellite-uplink-satellite-marker"
        />
        <div
          ref={dishMarkerRef}
          className={styles.dishMarker}
          data-testid="satellite-uplink-dish-marker"
        />
        <div className={styles.hud}>
          <span
            className={styles.lock}
            data-testid="satellite-uplink-lock"
            data-locked={isLocked}
            data-streak={lockStreakSeconds.toFixed(1)}
          >
            {isLocked ? `ロック中 ${lockStreakSeconds.toFixed(1)}s` : "信号探索中"}
          </span>
          <div className={styles.staticWrap}>
            <span className={styles.staticLabel}>NOISE</span>
            <div
              className={styles.staticTrack}
              data-testid="satellite-uplink-static"
              data-level={Math.round(staticLevel)}
            >
              <div
                className={styles.staticFill}
                style={{ width: `${(staticLevel / STATIC_MAX) * 100}%` }}
              />
            </div>
          </div>
        </div>
        <div className={styles.hint}>
          ドラッグ/長押しした方角・高度へパラボラアンテナを向け、衛星(黄色)に重ねて追尾し続けよう。
          外れるとノイズが蓄積し、満ちると回線切断。矢印キー/WASDでも操作可能。Space: 一時停止 / R:
          リセット
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="satellite-uplink-gameover">
            <div className={styles.gameOverTitle}>回線切断</div>
            <div className={styles.gameOverScore}>
              DATA {Math.floor(score).toLocaleString("ja-JP")}
            </div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="satellite-uplink-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
