"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import { type IngredientKind, WokTossWorld } from "./engine/world";
import styles from "./WokTossGame.module.scss";

const INGREDIENT_COLORS = {
  carrot: 0xffa94d,
  shrimp: 0xff9bb3,
  egg: 0xfff3bf,
} as const satisfies Record<IngredientKind, number>;

const WOK_CURVE_SEGMENTS = 28;
const WOK_TILT_VISUAL_SCALE = 0.85;

interface FloatingScore {
  text: Text;
  age: number;
}

const POPUP_LIFETIME = 0.8;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function WokTossGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [combo, setCombo] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<WokTossWorld | null>(null);
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
    setLives(3);
    setCombo(0);
    setScore(0);
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
    const world = new WokTossWorld(1, 1);
    worldRef.current = world;

    const backgroundGraphics = new Graphics();
    const wokContainer = new Container();
    const panGraphics = new Graphics();
    wokContainer.addChild(panGraphics);
    const ingredientGraphics = new Graphics();
    const popupContainer = new Container();
    const floatingScores: FloatingScore[] = [];
    let drawnWokWidth = -1;
    let drawnWokHeight = -1;

    const isDraggingRef = { current: false };
    const pointerXRef = { current: 0 };

    world.onToss = ({ ingredient, points, combo: hitCombo }) => {
      const label = hitCombo > 1 ? `+${points} COMBO x${hitCombo}` : `+${points}`;
      const text = new Text({
        text: label,
        style: { fill: 0xffe066, fontSize: 18, fontWeight: "700" },
      });
      text.anchor.set(0.5, 1);
      text.position.set(ingredient.x, ingredient.y - ingredient.radius);
      popupContainer.addChild(text);
      floatingScores.push({ text, age: 0 });
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x120a08,
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
      app.stage.addChild(backgroundGraphics, wokContainer, ingredientGraphics, popupContainer);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        const bounds = world.getWokBounds();
        let tiltInput = 0;
        if (isDraggingRef.current) {
          tiltInput = clamp(
            (pointerXRef.current - bounds.centerX) / Math.max(1, bounds.halfWidth),
            -1,
            1,
          );
        } else {
          const leaningLeft = input.isKeyDown("arrowleft") || input.isKeyDown("a");
          const leaningRight = input.isKeyDown("arrowright") || input.isKeyDown("d");
          if (leaningLeft && !leaningRight) tiltInput = -1;
          else if (leaningRight && !leaningLeft) tiltInput = 1;
        }
        world.setTiltTarget(tiltInput);
        world.step(deltaSeconds);

        setScore(Math.floor(world.score));
        setLives(world.lives);
        setCombo(world.combo);
        if (world.isOver) setIsOver(true);

        if (drawnWokWidth !== world.width || drawnWokHeight !== world.height) {
          drawnWokWidth = world.width;
          drawnWokHeight = world.height;

          backgroundGraphics
            .clear()
            .rect(0, 0, world.width, world.height)
            .fill({ color: 0x1a0f0a });

          panGraphics.clear();
          const points: { x: number; y: number }[] = [];
          for (let i = 0; i <= WOK_CURVE_SEGMENTS; i++) {
            const x =
              bounds.centerX - bounds.halfWidth + (2 * bounds.halfWidth * i) / WOK_CURVE_SEGMENTS;
            points.push({ x, y: world.surfaceYAt(x) });
          }
          panGraphics.moveTo(points[0].x, points[0].y);
          for (const point of points.slice(1)) panGraphics.lineTo(point.x, point.y);
          panGraphics.lineTo(bounds.centerX + bounds.halfWidth, world.height + 40);
          panGraphics.lineTo(bounds.centerX - bounds.halfWidth, world.height + 40);
          panGraphics.closePath();
          panGraphics.fill({ color: 0x2b2420 });

          panGraphics.moveTo(points[0].x, points[0].y);
          for (const point of points.slice(1)) panGraphics.lineTo(point.x, point.y);
          panGraphics.stroke({ width: 4, color: 0xd9a066, alpha: 0.85 });
        }

        wokContainer.pivot.set(bounds.centerX, bounds.bottomY);
        wokContainer.position.set(bounds.centerX, bounds.bottomY);
        wokContainer.rotation = world.tiltAngle * WOK_TILT_VISUAL_SCALE;

        ingredientGraphics.clear();
        for (const ingredient of world.ingredients) {
          ingredientGraphics
            .circle(ingredient.x, ingredient.y, ingredient.radius)
            .fill({ color: INGREDIENT_COLORS[ingredient.kind], alpha: 0.95 })
            .stroke({ width: 2, color: 0xffffff, alpha: 0.35 });
        }

        for (let i = floatingScores.length - 1; i >= 0; i--) {
          const entry = floatingScores[i];
          entry.age += deltaSeconds;
          entry.text.position.y -= deltaSeconds * 32;
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
          isDraggingRef.current = true;
          pointerXRef.current = pointer.x;
        },
        onPointerMove: (pointer) => {
          if (isDraggingRef.current) pointerXRef.current = pointer.x;
        },
        onPointerUp: () => {
          isDraggingRef.current = false;
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
    <GameShell title="Wok Toss" score={score} isPaused={isPaused} onTogglePause={handleTogglePause}>
      <div ref={stageRef} className={styles.stageInner} data-testid="wok-toss-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="wok-toss-canvas" />
        <div className={styles.hud}>
          <span className={styles.livesBadge} data-testid="wok-toss-lives">
            🔥 LIVES {lives}
          </span>
          <span className={styles.comboBadge} data-testid="wok-toss-combo">
            COMBO x{combo}
          </span>
        </div>
        <div className={styles.hint}>
          ドラッグ/矢印キー(←→・A/D)でウォックを傾けて具材を弾ませ続けよう。縁の外に落とすとライフが減る。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="wok-toss-gameover">
            <div className={styles.gameOverTitle}>こぼしすぎ!</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="wok-toss-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
