"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import { OrbitSlingWorld } from "./engine/world";
import styles from "./OrbitSlingGame.module.scss";

interface FloatingScore {
  text: Text;
  age: number;
}

const POPUP_LIFETIME = 0.9;
const MIN_LAUNCH_DRAG = 14;
const KEY_ROTATE_SPEED = 2.6; // rad/秒
const KEY_POWER_SPEED = 1.1; // /秒
const DEFAULT_AIM_ANGLE = (-58 * Math.PI) / 180;

export function OrbitSlingGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const canvasHostRef = useRef<HTMLDivElement | null>(null);

  const worldRef = useRef<OrbitSlingWorld | null>(null);
  const appRef = useRef<Application | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);

  const [score, setScore] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(75);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    let disposed = false;

    const app = new Application();
    const world = new OrbitSlingWorld(1, 1);
    worldRef.current = world;

    const planetGraphics = new Graphics();
    const ringGraphics = new Graphics();
    const padGraphics = new Graphics();
    const trailGraphics = new Graphics();
    const ballGraphics = new Graphics();
    const aimGraphics = new Graphics();
    const popupContainer = new Container();
    const floatingScores: FloatingScore[] = [];

    // ポインターでの照準操作の状態。キーボード操作と同じ aimAngle/aimPower を共有し、
    // 常に「今の狙い」が単一の状態として preview 描画にも発射にも使われるようにする。
    let aimAngle = DEFAULT_AIM_ANGLE;
    let aimPower = 0.6;
    let pointerAimId: number | null = null;
    let pointerAnchor = { x: 0, y: 0 };

    world.onRingHit = ({ points, combo, ring }) => {
      const label = combo > 0 ? `+${points} COMBO x${combo + 1}` : `+${points}`;
      const text = new Text({
        text: label,
        style: { fill: 0xffe066, fontSize: 18, fontWeight: "700" },
      });
      text.anchor.set(0.5, 1);
      text.position.set(ring.x, ring.y - ring.radius);
      popupContainer.addChild(text);
      floatingScores.push({ text, age: 0 });
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x05060a,
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
        planetGraphics,
        ringGraphics,
        trailGraphics,
        aimGraphics,
        padGraphics,
        ballGraphics,
        popupContainer,
      );
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const computeAimVelocity = () => ({
        vx: Math.cos(aimAngle) * aimPower * world.maxSpeed,
        vy: Math.sin(aimAngle) * aimPower * world.maxSpeed,
      });

      const loop = new GameLoop((deltaSeconds) => {
        world.step(deltaSeconds);
        setScore(Math.floor(world.score));
        setTimeRemaining(Math.ceil(world.timeRemaining));
        if (world.isOver) setIsOver(true);

        if (world.ballReady && pointerAimId === null) {
          if (input.isKeyDown("arrowleft")) aimAngle -= KEY_ROTATE_SPEED * deltaSeconds;
          if (input.isKeyDown("arrowright")) aimAngle += KEY_ROTATE_SPEED * deltaSeconds;
          if (input.isKeyDown("arrowup")) {
            aimPower = Math.min(1, aimPower + KEY_POWER_SPEED * deltaSeconds);
          }
          if (input.isKeyDown("arrowdown")) {
            aimPower = Math.max(0.08, aimPower - KEY_POWER_SPEED * deltaSeconds);
          }
        }

        planetGraphics.clear();
        for (const planet of world.planets) {
          planetGraphics
            .circle(planet.x, planet.y, planet.radius)
            .fill({ color: 0x2a3350, alpha: 0.95 })
            .stroke({ width: 2, color: 0x6ee7ff, alpha: 0.5 });
          planetGraphics
            .circle(planet.x, planet.y, planet.radius * 0.55)
            .fill({ color: 0x1b2138, alpha: 0.9 });
        }

        ringGraphics.clear();
        for (const ring of world.rings) {
          ringGraphics
            .circle(ring.x, ring.y, ring.radius)
            .stroke({ width: 4, color: 0x7cf5c4, alpha: 0.85 });
          ringGraphics
            .circle(ring.x, ring.y, ring.radius * 0.5)
            .stroke({ width: 1.5, color: 0x7cf5c4, alpha: 0.35 });
        }

        padGraphics.clear();
        padGraphics
          .circle(world.padX, world.padY, world.padRadius)
          .fill({ color: world.ballReady ? 0xffe066 : 0x3a3f4d, alpha: 0.9 });

        aimGraphics.clear();
        if (world.ballReady) {
          const { vx, vy } = computeAimVelocity();
          const preview = world.previewTrajectory(vx, vy);
          let prev = { x: world.padX, y: world.padY };
          for (let i = 0; i < preview.length; i++) {
            const point = preview[i];
            if (i % 2 === 0) {
              aimGraphics
                .moveTo(prev.x, prev.y)
                .lineTo(point.x, point.y)
                .stroke({ width: 2, color: 0xffe066, alpha: Math.max(0.15, 0.8 - i * 0.01) });
            }
            prev = point;
          }
        }

        trailGraphics.clear();
        if (world.ball) {
          const trail = world.ball.trail;
          for (let i = 1; i < trail.length; i++) {
            const alpha = i / trail.length;
            trailGraphics
              .moveTo(trail[i - 1].x, trail[i - 1].y)
              .lineTo(trail[i].x, trail[i].y)
              .stroke({ width: 3, color: 0x6ee7ff, alpha: alpha * 0.85 });
          }
        }

        ballGraphics.clear();
        if (world.ball) {
          ballGraphics
            .circle(world.ball.x, world.ball.y, world.ballRadius)
            .fill({ color: 0xffffff, alpha: 0.95 });
          ballGraphics
            .circle(world.ball.x, world.ball.y, world.ballRadius * 2)
            .fill({ color: 0x6ee7ff, alpha: 0.25 });
        }

        for (let i = floatingScores.length - 1; i >= 0; i--) {
          const entry = floatingScores[i];
          entry.age += deltaSeconds;
          entry.text.position.y -= deltaSeconds * 28;
          entry.text.alpha = Math.max(0, 1 - entry.age / POPUP_LIFETIME);
          if (entry.age >= POPUP_LIFETIME) {
            popupContainer.removeChild(entry.text);
            entry.text.destroy();
            floatingScores.splice(i, 1);
          }
        }
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => {
          if (!world.ballReady || pointerAimId !== null) return;
          pointerAimId = pointer.id;
          pointerAnchor = { x: pointer.x, y: pointer.y };
        },
        onPointerMove: (pointer) => {
          if (pointer.id !== pointerAimId) return;
          const dx = pointer.x - pointerAnchor.x;
          const dy = pointer.y - pointerAnchor.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 2) return;
          aimAngle = Math.atan2(-dy, -dx);
          aimPower = Math.min(1, dist / world.maxDrag);
        },
        onPointerUp: (pointer) => {
          if (pointer.id !== pointerAimId) return;
          pointerAimId = null;
          const dist = Math.hypot(pointer.x - pointerAnchor.x, pointer.y - pointerAnchor.y);
          if (dist < MIN_LAUNCH_DRAG) return;
          const { vx, vy } = computeAimVelocity();
          world.launch(vx, vy);
        },
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
          } else if (key === "enter") {
            if (world.ballReady) {
              const { vx, vy } = computeAimVelocity();
              world.launch(vx, vy);
            }
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

  const handleTogglePause = () => {
    if (!loopRef.current) return;
    setIsPaused(loopRef.current.togglePause());
  };

  const handleRestart = () => {
    worldRef.current?.reset();
    setIsOver(false);
    if (loopRef.current?.isPaused) {
      loopRef.current.resume();
      setIsPaused(false);
    }
  };

  return (
    <GameShell
      title="Orbit Sling"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner}>
        <div ref={canvasHostRef} className={styles.canvasHost} />
        <div className={styles.hud}>
          <span className={styles.timer}>⏱ {timeRemaining}s</span>
        </div>
        <div className={styles.hint}>
          パッドからドラッグして引っ張り、離すと逆方向へコメットを発射（矢印キー+Enterでも可）。
          惑星の重力で軌道を曲げてリングを通過しよう。連続ヒットでコンボボーナス。
        </div>
        {isOver && (
          <div className={styles.gameOver}>
            <div className={styles.gameOverTitle}>タイムアップ</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button type="button" className={styles.restartButton} onClick={handleRestart}>
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
