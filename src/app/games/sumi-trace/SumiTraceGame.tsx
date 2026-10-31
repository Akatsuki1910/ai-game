"use client";

import { Application, Graphics } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import { START_LIVES, SumiTraceWorld } from "./engine/world";
import styles from "./SumiTraceGame.module.scss";

const PAPER_COLOR = 0xf3ead9;
const GUIDE_CORRIDOR_COLOR = 0xc9b896;
const GUIDE_LINE_COLOR = 0xa98f63;
const INK_COLOR = 0x1c1a18;
const INK_SMUDGE_COLOR = 0xc0392b;
const MARKER_COLOR = 0xb8450c;

export function SumiTraceGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(START_LIVES);
  const [combo, setCombo] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<SumiTraceWorld | null>(null);
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
    setLives(START_LIVES);
    setCombo(0);
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
    const world = new SumiTraceWorld(1, 1);
    worldRef.current = world;

    const backgroundGraphics = new Graphics();
    const corridorGraphics = new Graphics();
    const inkGraphics = new Graphics();
    const markerGraphics = new Graphics();
    let drawnBackgroundWidth = -1;
    let drawnBackgroundHeight = -1;
    let renderedStroke: SumiTraceWorld["stroke"] | null = null;
    let pulsePhase = 0;

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: PAPER_COLOR,
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
      app.stage.addChild(backgroundGraphics, corridorGraphics, inkGraphics, markerGraphics);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        world.step(deltaSeconds);
        setScore(world.score);
        setLives(world.lives);
        setCombo(world.combo);
        if (world.isOver) setIsOver(true);

        pulsePhase += deltaSeconds;

        if (drawnBackgroundWidth !== world.width || drawnBackgroundHeight !== world.height) {
          drawnBackgroundWidth = world.width;
          drawnBackgroundHeight = world.height;
          backgroundGraphics
            .clear()
            .rect(0, 0, world.width, world.height)
            .fill({ color: PAPER_COLOR });
        }

        if (renderedStroke !== world.stroke) {
          renderedStroke = world.stroke;
          corridorGraphics.clear();
          const [first, ...rest] = world.stroke.points;
          if (first) {
            corridorGraphics.moveTo(first.x, first.y);
            for (const point of rest) corridorGraphics.lineTo(point.x, point.y);
            corridorGraphics.stroke({
              width: world.stroke.toleranceRadius * 2,
              color: GUIDE_CORRIDOR_COLOR,
              alpha: 0.45,
              cap: "round",
              join: "round",
            });
            corridorGraphics.moveTo(first.x, first.y);
            for (const point of rest) corridorGraphics.lineTo(point.x, point.y);
            corridorGraphics.stroke({
              width: 2,
              color: GUIDE_LINE_COLOR,
              alpha: 0.8,
              cap: "round",
              join: "round",
            });
          }
        }

        const traced = world.tracedPoints;
        inkGraphics.clear();
        if (traced.length > 0) {
          inkGraphics.moveTo(traced[0].x, traced[0].y);
          for (let i = 1; i < traced.length; i++) inkGraphics.lineTo(traced[i].x, traced[i].y);
          inkGraphics.stroke({
            width: 9,
            color: world.isPointerOffPath ? INK_SMUDGE_COLOR : INK_COLOR,
            alpha: 0.9,
            cap: "round",
            join: "round",
          });
        }

        const frontier = world.frontierPoint;
        const pulse = 1 + Math.sin(pulsePhase * 4) * 0.18;
        markerGraphics
          .clear()
          .circle(frontier.x, frontier.y, 9 * pulse)
          .fill({ color: MARKER_COLOR, alpha: world.isDrawing ? 0.9 : 0.55 })
          .circle(frontier.x, frontier.y, world.stroke.toleranceRadius)
          .stroke({ width: 1.5, color: MARKER_COLOR, alpha: 0.25 });
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => {
          if (loopRef.current?.isPaused) return;
          world.startPointer(pointer.x, pointer.y);
        },
        onPointerMove: (pointer) => {
          if (loopRef.current?.isPaused) return;
          world.movePointer(pointer.x, pointer.y);
        },
        onPointerUp: () => {
          if (loopRef.current?.isPaused) return;
          world.endPointer();
        },
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
          } else if (key === "r") {
            world.reset();
            setIsOver(false);
            setScore(0);
            setLives(START_LIVES);
            setCombo(0);
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
      title="Sumi Trace"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
      pauseHint="タップ / Space キーで再開"
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="sumi-trace-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="sumi-trace-canvas" />
        <div className={styles.hud}>
          <div className={styles.lives} data-testid="sumi-trace-lives">
            {Array.from({ length: START_LIVES }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 固定数の残機アイコンで並び順も変わらない
              <span key={i} className={i < lives ? styles.liveDrop : styles.spentDrop}>
                墨
              </span>
            ))}
            <span className={styles.livesCount} data-testid="sumi-trace-lives-count">
              残り{lives}
            </span>
          </div>
          {combo > 1 && (
            <div className={styles.combo} data-testid="sumi-trace-combo">
              連続{combo}画
            </div>
          )}
        </div>
        <div className={styles.hint}>
          朱色の点（筆の起点）から灰色のガイドをなぞって終点まで引く。外れると墨がかすれ、
          粘ると1回分の残機を失う。時間をかけすぎても同様。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="sumi-trace-gameover">
            <div className={styles.gameOverTitle}>筆を置く</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="sumi-trace-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
