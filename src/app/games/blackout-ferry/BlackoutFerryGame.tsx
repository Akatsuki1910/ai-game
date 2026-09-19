"use client";

import { Application, Graphics } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import styles from "./BlackoutFerryGame.module.scss";
import { BlackoutFerryWorld, type Tower } from "./engine/world";

const KEY_STEER_SPEED = 340; // px/秒。矢印キー/WASDでの操舵目標の移動速さ
const HIDDEN_COLOR = { r: 0x6e, g: 0xe7, b: 0xff };
const SPOTTED_COLOR = { r: 0xff, g: 0x6b, b: 0x6b };

function lerpColor(
  from: { r: number; g: number; b: number },
  to: { r: number; g: number; b: number },
  t: number,
): number {
  const r = Math.round(from.r + (to.r - from.r) * t);
  const g = Math.round(from.g + (to.g - from.g) * t);
  const b = Math.round(from.b + (to.b - from.b) * t);
  return (r << 16) + (g << 8) + b;
}

function drawTowerBeam(graphics: Graphics, tower: Tower): void {
  const angle1 = tower.currentAngle - tower.halfAperture;
  const angle2 = tower.currentAngle + tower.halfAperture;
  const p1 = {
    x: tower.x + Math.cos(angle1) * tower.range,
    y: tower.y + Math.sin(angle1) * tower.range,
  };
  const p2 = {
    x: tower.x + Math.cos(angle2) * tower.range,
    y: tower.y + Math.sin(angle2) * tower.range,
  };
  graphics
    .moveTo(tower.x, tower.y)
    .lineTo(p1.x, p1.y)
    .lineTo(p2.x, p2.y)
    .closePath()
    .fill({ color: 0xfff1a8, alpha: 0.14 });
  graphics.circle(tower.x, tower.y, 7).fill({ color: 0x2b2f3a, alpha: 0.9 });
}

export function BlackoutFerryGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [crossings, setCrossings] = useState(0);
  const [lives, setLives] = useState(3);
  const [suspicion, setSuspicion] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<BlackoutFerryWorld | null>(null);
  const appRef = useRef<Application | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const isBoostButtonHeldRef = useRef(false);

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

  const handleBoostPointerDown = useCallback(() => {
    isBoostButtonHeldRef.current = true;
  }, []);

  const handleBoostPointerEnd = useCallback(() => {
    isBoostButtonHeldRef.current = false;
  }, []);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    let disposed = false;

    const app = new Application();
    const world = new BlackoutFerryWorld(1, 1);
    worldRef.current = world;

    const shoreGraphics = new Graphics();
    const beamGraphics = new Graphics();
    const boatGraphics = new Graphics();
    let draggingPointerId: number | null = null;
    let drawnShoreWidth = -1;
    let drawnShoreHeight = -1;

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x050814,
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
      app.stage.addChild(shoreGraphics, beamGraphics, boatGraphics);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        let kx = 0;
        if (input.isKeyDown("arrowleft") || input.isKeyDown("a")) kx -= 1;
        if (input.isKeyDown("arrowright") || input.isKeyDown("d")) kx += 1;
        if (kx !== 0) world.nudgeSteerTarget(kx * KEY_STEER_SPEED * deltaSeconds);

        const isBoosting = input.isKeyDown("shift") || isBoostButtonHeldRef.current;
        world.setBoosting(isBoosting);

        world.step(deltaSeconds);
        setScore(Math.floor(world.score));
        setCrossings(world.crossings);
        setLives(world.lives);
        setSuspicion(Math.round(world.suspicion));
        if (world.isOver) setIsOver(true);

        if (drawnShoreWidth !== world.width || drawnShoreHeight !== world.height) {
          drawnShoreWidth = world.width;
          drawnShoreHeight = world.height;
          shoreGraphics.clear();
          shoreGraphics
            .rect(0, 0, world.width, 18)
            .fill({ color: 0x1b2438, alpha: 0.9 })
            .rect(0, world.height - 18, world.width, 18)
            .fill({ color: 0x22314a, alpha: 0.9 });
        }

        beamGraphics.clear();
        for (const tower of world.towers) drawTowerBeam(beamGraphics, tower);

        boatGraphics.clear();
        const boatColor = lerpColor(HIDDEN_COLOR, SPOTTED_COLOR, world.illumination);
        boatGraphics
          .circle(world.boat.x, world.boat.y, world.boat.radius + 5)
          .stroke({ width: 2, color: boatColor, alpha: 0.25 + world.illumination * 0.5 });
        boatGraphics
          .moveTo(world.boat.x, world.boat.y - world.boat.radius)
          .lineTo(world.boat.x - world.boat.radius * 0.75, world.boat.y + world.boat.radius)
          .lineTo(world.boat.x + world.boat.radius * 0.75, world.boat.y + world.boat.radius)
          .closePath()
          .fill({ color: boatColor, alpha: 0.95 });
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => {
          if (draggingPointerId !== null) return;
          draggingPointerId = pointer.id;
          world.setSteerTarget(pointer.x);
        },
        onPointerMove: (pointer) => {
          if (pointer.id !== draggingPointerId) return;
          world.setSteerTarget(pointer.x);
        },
        onPointerUp: (pointer) => {
          if (pointer.id !== draggingPointerId) return;
          draggingPointerId = null;
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
      title="Blackout Ferry"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="blackout-ferry-stage">
        <div
          ref={canvasHostRef}
          className={styles.canvasHost}
          data-testid="blackout-ferry-canvas"
        />
        <div className={styles.hud}>
          <span className={styles.crossings} data-testid="blackout-ferry-crossings">
            渡航 {crossings}
          </span>
          <span className={styles.lives} data-testid="blackout-ferry-lives">
            {"⛵".repeat(Math.max(0, lives))}
          </span>
          <div className={styles.suspicionTrack} data-testid="blackout-ferry-suspicion">
            <div
              className={styles.suspicionFill}
              style={{ width: `${Math.min(100, Math.max(0, suspicion))}%` }}
            />
          </div>
        </div>
        <button
          type="button"
          className={styles.boostButton}
          onPointerDown={handleBoostPointerDown}
          onPointerUp={handleBoostPointerEnd}
          onPointerLeave={handleBoostPointerEnd}
          onPointerCancel={handleBoostPointerEnd}
          data-testid="blackout-ferry-boost"
        >
          ブースト
        </button>
        <div className={styles.hint}>
          ドラッグ/クリックした位置へ舟を左右に操舵（矢印キー/ADでも可）。サーチライトに照らされ続けると疑心度が上がり、満タンで見つかって出航地点に戻される。ブーストは速いが照らされたときのリスクも増す。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="blackout-ferry-gameover">
            <div className={styles.gameOverTitle}>拿捕された</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <div className={styles.gameOverCrossings}>渡航成功 {crossings}回</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="blackout-ferry-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
