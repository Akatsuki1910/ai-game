"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import styles from "./CorniceWatchGame.module.scss";
import {
  CHAIN_THRESHOLD,
  type CollapseEvent,
  CorniceWatchWorld,
  LANE_COUNT,
  LOAD_MAX,
  type ReleaseEvent,
  VILLAGE_HEALTH_MAX,
} from "./engine/world";

const SLOPE_AREA_RATIO = 0.76;
const SAFE_COLOR = { r: 0xdc, g: 0xef, b: 0xff };
const WARNING_COLOR = { r: 0xff, g: 0xcf, b: 0x6b };
const DANGER_COLOR = { r: 0xff, g: 0x5f, b: 0x5f };
const HEALTHY_COLOR = { r: 0x7c, g: 0xf5, b: 0xc4 };
const TRACK_COLOR = 0x2b2f3a;
const COLLAPSE_FLASH_DECAY_PER_SECOND = 2;
const STORM_FLASH_DECAY_PER_SECOND = 1.5;
const POPUP_LIFETIME = 0.9;
const LANE_INDICES = Array.from({ length: LANE_COUNT }, (_, i) => i);

interface FloatingPopup {
  text: Text;
  age: number;
}

function lerpChannel(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function lerpColor(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
  t: number,
): number {
  const clamped = Math.min(1, Math.max(0, t));
  const r = lerpChannel(a.r, b.r, clamped);
  const g = lerpChannel(a.g, b.g, clamped);
  const blue = lerpChannel(a.b, b.b, clamped);
  return (r << 16) + (g << 8) + blue;
}

function loadColor(load: number): number {
  if (load < CHAIN_THRESHOLD) {
    return lerpColor(SAFE_COLOR, WARNING_COLOR, load / CHAIN_THRESHOLD);
  }
  return lerpColor(
    WARNING_COLOR,
    DANGER_COLOR,
    (load - CHAIN_THRESHOLD) / (LOAD_MAX - CHAIN_THRESHOLD),
  );
}

export function CorniceWatchGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [villageHealth, setVillageHealth] = useState(VILLAGE_HEALTH_MAX);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const laneButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const worldRef = useRef<CorniceWatchWorld | null>(null);
  const appRef = useRef<Application | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const sizeRef = useRef({ width: 0, height: 0 });

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

  const handleRelease = useCallback((laneIndex: number) => {
    if (!worldRef.current || loopRef.current?.isPaused) return;
    worldRef.current.release(laneIndex);
  }, []);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    let disposed = false;

    const app = new Application();
    const world = new CorniceWatchWorld();
    worldRef.current = world;

    const slopeGraphics = new Graphics();
    const villageGraphics = new Graphics();
    const flashGraphics = new Graphics();
    const popupHost = new Container();
    const floatingPopups: FloatingPopup[] = [];
    const laneFlash = new Array(LANE_COUNT).fill(0);
    let stormFlash = 0;

    const spawnPopup = (label: string, color: number, laneIndex: number): void => {
      const { width, height } = sizeRef.current;
      const laneWidth = width / LANE_COUNT;
      const x = laneWidth * (laneIndex + 0.5);
      const y = height * SLOPE_AREA_RATIO * 0.5;
      const text = new Text({
        text: label,
        style: { fill: color, fontSize: 15, fontWeight: "700" },
      });
      text.anchor.set(0.5, 0.5);
      text.position.set(x, y);
      popupHost.addChild(text);
      floatingPopups.push({ text, age: 0 });
    };

    world.onRelease = ({ laneIndex, points, isClutch }: ReleaseEvent) => {
      const label = isClutch ? `+${points} 際どい解放!` : `+${points}`;
      spawnPopup(label, isClutch ? 0xffcf6b : 0xdcefff, laneIndex);
    };
    world.onCollapse = ({ laneIndex }: CollapseEvent) => {
      laneFlash[laneIndex] = 1;
      spawnPopup("崩落!", 0xff5f5f, laneIndex);
    };
    world.onStorm = () => {
      stormFlash = 1;
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x0b0f16,
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
      app.stage.addChild(slopeGraphics, villageGraphics, popupHost, flashGraphics);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        world.step(deltaSeconds);
        setScore(world.score);
        setVillageHealth(world.villageHealth);
        if (world.isOver) setIsOver(true);

        for (let i = 0; i < laneFlash.length; i++) {
          laneFlash[i] = Math.max(0, laneFlash[i] - COLLAPSE_FLASH_DECAY_PER_SECOND * deltaSeconds);
        }
        stormFlash = Math.max(0, stormFlash - STORM_FLASH_DECAY_PER_SECOND * deltaSeconds);

        const { width, height } = sizeRef.current;
        if (width > 0 && height > 0) {
          const slopeHeight = height * SLOPE_AREA_RATIO;
          const laneWidth = width / LANE_COUNT;

          slopeGraphics.clear();
          world.lanes.forEach((lane, i) => {
            const x0 = laneWidth * i;
            slopeGraphics
              .rect(x0 + 2, 0, laneWidth - 4, slopeHeight)
              .stroke({ width: 1, color: TRACK_COLOR });
            const fillHeight = slopeHeight * lane.load;
            slopeGraphics
              .rect(x0 + 4, slopeHeight - fillHeight, laneWidth - 8, fillHeight)
              .fill({ color: loadColor(lane.load), alpha: 0.9 });
            if (laneFlash[i] > 0) {
              slopeGraphics
                .rect(x0 + 2, 0, laneWidth - 4, slopeHeight)
                .fill({ color: 0xff5f5f, alpha: laneFlash[i] * 0.5 });
            }

            const btn = laneButtonRefs.current[i];
            if (btn) {
              btn.dataset.load = lane.load.toFixed(3);
              btn.dataset.ready = lane.load >= CHAIN_THRESHOLD ? "true" : "false";
            }
          });

          const healthFraction = world.villageHealth / VILLAGE_HEALTH_MAX;
          villageGraphics.clear();
          villageGraphics
            .rect(0, slopeHeight, width, height - slopeHeight)
            .fill({ color: 0x141821 });
          villageGraphics
            .rect(
              width * 0.05,
              slopeHeight + (height - slopeHeight) * 0.35,
              width * 0.9,
              (height - slopeHeight) * 0.3,
            )
            .fill({ color: 0x0b0f16 });
          villageGraphics
            .rect(
              width * 0.05,
              slopeHeight + (height - slopeHeight) * 0.35,
              width * 0.9 * healthFraction,
              (height - slopeHeight) * 0.3,
            )
            .fill({ color: lerpColor(DANGER_COLOR, HEALTHY_COLOR, healthFraction) });

          flashGraphics.clear();
          if (stormFlash > 0) {
            flashGraphics
              .rect(0, 0, width, height)
              .fill({ color: 0xffffff, alpha: stormFlash * 0.35 });
          }

          for (let i = floatingPopups.length - 1; i >= 0; i--) {
            const entry = floatingPopups[i];
            entry.age += deltaSeconds;
            entry.text.position.y -= deltaSeconds * 22;
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
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
            return;
          }
          if (key === "r") {
            world.reset();
            setIsOver(false);
            return;
          }
          if (loop.isPaused) return;
          const digit = Number(key);
          if (Number.isInteger(digit) && digit >= 1 && digit <= LANE_COUNT) {
            world.release(digit - 1);
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

  const healthPercent = Math.round((villageHealth / VILLAGE_HEALTH_MAX) * 100);

  return (
    <GameShell
      title="Cornice Watch"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="cornice-watch-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="cornice-watch-canvas" />
        <div className={styles.laneRow} style={{ height: `${SLOPE_AREA_RATIO * 100}%` }}>
          {LANE_INDICES.map((laneIndex) => (
            <button
              key={laneIndex}
              type="button"
              ref={(el) => {
                laneButtonRefs.current[laneIndex] = el;
              }}
              className={styles.laneButton}
              onClick={() => handleRelease(laneIndex)}
              data-testid={`cornice-watch-lane-${laneIndex}`}
              aria-label={`レーン${laneIndex + 1}を解放`}
            >
              {laneIndex + 1}
            </button>
          ))}
        </div>
        <div className={styles.hud}>
          <div
            className={styles.villageHealth}
            data-testid="cornice-watch-village-health"
            data-health={villageHealth}
          >
            集落 {healthPercent}%
          </div>
        </div>
        <div className={styles.hint}>
          レーンをクリック/タップして積もった雪を人為的に崩そう。放置してレーンが満杯になると
          集落にダメージが入る。粘って多く溜めるほど高得点だが、際どく溜め込んでからの解放は
          隣のレーンへ雪を飛び火させ連鎖崩落を招くことも。数字キー1〜{LANE_COUNT}
          でも操作できる。Space: 一時停止 / R: リセット
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="cornice-watch-gameover">
            <div className={styles.gameOverTitle}>集落が雪崩に飲まれた…</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="cornice-watch-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
