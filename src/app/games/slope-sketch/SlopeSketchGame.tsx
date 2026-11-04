"use client";

import { Application, Graphics } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import {
  BALL_SCREEN_X_RATIO,
  bucketToScreenX,
  CHALK_MAX,
  SlopeSketchWorld,
  VISIBLE_BUCKETS,
} from "./engine/world";
import styles from "./SlopeSketchGame.module.scss";

const BALL_RADIUS_RATIO = 0.016;
const KEY_BRUSH_SPEED = 0.9; // frac/秒
const KEY_BRUSH_LOOKAHEAD_BUCKETS = 3;
const DEFAULT_BRUSH_HEIGHT_FRAC = 0.62;

export function SlopeSketchGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [chalkPercent, setChalkPercent] = useState(100);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<SlopeSketchWorld | null>(null);
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
    setScore(0);
    setChalkPercent(100);
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
    const world = new SlopeSketchWorld(1, 1);
    worldRef.current = world;

    const terrainGraphics = new Graphics();
    const hazardGraphics = new Graphics();
    const gemGraphics = new Graphics();
    const ballGraphics = new Graphics();

    let paintingPointerId: number | null = null;
    let keyBrushHeightFrac = DEFAULT_BRUSH_HEIGHT_FRAC;
    let keyPaintWasActive = false;

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x090b10,
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
      app.stage.addChild(terrainGraphics, hazardGraphics, gemGraphics, ballGraphics);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        world.step(deltaSeconds);
        setScore(Math.floor(world.score));
        setChalkPercent(Math.round((world.chalkRemaining / CHALK_MAX) * 100));
        if (world.isOver) setIsOver(true);

        const bucketWidth = world.width / VISIBLE_BUCKETS;

        const keyPaintUp = input.isKeyDown("arrowup") || input.isKeyDown("w");
        const keyPaintDown = input.isKeyDown("arrowdown") || input.isKeyDown("s");
        if (keyPaintUp || keyPaintDown) {
          if (keyPaintUp) keyBrushHeightFrac -= KEY_BRUSH_SPEED * deltaSeconds;
          if (keyPaintDown) keyBrushHeightFrac += KEY_BRUSH_SPEED * deltaSeconds;
          keyBrushHeightFrac = Math.min(1, Math.max(0, keyBrushHeightFrac));
          const screenX =
            BALL_SCREEN_X_RATIO * world.width + bucketWidth * KEY_BRUSH_LOOKAHEAD_BUCKETS;
          world.paint(screenX, keyBrushHeightFrac * world.height);
          keyPaintWasActive = true;
        } else if (keyPaintWasActive) {
          world.endStroke();
          keyPaintWasActive = false;
        }

        terrainGraphics.clear();
        const startBucket = Math.floor(world.scrollBuckets) - 1;
        for (let i = 0; i <= VISIBLE_BUCKETS + 1; i++) {
          const bucket = startBucket + i;
          const height = world.getTerrainHeightAt(bucket);
          if (height === null) continue;
          const x = bucketToScreenX(world, bucket);
          const y = height * world.height;
          terrainGraphics
            .rect(x, y, bucketWidth + 1, world.height - y)
            .fill({ color: 0xf2f3f5, alpha: 0.9 });
          terrainGraphics.rect(x, y, bucketWidth + 1, 3).fill({ color: 0x7cf5c4, alpha: 0.9 });
        }

        hazardGraphics.clear();
        for (const hazard of world.hazards) {
          const x = bucketToScreenX(world, hazard.bucket);
          if (x < -bucketWidth || x > world.width + bucketWidth) continue;
          const top = hazard.fromFrac * world.height;
          const bottom = hazard.toFrac * world.height;
          hazardGraphics
            .moveTo(x + bucketWidth / 2, top)
            .lineTo(x + bucketWidth, bottom)
            .lineTo(x, bottom)
            .closePath()
            .fill({ color: 0xff6b6b, alpha: 0.9 });
        }

        gemGraphics.clear();
        for (const gem of world.gems) {
          if (gem.isCollected) continue;
          const x = bucketToScreenX(world, gem.bucket) + bucketWidth / 2;
          if (x < -bucketWidth || x > world.width + bucketWidth) continue;
          const y = gem.heightFrac * world.height;
          gemGraphics
            .circle(x, y, Math.max(6, bucketWidth * 0.3))
            .fill({ color: 0xffe066, alpha: 0.95 })
            .stroke({ width: 2, color: 0xffffff, alpha: 0.6 });
        }

        ballGraphics.clear();
        const ballRadius = Math.max(8, world.width * BALL_RADIUS_RATIO);
        ballGraphics
          .circle(BALL_SCREEN_X_RATIO * world.width, world.ball.yFrac * world.height, ballRadius)
          .fill({ color: 0x6ee7ff, alpha: 0.95 })
          .stroke({ width: 2, color: 0xffffff, alpha: 0.7 });
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => {
          if (paintingPointerId !== null) return;
          paintingPointerId = pointer.id;
          world.paint(pointer.x, pointer.y);
        },
        onPointerMove: (pointer) => {
          if (pointer.id !== paintingPointerId) return;
          world.paint(pointer.x, pointer.y);
        },
        onPointerUp: (pointer) => {
          if (pointer.id !== paintingPointerId) return;
          paintingPointerId = null;
          world.endStroke();
        },
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
          } else if (key === "r") {
            world.reset();
            setIsOver(false);
            setScore(0);
            setChalkPercent(100);
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
      title="Slope Sketch"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="slope-sketch-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="slope-sketch-canvas" />
        <div className={styles.hud}>
          <div className={styles.chalkGauge} data-testid="slope-sketch-chalk">
            CHALK {chalkPercent}%
            <div className={styles.chalkBarTrack}>
              <div className={styles.chalkBarFill} style={{ width: `${chalkPercent}%` }} />
            </div>
          </div>
        </div>
        <div className={styles.hint}>
          ドラッグでボールの先に地面を描いて支えよう。宝石は加点、トゲに当たると終了。チョークは
          使うと減り、描かない間に回復する。 ↑↓・WS: 高さを調整しながら前方に描画 / Space: 一時停止
          / R: リセット
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="slope-sketch-gameover">
            <div className={styles.gameOverTitle}>滑落...</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="slope-sketch-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
