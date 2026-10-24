"use client";

import { Application, Graphics } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import { LIVES_MAX, MothLanternWorld } from "./engine/world";
import styles from "./MothLanternGame.module.scss";

export function MothLanternGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [delivered, setDelivered] = useState(0);
  const [lives, setLives] = useState(LIVES_MAX);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<MothLanternWorld | null>(null);
  const appRef = useRef<Application | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const isPointerActiveRef = useRef(false);

  const handleTogglePause = useCallback(() => {
    if (!loopRef.current) return;
    setIsPaused(loopRef.current.togglePause());
  }, []);

  const handleRestart = useCallback(() => {
    worldRef.current?.reset();
    setIsOver(false);
    setScore(0);
    setDelivered(0);
    setLives(LIVES_MAX);
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
    const world = new MothLanternWorld(1, 1);
    worldRef.current = world;

    const backgroundGraphics = new Graphics();
    const shrineGraphics = new Graphics();
    const lanternGlowGraphics = new Graphics();
    const wispGraphics = new Graphics();
    const mothGraphics = new Graphics();
    const lanternGraphics = new Graphics();
    let drawnBackgroundWidth = -1;
    let drawnBackgroundHeight = -1;

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x05050a,
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
        backgroundGraphics,
        shrineGraphics,
        lanternGlowGraphics,
        wispGraphics,
        mothGraphics,
        lanternGraphics,
      );
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        const left = input.isKeyDown("arrowleft") || input.isKeyDown("a");
        const right = input.isKeyDown("arrowright") || input.isKeyDown("d");
        const up = input.isKeyDown("arrowup") || input.isKeyDown("w");
        const down = input.isKeyDown("arrowdown") || input.isKeyDown("s");
        world.setKeyboardDirection((right ? 1 : 0) - (left ? 1 : 0), (down ? 1 : 0) - (up ? 1 : 0));

        world.step(deltaSeconds);

        setScore(world.score);
        setDelivered(world.delivered);
        setLives(world.lives);
        if (world.isOver) setIsOver(true);

        if (drawnBackgroundWidth !== world.width || drawnBackgroundHeight !== world.height) {
          drawnBackgroundWidth = world.width;
          drawnBackgroundHeight = world.height;
          backgroundGraphics
            .clear()
            .rect(0, 0, world.width, world.height)
            .fill({ color: 0x0a0d16 });
          shrineGraphics
            .clear()
            .circle(world.shrineX, world.shrineY, world.shrineRadius)
            .fill({ color: 0xffdf8c, alpha: 0.18 })
            .circle(world.shrineX, world.shrineY, world.shrineRadius * 0.55)
            .fill({ color: 0xffdf8c, alpha: 0.35 })
            .stroke({ width: 2, color: 0xffdf8c, alpha: 0.6 });
        }

        lanternGlowGraphics
          .clear()
          .circle(world.lantern.x, world.lantern.y, world.lanternLightRadius)
          .fill({ color: 0xfff3c4, alpha: 0.14 });

        wispGraphics.clear();
        for (const wisp of world.wisps) {
          wispGraphics
            .circle(wisp.x, wisp.y, world.wispRadius)
            .fill({ color: 0x7c3aed, alpha: 0.85 })
            .circle(wisp.x, wisp.y, world.wispRadius * 0.45)
            .fill({ color: 0xd9b3ff, alpha: 0.9 });
        }

        mothGraphics.clear();
        for (const moth of world.moths) {
          const color = moth.isGuided ? 0xfff3c4 : 0x5b6472;
          const alpha = moth.isLit ? 1 : moth.isGuided ? 0.9 : 0.75;
          mothGraphics.circle(moth.x, moth.y, world.mothRadius).fill({ color, alpha });
        }

        lanternGraphics
          .clear()
          .circle(world.lantern.x, world.lantern.y, world.lanternMarkerRadius)
          .fill({ color: 0xffb454, alpha: 0.95 })
          .stroke({ width: 2, color: 0xfff3c4, alpha: 0.8 });
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => {
          isPointerActiveRef.current = true;
          world.setMoveTarget(pointer.x, pointer.y);
        },
        onPointerMove: (pointer) => {
          if (isPointerActiveRef.current) world.setMoveTarget(pointer.x, pointer.y);
        },
        onPointerUp: () => {
          isPointerActiveRef.current = false;
          world.clearMoveTarget();
        },
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
            return;
          }
          if (key === "r") {
            world.reset();
            setIsOver(false);
            setScore(0);
            setDelivered(0);
            setLives(LIVES_MAX);
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
      title="Moth Lantern"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="moth-lantern-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="moth-lantern-canvas" />
        <div className={styles.hud}>
          <div className={styles.statRow} data-testid="moth-lantern-delivered">
            届けた蛾 {delivered}
          </div>
          <div className={styles.statRow} data-testid="moth-lantern-lives" data-lives={lives}>
            ライフ {"●".repeat(lives)}
            {"○".repeat(Math.max(0, LIVES_MAX - lives))}
          </div>
        </div>
        <div className={styles.hint}>
          ドラッグ/長押しでランタンを移動。光の輪に入った蛾だけが祠へ進む。光が離れた蛾は闇をうろつき、やがて迷うか鬼火に捕まる。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="moth-lantern-gameover">
            <div className={styles.gameOverTitle}>夜が明けた…</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="moth-lantern-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
