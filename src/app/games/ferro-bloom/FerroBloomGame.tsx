"use client";

import { Application, Graphics } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import { FerroBloomWorld, type MagnetMode, ROUND_SECONDS } from "./engine/world";
import styles from "./FerroBloomGame.module.scss";

const MAGNET_KEY_SPEED = 480; // px/秒。キーボードで磁石を動かす速さ
const TAP_MAX_DRAG_DISTANCE = 6;
const PARTICLE_RADIUS = 5;

const MAGNET_COLORS = {
  attract: 0x6ee7ff,
  repel: 0xff6b6b,
} as const satisfies Record<MagnetMode, number>;

const PARTICLE_COLOR_INSIDE = 0x7cf5c4;
const PARTICLE_COLOR_OUTSIDE = 0xaab4c8;

export function FerroBloomGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(ROUND_SECONDS);
  const [holdProgress, setHoldProgress] = useState(0);
  const [magnetMode, setMagnetMode] = useState<MagnetMode>("attract");
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const targetMarkerRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<FerroBloomWorld | null>(null);
  const appRef = useRef<Application | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);

  const handleTogglePause = useCallback(() => {
    if (!loopRef.current) return;
    setIsPaused(loopRef.current.togglePause());
  }, []);

  const handleToggleMode = useCallback(() => {
    worldRef.current?.cycleMagnetMode();
  }, []);

  const handleRestart = useCallback(() => {
    worldRef.current?.reset();
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
    const world = new FerroBloomWorld(1, 1);
    worldRef.current = world;

    const targetGraphics = new Graphics();
    const particleGraphics = new Graphics();
    const magnetGraphics = new Graphics();

    let draggingPointerId: number | null = null;
    let isPointerDown = false;
    let pointerX = 0;
    let pointerY = 0;

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x0b0c10,
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
      app.stage.addChild(targetGraphics, particleGraphics, magnetGraphics);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        let magnetDrivenByPointer = false;
        if (isPointerDown) {
          world.setMagnetPosition(pointerX, pointerY);
          world.setMagnetActive(true);
          magnetDrivenByPointer = true;
        }

        if (!magnetDrivenByPointer) {
          let kx = 0;
          let ky = 0;
          if (input.isKeyDown("arrowleft") || input.isKeyDown("a")) kx -= 1;
          if (input.isKeyDown("arrowright") || input.isKeyDown("d")) kx += 1;
          if (input.isKeyDown("arrowup") || input.isKeyDown("w")) ky -= 1;
          if (input.isKeyDown("arrowdown") || input.isKeyDown("s")) ky += 1;

          if (kx !== 0 || ky !== 0) {
            const length = Math.hypot(kx, ky) || 1;
            world.moveMagnetBy(
              (kx / length) * MAGNET_KEY_SPEED * deltaSeconds,
              (ky / length) * MAGNET_KEY_SPEED * deltaSeconds,
            );
            world.setMagnetActive(true);
          } else {
            world.setMagnetActive(false);
          }
        }

        world.step(deltaSeconds);
        setScore(Math.floor(world.score));
        setCombo(world.combo);
        setTimeRemaining(Math.ceil(world.timeRemaining));
        setHoldProgress(world.holdProgress);
        setMagnetMode(world.magnet.mode);
        if (world.isOver) setIsOver(true);

        const pulse = 0.5 + Math.sin(performance.now() / 260) * 0.2;
        targetGraphics
          .clear()
          .circle(world.target.x, world.target.y, world.target.radius)
          .stroke({
            width: 3,
            color: world.holdProgress > 0 ? 0xffe066 : 0x6ee7ff,
            alpha: Math.max(pulse, world.holdProgress),
          });

        particleGraphics.clear();
        for (const particle of world.particles) {
          const isInsideTarget =
            Math.hypot(particle.x - world.target.x, particle.y - world.target.y) <=
            world.target.radius;
          particleGraphics.circle(particle.x, particle.y, PARTICLE_RADIUS).fill({
            color: isInsideTarget ? PARTICLE_COLOR_INSIDE : PARTICLE_COLOR_OUTSIDE,
            alpha: 0.9,
          });
        }

        magnetGraphics.clear();
        const magnetColor = MAGNET_COLORS[world.magnet.mode];
        const magnetRadius = world.magnet.isActive ? 16 : 9;
        magnetGraphics
          .circle(world.magnet.x, world.magnet.y, magnetRadius)
          .stroke({ width: 3, color: magnetColor, alpha: world.magnet.isActive ? 0.9 : 0.35 });
        magnetGraphics
          .circle(world.magnet.x, world.magnet.y, 3)
          .fill({ color: magnetColor, alpha: world.magnet.isActive ? 1 : 0.5 });

        // ターゲット中心を示す薄いドット。canvas座標とCSS座標が一致するため、
        // このDOM要素のgetBoundingClientRectでターゲット位置をそのまま特定でき、
        // 精密な照準の目印とストーリーテストの両方に使える。
        if (targetMarkerRef.current) {
          targetMarkerRef.current.style.left = `${world.target.x}px`;
          targetMarkerRef.current.style.top = `${world.target.y}px`;
        }
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => {
          if (draggingPointerId !== null) return;
          draggingPointerId = pointer.id;
          isPointerDown = true;
          pointerX = pointer.x;
          pointerY = pointer.y;
        },
        onPointerMove: (pointer) => {
          if (pointer.id !== draggingPointerId) return;
          pointerX = pointer.x;
          pointerY = pointer.y;
        },
        onPointerUp: (pointer) => {
          if (pointer.id !== draggingPointerId) return;
          const dragDistance = Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY);
          if (dragDistance < TAP_MAX_DRAG_DISTANCE) world.cycleMagnetMode();
          draggingPointerId = null;
          isPointerDown = false;
        },
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
          } else if (key === "r") {
            world.reset();
            setIsOver(false);
          } else if (key === "1") {
            world.setMagnetMode("attract");
          } else if (key === "2") {
            world.setMagnetMode("repel");
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
      title="Ferro Bloom"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="ferro-bloom-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="ferro-bloom-canvas" />
        <div
          ref={targetMarkerRef}
          className={styles.targetMarker}
          data-testid="ferro-bloom-target-marker"
        />
        <button
          type="button"
          className={
            magnetMode === "attract"
              ? `${styles.modeToggle} ${styles.modeToggleAttract}`
              : `${styles.modeToggle} ${styles.modeToggleRepel}`
          }
          onClick={handleToggleMode}
          aria-pressed={magnetMode === "repel"}
          data-testid="ferro-bloom-mode"
        >
          {magnetMode === "attract" ? "⊕ 引力" : "⊖ 斥力"}
        </button>
        <div className={styles.hud}>
          <span className={styles.combo} data-testid="ferro-bloom-combo">
            COMBO {combo}
          </span>
          <span className={styles.timer} data-testid="ferro-bloom-timer">
            ⏱ {timeRemaining}s
          </span>
          <div className={styles.progressTrack} data-testid="ferro-bloom-progress">
            <div
              className={styles.progressFill}
              style={{ width: `${Math.round(holdProgress * 100)}%` }}
            />
          </div>
        </div>
        <div className={styles.hint}>
          ドラッグ/長押しで磁石を動かし、砂鉄をリングへ集めて満たそう。タップ
          （またはボタン/数字キー1・2）で引力⇔斥力を切替。移動は矢印キー/WASDでも可能。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="ferro-bloom-gameover">
            <div className={styles.gameOverTitle}>ラウンド終了</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="ferro-bloom-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
