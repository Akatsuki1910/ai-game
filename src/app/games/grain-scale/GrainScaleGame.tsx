"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import {
  type GrainPouredEvent,
  GrainScaleWorld,
  MAX_CAPACITY,
  ROUND_SECONDS,
  TARGET_TOLERANCE,
} from "./engine/world";
import styles from "./GrainScaleGame.module.scss";

const SPOUT_KEY_SPEED = 420; // px/秒。矢印キーで壺を動かす速度。
const POPUP_LIFETIME = 0.9;
const SPILL_SHAKE_DURATION = 0.4;
const GRAIN_FALL_GRAVITY = 900; // px/秒^2。落下する砂粒の見た目の演出専用の値。

interface FloatingScore {
  text: Text;
  age: number;
}

interface FallingGrain {
  graphic: Graphics;
  vy: number;
  landY: number;
}

export function GrainScaleGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(ROUND_SECONDS);
  const [combo, setCombo] = useState(0);
  const [leftWeight, setLeftWeight] = useState(0);
  const [rightWeight, setRightWeight] = useState(0);
  const [targetWeight, setTargetWeight] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<GrainScaleWorld | null>(null);
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
    const world = new GrainScaleWorld(1, 1);
    worldRef.current = world;

    const beamGraphics = new Graphics();
    const panGraphics = new Graphics();
    const spoutGraphics = new Graphics();
    const fallingGrainsContainer = new Container();
    const popupContainer = new Container();
    const floatingScores: FloatingScore[] = [];
    const fallingGrains: FallingGrain[] = [];
    let shakeRemaining = 0;

    world.onGrainPoured = ({ x, pan }: GrainPouredEvent) => {
      if (pan === "gap") return;
      const graphic = new Graphics().circle(0, 0, 3).fill({ color: 0xf3d9a4 });
      graphic.position.set(x, world.height * 0.14);
      fallingGrainsContainer.addChild(graphic);
      fallingGrains.push({ graphic, vy: 0, landY: world.height * 0.82 });
    };

    world.onRoundCompleted = ({ points, combo: comboAtHit }) => {
      const text = new Text({
        text: comboAtHit > 0 ? `+${points} COMBO x${comboAtHit + 1}` : `+${points}`,
        style: { fill: 0xffe066, fontSize: 20, fontWeight: "700" },
      });
      text.anchor.set(0.5, 1);
      text.position.set(world.width / 2, world.height * 0.4);
      popupContainer.addChild(text);
      floatingScores.push({ text, age: 0 });
    };

    world.onSpill = () => {
      shakeRemaining = SPILL_SHAKE_DURATION;
    };

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
      app.stage.addChild(
        beamGraphics,
        panGraphics,
        fallingGrainsContainer,
        spoutGraphics,
        popupContainer,
      );
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        if (input.isKeyDown("arrowleft") || input.isKeyDown("a")) {
          world.moveSpout(-SPOUT_KEY_SPEED * deltaSeconds);
        }
        if (input.isKeyDown("arrowright") || input.isKeyDown("d")) {
          world.moveSpout(SPOUT_KEY_SPEED * deltaSeconds);
        }

        world.step(deltaSeconds);
        setScore(Math.floor(world.score));
        setTimeRemaining(Math.ceil(world.timeRemaining));
        setCombo(world.combo);
        setLeftWeight(Math.round(world.leftWeight));
        setRightWeight(Math.round(world.rightWeight));
        setTargetWeight(world.target);
        if (world.isOver) setIsOver(true);

        shakeRemaining = Math.max(0, shakeRemaining - deltaSeconds);
        const shakeOffset =
          shakeRemaining > 0
            ? Math.sin(shakeRemaining * 60) * 6 * (shakeRemaining / SPILL_SHAKE_DURATION)
            : 0;
        app.stage.position.set(shakeOffset, 0);

        for (let i = fallingGrains.length - 1; i >= 0; i--) {
          const grain = fallingGrains[i];
          grain.vy += GRAIN_FALL_GRAVITY * deltaSeconds;
          grain.graphic.y += grain.vy * deltaSeconds;
          if (grain.graphic.y >= grain.landY) {
            fallingGrainsContainer.removeChild(grain.graphic);
            grain.graphic.destroy();
            fallingGrains.splice(i, 1);
          }
        }

        const [leftMin, leftMax] = world.leftPanRange();
        const [rightMin, rightMax] = world.rightPanRange();
        const panFloorY = world.height * 0.82;
        const panTopY = world.height * 0.55;
        const pivotX = world.width / 2;
        const pivotY = world.height * 0.18;

        beamGraphics.clear();
        beamGraphics.circle(pivotX, pivotY, 8).fill({ color: 0x9aa0ac });
        const beamHalfLength = world.width * 0.4;
        const dx = Math.cos(world.beamAngle) * beamHalfLength;
        const dy = Math.sin(world.beamAngle) * beamHalfLength;
        beamGraphics
          .moveTo(pivotX - dx, pivotY - dy)
          .lineTo(pivotX + dx, pivotY + dy)
          .stroke({ width: 5, color: 0x6ee7ff, alpha: 0.9 });

        panGraphics.clear();
        const targetMin = world.target - TARGET_TOLERANCE;
        const targetMax = world.target + TARGET_TOLERANCE;
        const drawPan = (min: number, max: number, weight: number) => {
          const panW = max - min;
          panGraphics
            .rect(min, panTopY, panW, panFloorY - panTopY)
            .stroke({ width: 2, color: 0x2b2f3a, alpha: 0.8 });
          const targetY0 = panFloorY - (targetMin / MAX_CAPACITY) * (panFloorY - panTopY);
          const targetY1 = panFloorY - (targetMax / MAX_CAPACITY) * (panFloorY - panTopY);
          panGraphics
            .rect(min, Math.max(panTopY, targetY1), panW, Math.max(0, targetY0 - targetY1))
            .fill({ color: 0x7cf5c4, alpha: 0.18 });
          const fillHeight =
            (Math.min(weight, MAX_CAPACITY) / MAX_CAPACITY) * (panFloorY - panTopY);
          const inRange = Math.abs(weight - world.target) <= TARGET_TOLERANCE;
          panGraphics
            .rect(min, panFloorY - fillHeight, panW, fillHeight)
            .fill({ color: inRange ? 0x7cf5c4 : 0xf3d9a4, alpha: 0.9 });
        };
        drawPan(leftMin, leftMax, world.leftWeight);
        drawPan(rightMin, rightMax, world.rightWeight);

        spoutGraphics.clear();
        spoutGraphics
          .moveTo(world.spoutX - 14, world.height * 0.1)
          .lineTo(world.spoutX + 14, world.height * 0.1)
          .lineTo(world.spoutX, world.height * 0.17)
          .closePath()
          .fill({ color: 0xffb454 });

        for (let i = floatingScores.length - 1; i >= 0; i--) {
          const entry = floatingScores[i];
          entry.age += deltaSeconds;
          entry.text.position.y -= deltaSeconds * 30;
          entry.text.alpha = Math.max(0, 1 - entry.age / POPUP_LIFETIME);
          if (entry.age >= POPUP_LIFETIME) {
            popupContainer.removeChild(entry.text);
            entry.text.destroy();
            floatingScores.splice(i, 1);
          }
        }
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => world.setSpoutX(pointer.x),
        onPointerMove: (pointer) => world.setSpoutX(pointer.x),
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
          } else if (key === "r") {
            world.reset();
            setIsOver(false);
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
      title="Grain Scale"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="grain-scale-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="grain-scale-canvas" />
        <div className={styles.hud}>
          <span className={styles.timer} data-testid="grain-scale-timer">
            ⏱ {timeRemaining}s
          </span>
          <span className={styles.combo} data-testid="grain-scale-combo">
            COMBO {combo}
          </span>
          <span className={styles.weights}>
            <span data-testid="grain-scale-left-weight">L {leftWeight}</span>
            {" / "}
            <span data-testid="grain-scale-right-weight">R {rightWeight}</span>{" "}
            <span data-testid="grain-scale-target-weight">目標 {targetWeight}</span>
          </span>
        </div>
        <div className={styles.hint}>
          壺（オレンジの三角）をドラッグして左右に動かし、両方の皿を目標の帯（緑）に合わせて釣り合わせ続けよう。
          傾きすぎると砂がこぼれてしまう。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="grain-scale-gameover">
            <div className={styles.gameOverTitle}>ラウンド終了</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="grain-scale-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
