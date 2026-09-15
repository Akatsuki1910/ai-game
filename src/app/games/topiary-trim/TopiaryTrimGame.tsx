"use client";

import { Application, Graphics } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import { HEALTH_MAX, type Stem, TopiaryTrimWorld } from "./engine/world";
import styles from "./TopiaryTrimGame.module.scss";

const HEDGE_COLOR_NORMAL = 0x7cf5c4;
const HEDGE_COLOR_ESCAPED = 0xff6b6b;
const HEDGE_GLOW_COLOR = 0xffe066;
const BOUNDARY_COLOR = 0x6ee7ff;
const HUB_COLOR = 0x9aa0ac;
const SHEARS_COLOR = 0x6ee7ff;

export function TopiaryTrimGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [health, setHealth] = useState(HEALTH_MAX);
  const [coveragePercent, setCoveragePercent] = useState(0);
  const [prunes, setPrunes] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<TopiaryTrimWorld | null>(null);
  const appRef = useRef<Application | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const targetMarkerRef = useRef<HTMLSpanElement | null>(null);

  const handleTogglePause = useCallback(() => {
    if (!loopRef.current) return;
    setIsPaused(loopRef.current.togglePause());
  }, []);

  const handleRestart = useCallback(() => {
    worldRef.current?.reset();
    setIsOver(false);
    setPrunes(0);
    setCoveragePercent(0);
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
    const world = new TopiaryTrimWorld(1, 1);
    worldRef.current = world;

    const boundaryGraphics = new Graphics();
    const hedgeGraphics = new Graphics();
    const shearsGraphics = new Graphics();

    world.onStemPruned = () => {
      setPrunes(world.prunes);
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x0d140f,
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
      app.stage.addChild(boundaryGraphics, hedgeGraphics, shearsGraphics);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds, elapsedSeconds) => {
        if (input.isKeyDown("arrowleft") || input.isKeyDown("a")) {
          world.setShearsRotationInput(-1);
        } else if (input.isKeyDown("arrowright") || input.isKeyDown("d")) {
          world.setShearsRotationInput(1);
        } else {
          world.setShearsRotationInput(0);
        }

        world.step(deltaSeconds);

        setScore(world.score);
        setHealth(world.health);
        setCoveragePercent(Math.round(world.coverageRatio * 100));
        if (world.isOver) setIsOver(true);

        const centerX = world.width / 2;
        const centerY = world.height / 2;
        const boundaryRadiusPx = world.getBoundaryRadiusPx();
        const pulse = 0.5 + Math.sin(elapsedSeconds * 2.4) * 0.5;

        boundaryGraphics
          .clear()
          .circle(centerX, centerY, boundaryRadiusPx)
          .stroke({ width: 2, color: BOUNDARY_COLOR, alpha: 0.35 + pulse * 0.15 })
          .circle(centerX, centerY, 6)
          .fill({ color: HUB_COLOR, alpha: 0.8 });

        hedgeGraphics.clear();
        for (const stem of world.stems) {
          const tip = world.getStemTipPx(stem);
          const isEscaped = stem.length > 1;
          if (isEscaped) {
            hedgeGraphics
              .moveTo(centerX, centerY)
              .lineTo(tip.x, tip.y)
              .stroke({ width: 10, color: HEDGE_COLOR_ESCAPED, alpha: 0.25 + pulse * 0.2 });
          }
          hedgeGraphics
            .moveTo(centerX, centerY)
            .lineTo(tip.x, tip.y)
            .stroke({
              width: 5,
              color: isEscaped ? HEDGE_COLOR_ESCAPED : HEDGE_COLOR_NORMAL,
              alpha: 0.9,
            });
          hedgeGraphics
            .circle(tip.x, tip.y, 5)
            .fill({ color: isEscaped ? HEDGE_COLOR_ESCAPED : HEDGE_GLOW_COLOR, alpha: 0.9 });
        }

        const shearsPoint = world.getShearsPointPx();
        shearsGraphics
          .clear()
          .moveTo(centerX, centerY)
          .lineTo(shearsPoint.x, shearsPoint.y)
          .stroke({ width: 1, color: SHEARS_COLOR, alpha: 0.25 })
          .circle(shearsPoint.x, shearsPoint.y, 9)
          .stroke({ width: 2, color: SHEARS_COLOR, alpha: 0.85 });

        const mostEscaped: Stem | null = world.getMostEscapedStem();
        const markerStem = mostEscaped ?? findStemNearestToEscape(world.stems);
        if (targetMarkerRef.current && world.width > 0 && world.height > 0) {
          const markerTip = world.getStemTipPx(markerStem);
          targetMarkerRef.current.dataset.hasEscaped = String(mostEscaped !== null);
          targetMarkerRef.current.dataset.xRatio = String(markerTip.x / world.width);
          targetMarkerRef.current.dataset.yRatio = String(markerTip.y / world.height);
        }
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => {
          if (loop.isPaused) return;
          const angle = Math.atan2(pointer.y - world.height / 2, pointer.x - world.width / 2);
          world.shearsAngle = angle;
          world.pruneAtAngle(angle);
        },
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
          } else if (key === "r") {
            world.reset();
            setIsOver(false);
            setPrunes(0);
            setCoveragePercent(0);
          } else if (key === "enter" && !loop.isPaused) {
            world.pruneAtShears();
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
      title="Topiary Trim"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="topiary-trim-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="topiary-trim-canvas" />
        <div className={styles.hud}>
          <span className={styles.stat} data-testid="topiary-trim-coverage">
            充填率 {coveragePercent}%
          </span>
          <span className={styles.stat} data-testid="topiary-trim-prunes">
            剪定 {prunes}回
          </span>
          <div className={styles.healthTrack} data-testid="topiary-trim-health">
            <div
              className={styles.healthFill}
              style={{ width: `${Math.round((health / HEALTH_MAX) * 100)}%` }}
            />
          </div>
        </div>
        {/* 画面には描かないが、最もはみ出している枝(無ければ最も伸びている枝)の
            先端位置をステージ比率で保持する。キャンバス上の描画位置はピクセル情報
            として読み取れないため、ストーリーテストが実際の画面操作(タップ)で
            狙う位置を求められるようにするための座標データ。 */}
        <span
          ref={targetMarkerRef}
          className={styles.visuallyHidden}
          aria-hidden="true"
          data-testid="topiary-trim-target"
        />
        <div className={styles.hint}>
          目標のシルエット(円)からはみ出した枝をタップ/クリックして剪定しよう。
          放置して折れると体力が減る。矢印キー/AD: シアーを回転 / Enter: シアーの位置で剪定 / Space:
          一時停止 / R: リセット。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="topiary-trim-gameover">
            <div className={styles.gameOverTitle}>トピアリーが崩れた</div>
            <div className={styles.gameOverScore}>
              SCORE {Math.floor(score).toLocaleString("ja-JP")}
            </div>
            <div className={styles.gameOverSub}>剪定 {prunes}回</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="topiary-trim-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}

function findStemNearestToEscape(stems: readonly Stem[]): Stem {
  let best = stems[0];
  for (const stem of stems) {
    if (stem.length > best.length) best = stem;
  }
  return best;
}
