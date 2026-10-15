"use client";

import { Application, Graphics } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import {
  ALERT_RADIUS,
  FALCON_RADIUS,
  PREY_RADIUS,
  RIVAL_RADIUS,
  STAMINA_MAX,
  TalonDiveWorld,
} from "./engine/world";
import styles from "./TalonDiveGame.module.scss";

const KEY_THRUST_OFFSET = 60; // px。キーボード操作時、隼の進みたい向きに置く仮の狙点との距離
const FALCON_COLOR = 0xf2e6c8;
const FALCON_ALERT_COLOR = 0x7cf5c4;
const PREY_COLOR = 0x9aa0ac;
const PREY_FLEEING_COLOR = 0xffb454;
const RIVAL_COLOR = 0xff6b6b;
const PERCH_COLOR = 0x6ee7ff;

export function TalonDiveGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [stamina, setStamina] = useState(STAMINA_MAX);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const falconMarkerRef = useRef<HTMLDivElement | null>(null);
  const perchMarkerRef = useRef<HTMLDivElement | null>(null);
  const rivalMarkerRef = useRef<HTMLDivElement | null>(null);
  const preyMarkerRefs = useRef<Array<HTMLDivElement | null>>([]);
  const worldRef = useRef<TalonDiveWorld | null>(null);
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
    const world = new TalonDiveWorld(1, 1);
    worldRef.current = world;

    const perchGraphics = new Graphics();
    const preyGraphics = new Graphics();
    const rivalGraphics = new Graphics();
    const falconGraphics = new Graphics();

    let draggingPointerId: number | null = null;
    let isPointerDown = false;
    let pointerX = 0;
    let pointerY = 0;

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x120e08,
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
      app.stage.addChild(perchGraphics, preyGraphics, rivalGraphics, falconGraphics);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        let steeringByPointer = false;
        if (isPointerDown) {
          world.setSteerTarget(pointerX, pointerY);
          world.setSteering(true);
          steeringByPointer = true;
        }

        if (!steeringByPointer) {
          let kx = 0;
          let ky = 0;
          if (input.isKeyDown("arrowleft") || input.isKeyDown("a")) kx -= 1;
          if (input.isKeyDown("arrowright") || input.isKeyDown("d")) kx += 1;
          if (input.isKeyDown("arrowup") || input.isKeyDown("w")) ky -= 1;
          if (input.isKeyDown("arrowdown") || input.isKeyDown("s")) ky += 1;

          if (kx !== 0 || ky !== 0) {
            const length = Math.hypot(kx, ky) || 1;
            world.setSteerTarget(
              world.falcon.x + (kx / length) * KEY_THRUST_OFFSET,
              world.falcon.y + (ky / length) * KEY_THRUST_OFFSET,
            );
            world.setSteering(true);
          } else {
            world.setSteering(false);
          }
        }

        world.step(deltaSeconds);
        setScore(Math.floor(world.score));
        setStreak(world.streak);
        setStamina(world.stamina);
        if (world.isOver) setIsOver(true);

        const perchPulse = 0.4 + Math.sin(performance.now() / 400) * 0.15;
        perchGraphics
          .clear()
          .circle(world.perch.x, world.perch.y, world.perch.radius)
          .stroke({ width: 3, color: PERCH_COLOR, alpha: perchPulse });

        preyGraphics.clear();
        for (const p of world.prey) {
          const isFleeing = Math.hypot(p.x - world.falcon.x, p.y - world.falcon.y) < ALERT_RADIUS;
          preyGraphics
            .circle(p.x, p.y, PREY_RADIUS)
            .fill({ color: isFleeing ? PREY_FLEEING_COLOR : PREY_COLOR, alpha: 0.9 });
        }

        rivalGraphics
          .clear()
          .circle(world.rival.x, world.rival.y, RIVAL_RADIUS)
          .fill({ color: RIVAL_COLOR, alpha: 0.85 })
          .circle(world.rival.x, world.rival.y, RIVAL_RADIUS + 5)
          .stroke({ width: 2, color: RIVAL_COLOR, alpha: 0.4 });

        const heading = Math.atan2(world.falcon.vy, world.falcon.vx);
        const isAlerted = world.prey.some(
          (p) => Math.hypot(p.x - world.falcon.x, p.y - world.falcon.y) < ALERT_RADIUS,
        );
        falconGraphics.clear();
        const tipX = world.falcon.x + Math.cos(heading) * FALCON_RADIUS * 1.4;
        const tipY = world.falcon.y + Math.sin(heading) * FALCON_RADIUS * 1.4;
        const backX = world.falcon.x - Math.cos(heading) * FALCON_RADIUS;
        const backY = world.falcon.y - Math.sin(heading) * FALCON_RADIUS;
        const leftX = backX + Math.cos(heading + Math.PI / 2) * FALCON_RADIUS * 0.8;
        const leftY = backY + Math.sin(heading + Math.PI / 2) * FALCON_RADIUS * 0.8;
        const rightX = backX + Math.cos(heading - Math.PI / 2) * FALCON_RADIUS * 0.8;
        const rightY = backY + Math.sin(heading - Math.PI / 2) * FALCON_RADIUS * 0.8;
        falconGraphics
          .poly([tipX, tipY, leftX, leftY, rightX, rightY])
          .fill({ color: isAlerted ? FALCON_ALERT_COLOR : FALCON_COLOR, alpha: 0.95 });

        // canvas座標とCSS座標が一致するため、DOM要素のgetBoundingClientRectで
        // 各要素の実座標をそのまま特定でき、精密な操作とストーリーテストの両方に使える。
        if (falconMarkerRef.current) {
          falconMarkerRef.current.style.left = `${world.falcon.x}px`;
          falconMarkerRef.current.style.top = `${world.falcon.y}px`;
        }
        if (perchMarkerRef.current) {
          perchMarkerRef.current.style.left = `${world.perch.x}px`;
          perchMarkerRef.current.style.top = `${world.perch.y}px`;
        }
        if (rivalMarkerRef.current) {
          rivalMarkerRef.current.style.left = `${world.rival.x}px`;
          rivalMarkerRef.current.style.top = `${world.rival.y}px`;
        }
        world.prey.forEach((p, i) => {
          const marker = preyMarkerRefs.current[i];
          if (!marker) return;
          marker.style.left = `${p.x}px`;
          marker.style.top = `${p.y}px`;
        });
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
          draggingPointerId = null;
          isPointerDown = false;
        },
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
          } else if (key === "r") {
            world.reset();
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
    if (size.width === 0 || size.height === 0) return;
    worldRef.current?.resize(size.width, size.height);
  }, [size.width, size.height]);

  return (
    <GameShell
      title="Talon Dive"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="talon-dive-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="talon-dive-canvas" />
        <div
          ref={perchMarkerRef}
          className={styles.perchMarker}
          data-testid="talon-dive-perch-marker"
        />
        <div
          ref={falconMarkerRef}
          className={styles.falconMarker}
          data-testid="talon-dive-falcon-marker"
        />
        <div
          ref={rivalMarkerRef}
          className={styles.rivalMarker}
          data-testid="talon-dive-rival-marker"
        />
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            ref={(el) => {
              preyMarkerRefs.current[i] = el;
            }}
            className={styles.preyMarker}
            data-testid={`talon-dive-prey-marker-${i}`}
          />
        ))}
        <div className={styles.hud}>
          <span className={styles.streak} data-testid="talon-dive-streak">
            STREAK {streak}
          </span>
          <div className={styles.staminaBar} data-testid="talon-dive-stamina">
            <div
              className={styles.staminaFill}
              style={{ width: `${Math.max(0, Math.min(100, (stamina / STAMINA_MAX) * 100))}%` }}
            />
          </div>
        </div>
        <div className={styles.hint}>
          ドラッグ/長押しした方向へ隼が滑空する。獲物(灰色)を仕留めてスコアを稼ごう。巣(水色の輪)の外にいる間はスタミナが減り続け、中にいると回復する。ライバル(赤)に先を越されるとストリークが切れる。矢印キー/WASDでも操作可能。Space:
          一時停止 / R: リセット
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="talon-dive-gameover">
            <div className={styles.gameOverTitle}>力尽きた</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="talon-dive-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
