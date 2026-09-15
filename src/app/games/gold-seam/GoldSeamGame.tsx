"use client";

import { Application, Graphics } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import { GOLD_MAX, GoldSeamWorld } from "./engine/world";
import styles from "./GoldSeamGame.module.scss";

const PLATE_COLOR = 0xede3d3;
const PLATE_STROKE_COLOR = 0xb8a888;
const CRACK_COLOR = 0x4a4438;
const GOLD_CORE_COLOR = 0xf2c14e;
const GOLD_GLOW_COLOR = 0xffe066;
const FRONTIER_ON_PATH_COLOR = 0x7cf5c4;
const FRONTIER_OFF_PATH_COLOR = 0xff6b6b;

export function GoldSeamGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [gold, setGold] = useState(GOLD_MAX);
  const [progressPercent, setProgressPercent] = useState(0);
  const [bowlsCompleted, setBowlsCompleted] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<GoldSeamWorld | null>(null);
  const appRef = useRef<Application | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const frontierMarkerRef = useRef<HTMLSpanElement | null>(null);

  const handleTogglePause = useCallback(() => {
    if (!loopRef.current) return;
    setIsPaused(loopRef.current.togglePause());
  }, []);

  const handleRestart = useCallback(() => {
    worldRef.current?.reset();
    setIsOver(false);
    setBowlsCompleted(0);
    setProgressPercent(0);
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
    const world = new GoldSeamWorld(1, 1);
    worldRef.current = world;

    const plateGraphics = new Graphics();
    const crackGraphics = new Graphics();
    const goldGraphics = new Graphics();
    const frontierGraphics = new Graphics();

    let activePointerId: number | null = null;
    let isPointerDown = false;
    let pointerX = 0;
    let pointerY = 0;

    world.onBowlCompleted = () => {
      setBowlsCompleted(world.bowlsCompleted);
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x120f0a,
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
      app.stage.addChild(plateGraphics, crackGraphics, goldGraphics, frontierGraphics);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds, elapsedSeconds) => {
        world.setPointer(pointerX, pointerY, isPointerDown);
        world.step(deltaSeconds);

        setScore(world.score);
        setGold(world.gold);
        setProgressPercent(Math.round(world.progressRatio * 100));
        if (world.isOver) setIsOver(true);

        const plateRadius = Math.min(world.width, world.height) * 0.46;
        plateGraphics
          .clear()
          .circle(world.width / 2, world.height / 2, plateRadius)
          .fill({ color: PLATE_COLOR, alpha: 0.94 })
          .stroke({ width: 3, color: PLATE_STROKE_COLOR, alpha: 0.8 });

        const pathPoints = world.getPathPointsPx();
        crackGraphics.clear();
        if (pathPoints.length > 1) {
          crackGraphics.moveTo(pathPoints[0].x, pathPoints[0].y);
          for (const point of pathPoints.slice(1)) crackGraphics.lineTo(point.x, point.y);
          crackGraphics.stroke({ width: 3, color: CRACK_COLOR, alpha: 0.85 });
        }

        const filledPoints = world.getFilledPathPointsPx();
        goldGraphics.clear();
        if (filledPoints.length > 1) {
          goldGraphics.moveTo(filledPoints[0].x, filledPoints[0].y);
          for (const point of filledPoints.slice(1)) goldGraphics.lineTo(point.x, point.y);
          goldGraphics.stroke({ width: 10, color: GOLD_GLOW_COLOR, alpha: 0.3 });
          goldGraphics.moveTo(filledPoints[0].x, filledPoints[0].y);
          for (const point of filledPoints.slice(1)) goldGraphics.lineTo(point.x, point.y);
          goldGraphics.stroke({ width: 4, color: GOLD_CORE_COLOR, alpha: 0.95 });
        }

        const frontier = world.getFrontierPointPx();
        const distanceToFrontier = Math.hypot(pointerX - frontier.x, pointerY - frontier.y);
        const isNearFrontier = distanceToFrontier <= world.toleranceRadiusPx;
        // 操作していない間もキャンバスが静止画にならないよう、狙う地点の輪を常時脈動させる。
        const pulse = 0.5 + Math.sin(elapsedSeconds * 3.2) * 0.5;
        frontierGraphics
          .clear()
          .circle(frontier.x, frontier.y, world.toleranceRadiusPx * (0.85 + pulse * 0.25))
          .stroke({
            width: 2,
            color: isNearFrontier ? FRONTIER_ON_PATH_COLOR : FRONTIER_OFF_PATH_COLOR,
            alpha: (isPointerDown ? 0.75 : 0.35) + pulse * 0.2,
          })
          .circle(frontier.x, frontier.y, 5)
          .fill({
            color: isNearFrontier ? FRONTIER_ON_PATH_COLOR : FRONTIER_OFF_PATH_COLOR,
            alpha: 0.95,
          });

        if (frontierMarkerRef.current) {
          frontierMarkerRef.current.dataset.xRatio = String(
            world.width > 0 ? frontier.x / world.width : 0,
          );
          frontierMarkerRef.current.dataset.yRatio = String(
            world.height > 0 ? frontier.y / world.height : 0,
          );
        }
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => {
          if (activePointerId !== null) return;
          activePointerId = pointer.id;
          isPointerDown = true;
          pointerX = pointer.x;
          pointerY = pointer.y;
        },
        onPointerMove: (pointer) => {
          if (pointer.id !== activePointerId) return;
          pointerX = pointer.x;
          pointerY = pointer.y;
        },
        onPointerUp: (pointer) => {
          if (pointer.id !== activePointerId) return;
          activePointerId = null;
          isPointerDown = false;
        },
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
          } else if (key === "r") {
            world.reset();
            setIsOver(false);
            setBowlsCompleted(0);
            setProgressPercent(0);
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
      title="Gold Seam"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="gold-seam-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="gold-seam-canvas" />
        <div className={styles.hud}>
          <span className={styles.stat} data-testid="gold-seam-bowls">
            継いだ器 {bowlsCompleted}個
          </span>
          <span className={styles.stat} data-testid="gold-seam-progress">
            継ぎ目 {progressPercent}%
          </span>
          <div className={styles.goldTrack} data-testid="gold-seam-gold">
            <div className={styles.goldFill} style={{ width: `${Math.round(gold)}%` }} />
          </div>
        </div>
        {/* 画面には描かないが、なぞるべき先端(金の輪)の位置をステージ比率で保持する。
            キャンバス上の描画位置そのものはピクセル情報として読み取れないため、
            ストーリーテストが実際の画面操作(ドラッグ)で追従できるようにするための座標データ。 */}
        <span
          ref={frontierMarkerRef}
          className={styles.visuallyHidden}
          aria-hidden="true"
          data-testid="gold-seam-frontier"
        />
        <div className={styles.hint}>
          ひびの始点からポインタ(指/マウス)を離さずになぞり続けて金を継ごう。
          経路から外れると金粉が無駄になり、尽きると器は割れてしまう。 Space: 一時停止 / R:
          リセット。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="gold-seam-gameover">
            <div className={styles.gameOverTitle}>金が尽きた</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <div className={styles.gameOverSub}>継いだ器 {bowlsCompleted}個</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="gold-seam-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
