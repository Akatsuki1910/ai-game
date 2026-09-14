"use client";

import { Application, Graphics } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import { COLUMN_COUNT, KEEP_END_INDEX, KEEP_START_INDEX, TideKeepWorld } from "./engine/world";
import styles from "./TideKeepGame.module.scss";

const SHOVEL_KEY_SPEED = 420; // px/秒。キーボードでショベルを動かす速さ
const SAND_COLOR = 0xe0c48c;
const SAND_KEEP_COLOR = 0xf2d98f;
const SAND_STROKE_COLOR = 0x7a5c2e;
const WATER_COLOR = 0x3aa0c9;
const WATER_SURGE_COLOR = 0x6ee7ff;
const SHOVEL_COLOR_ACTIVE = 0xffe066;
const SHOVEL_COLOR_IDLE = 0xf2f3f5;

export function TideKeepGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [wavesSurvived, setWavesSurvived] = useState(0);
  const [keepIntegrity, setKeepIntegrity] = useState(1);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<TideKeepWorld | null>(null);
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
    setWavesSurvived(0);
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
    const world = new TideKeepWorld(1, 1);
    worldRef.current = world;

    const waterGraphics = new Graphics();
    const sandGraphics = new Graphics();
    const shovelGraphics = new Graphics();

    let draggingPointerId: number | null = null;
    let isPointerDown = false;
    let pointerX = 0;

    world.onWaveResolved = () => {
      setWavesSurvived(world.wavesSurvived);
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x0a1420,
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
      app.stage.addChild(waterGraphics, sandGraphics, shovelGraphics);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        let pilingDrivenByPointer = false;
        if (isPointerDown) {
          world.setShovelPosition(pointerX);
          world.setPiling(true);
          pilingDrivenByPointer = true;
        }

        if (!pilingDrivenByPointer) {
          let direction = 0;
          if (input.isKeyDown("arrowleft") || input.isKeyDown("a")) direction -= 1;
          if (input.isKeyDown("arrowright") || input.isKeyDown("d")) direction += 1;

          if (direction !== 0) {
            world.moveShovelBy(direction * SHOVEL_KEY_SPEED * deltaSeconds);
            world.setPiling(true);
          } else {
            world.setPiling(false);
          }
        }

        world.step(deltaSeconds);

        setScore(world.score);
        setElapsedSeconds(Math.floor(world.elapsedSeconds));
        setKeepIntegrity(world.keepIntegrity);
        if (world.isOver) setIsOver(true);

        const waterTopY = world.height - world.waterLevel;
        waterGraphics
          .clear()
          .rect(0, waterTopY, world.width, Math.max(0, world.height - waterTopY))
          .fill({ color: WATER_COLOR, alpha: 0.55 })
          .moveTo(0, waterTopY)
          .lineTo(world.width, waterTopY)
          .stroke({ width: 3, color: WATER_SURGE_COLOR, alpha: 0.5 + world.waveSurgeRatio * 2 });

        sandGraphics.clear();
        const columnWidth = world.columnWidth;
        for (let i = 0; i < COLUMN_COUNT; i++) {
          const x = i * columnWidth;
          const topY = world.height - world.sandHeights[i];
          const isKeepColumn = i >= KEEP_START_INDEX && i < KEEP_END_INDEX;
          sandGraphics
            .rect(x, topY, columnWidth + 0.5, world.height - topY)
            .fill({ color: isKeepColumn ? SAND_KEEP_COLOR : SAND_COLOR })
            .stroke({ width: 1, color: SAND_STROKE_COLOR, alpha: 0.4 });
        }

        const shovelColumnIndex = Math.min(
          COLUMN_COUNT - 1,
          Math.max(0, Math.floor(world.shovelX / columnWidth)),
        );
        const shovelTopY = world.height - world.sandHeights[shovelColumnIndex];
        shovelGraphics
          .clear()
          .circle(world.shovelX, shovelTopY - 14, world.isPiling ? 10 : 7)
          .fill({ color: world.isPiling ? SHOVEL_COLOR_ACTIVE : SHOVEL_COLOR_IDLE, alpha: 0.9 })
          .stroke({ width: 2, color: 0x05070c, alpha: 0.6 });
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => {
          if (draggingPointerId !== null) return;
          draggingPointerId = pointer.id;
          isPointerDown = true;
          pointerX = pointer.x;
        },
        onPointerMove: (pointer) => {
          if (pointer.id !== draggingPointerId) return;
          pointerX = pointer.x;
        },
        onPointerUp: (pointer) => {
          if (pointer.id !== draggingPointerId) return;
          draggingPointerId = null;
          isPointerDown = false;
        },
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
          } else if (key === "r") {
            world.reset();
            setIsOver(false);
            setWavesSurvived(0);
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
      title="Tide Keep"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="tide-keep-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="tide-keep-canvas" />
        <div className={styles.hud}>
          <span className={styles.stat} data-testid="tide-keep-elapsed">
            経過 {elapsedSeconds}秒
          </span>
          <span className={styles.stat} data-testid="tide-keep-waves">
            波 {wavesSurvived}回突破
          </span>
          <div className={styles.integrityTrack} data-testid="tide-keep-integrity">
            <div
              className={styles.integrityFill}
              style={{ width: `${Math.round(keepIntegrity * 100)}%` }}
            />
          </div>
        </div>
        <div className={styles.hint}>
          ドラッグ/長押しで狙った場所に砂を盛り、中央の砦(明るい帯)を潮と波から守れ。
          矢印キー/A・Dでもショベルを動かせる。潮は徐々に満ち、波は次第に速く高くなる。 Space:
          一時停止 / R: リセット。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="tide-keep-gameover">
            <div className={styles.gameOverTitle}>砦が流された</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <div className={styles.gameOverSub}>
              生存 {elapsedSeconds}秒 / 波 {wavesSurvived}回突破
            </div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="tide-keep-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
