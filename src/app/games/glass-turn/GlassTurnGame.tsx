"use client";

import { Application, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import {
  type FailEvent,
  type FinishEvent,
  GlassTurnWorld,
  INITIAL_TEMPERATURE,
  LIVES_MAX,
  MAX_RADIUS,
} from "./engine/world";
import styles from "./GlassTurnGame.module.scss";

const BASE_STAGE_UNIT = 380;
const MIN_VISUAL_RADIUS = 14;
const ANCHOR_X_RATIO = 0.5;
const ANCHOR_Y_RATIO = 0.42;
const FURNACE_Y_RATIO = 0.86;
const ROLL_PIXEL_THRESHOLD = 6;
const POPUP_LIFETIME = 1;

const COLOR_SAFE = { r: 0xff, g: 0xb3, b: 0x47 };
const COLOR_DANGER = { r: 0xff, g: 0x4d, b: 0x4d };

function worldUnitToPixels(value: number, width: number, height: number): number {
  const scale = Math.min(width, height) / BASE_STAGE_UNIT;
  return value * scale;
}

function lerpColor(a: typeof COLOR_SAFE, b: typeof COLOR_DANGER, t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  const r = Math.round(a.r + (b.r - a.r) * clamped);
  const g = Math.round(a.g + (b.g - a.g) * clamped);
  const bl = Math.round(a.b + (b.b - a.b) * clamped);
  return (r << 16) + (g << 8) + bl;
}

interface FloatingPopup {
  text: Text;
  age: number;
}

export function GlassTurnGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [round, setRound] = useState(1);
  const [lives, setLives] = useState(LIVES_MAX);
  const [combo, setCombo] = useState(0);
  const [radiusDisplay, setRadiusDisplay] = useState(0);
  const [targetMinDisplay, setTargetMinDisplay] = useState(0);
  const [targetMaxDisplay, setTargetMaxDisplay] = useState(0);
  const [temperatureDisplay, setTemperatureDisplay] = useState(100);
  const [wobbleDisplay, setWobbleDisplay] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<GlassTurnWorld | null>(null);
  const appRef = useRef<Application | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const sizeRef = useRef({ width: 0, height: 0 });

  const handleTogglePause = useCallback(() => {
    if (!loopRef.current) return;
    setIsPaused(loopRef.current.togglePause());
  }, []);

  const handleRestart = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    world.reset();
    setIsOver(false);
    if (loopRef.current?.isPaused) {
      loopRef.current.resume();
      setIsPaused(false);
    }
  }, []);

  const handleFinish = useCallback(() => {
    worldRef.current?.finish();
  }, []);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    let disposed = false;

    const app = new Application();
    const world = new GlassTurnWorld();
    worldRef.current = world;

    const bandGraphics = new Graphics();
    const bubbleGraphics = new Graphics();
    const floatingPopups: FloatingPopup[] = [];

    let blowingPointerId: number | null = null;
    let lastRollX = 0;
    let lastRollSign = 0;

    const spawnPopup = (label: string, color: number): void => {
      const { width, height } = sizeRef.current;
      if (width === 0 || height === 0) return;
      const text = new Text({
        text: label,
        style: { fill: color, fontSize: 18, fontWeight: "700" },
      });
      text.anchor.set(0.5, 0.5);
      text.position.set(width * ANCHOR_X_RATIO, height * ANCHOR_Y_RATIO - 40);
      app.stage.addChild(text);
      floatingPopups.push({ text, age: 0 });
    };

    world.onFinish = ({ result, points }: FinishEvent) => {
      spawnPopup(result === "onTarget" ? `+${points}` : `規格外 +${points}`, 0x7cf5c4);
    };
    world.onFail = ({ reason }: FailEvent) => {
      spawnPopup(reason === "popped" ? "パーン!" : "崩れた…", 0xff6b6b);
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x120f16,
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
      app.stage.addChild(bandGraphics, bubbleGraphics);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        world.step(deltaSeconds);

        setScore(world.score);
        setRound(world.round);
        setLives(world.lives);
        setCombo(world.combo);
        setRadiusDisplay(Math.round(world.radius));
        setTargetMinDisplay(Math.round(world.targetMin));
        setTargetMaxDisplay(Math.round(world.targetMax));
        setTemperatureDisplay(Math.round((world.temperature / INITIAL_TEMPERATURE) * 100));
        setWobbleDisplay(Math.round(world.wobble * 100));
        if (world.isOver) setIsOver(true);

        const { width, height } = sizeRef.current;
        if (width > 0 && height > 0) {
          const anchorX = width * ANCHOR_X_RATIO;
          const anchorY = height * ANCHOR_Y_RATIO;
          const furnaceY = height * FURNACE_Y_RATIO;

          bandGraphics.clear();
          bandGraphics
            .moveTo(anchorX, furnaceY)
            .lineTo(anchorX, anchorY)
            .stroke({ width: 6, color: 0x4a3f33, alpha: 0.9 });
          bandGraphics
            .circle(anchorX, furnaceY, Math.max(20, worldUnitToPixels(26, width, height)))
            .fill({ color: 0xff8a3d, alpha: 0.35 })
            .stroke({ width: 3, color: 0xff8a3d, alpha: 0.8 });

          const minPixelRadius =
            MIN_VISUAL_RADIUS + worldUnitToPixels(world.targetMin, width, height);
          const maxPixelRadius =
            MIN_VISUAL_RADIUS + worldUnitToPixels(world.targetMax, width, height);
          bandGraphics
            .circle(anchorX, anchorY, minPixelRadius)
            .stroke({ width: 2, color: 0x6ee7ff, alpha: 0.55 });
          bandGraphics
            .circle(anchorX, anchorY, maxPixelRadius)
            .stroke({ width: 2, color: 0x6ee7ff, alpha: 0.55 });

          const danger = Math.max(world.radius / MAX_RADIUS, world.wobble);
          const bubbleColor = lerpColor(COLOR_SAFE, COLOR_DANGER, danger);
          const wobblePhase = performance.now() / 120;
          const wobbleOffsetX = Math.sin(wobblePhase) * world.wobble * 10;
          const wobbleOffsetY = Math.cos(wobblePhase * 1.3) * world.wobble * 8;
          const pixelRadius = MIN_VISUAL_RADIUS + worldUnitToPixels(world.radius, width, height);

          bubbleGraphics.clear();
          bubbleGraphics
            .circle(anchorX + wobbleOffsetX, anchorY + wobbleOffsetY, pixelRadius)
            .fill({ color: bubbleColor, alpha: 0.85 })
            .stroke({ width: 3, color: 0xffffff, alpha: world.isRolling ? 0.95 : 0.4 });

          for (let i = floatingPopups.length - 1; i >= 0; i--) {
            const entry = floatingPopups[i];
            entry.age += deltaSeconds;
            entry.text.position.y -= deltaSeconds * 30;
            entry.text.alpha = Math.max(0, 1 - entry.age / POPUP_LIFETIME);
            if (entry.age >= POPUP_LIFETIME) {
              app.stage.removeChild(entry.text);
              entry.text.destroy();
              floatingPopups.splice(i, 1);
            }
          }
        }
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => {
          if (loop.isPaused || world.isOver) return;
          blowingPointerId = pointer.id;
          lastRollX = pointer.x;
          lastRollSign = 0;
          world.setBlowing(true);
        },
        onPointerMove: (pointer) => {
          if (pointer.id !== blowingPointerId) return;
          const dx = pointer.x - lastRollX;
          if (Math.abs(dx) >= ROLL_PIXEL_THRESHOLD) {
            const sign = dx > 0 ? 1 : -1;
            if (lastRollSign !== 0 && sign !== lastRollSign) {
              world.registerRoll();
            }
            lastRollSign = sign;
            lastRollX = pointer.x;
          }
        },
        onPointerUp: (pointer) => {
          if (pointer.id !== blowingPointerId) return;
          blowingPointerId = null;
          world.setBlowing(false);
        },
        onKeyDown: (key) => {
          if (loop.isPaused && key !== " ") return;
          if (key === " ") {
            setIsPaused(loop.togglePause());
            return;
          }
          if (key === "r") {
            world.reset();
            blowingPointerId = null;
            setIsOver(false);
            return;
          }
          if (key === "enter") {
            world.setBlowing(true);
            return;
          }
          if (key === "arrowleft" || key === "arrowright" || key === "a" || key === "d") {
            world.registerRoll();
            return;
          }
          if (key === "f") {
            world.finish();
          }
        },
        onKeyUp: (key) => {
          if (key === "enter") {
            world.setBlowing(false);
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
    sizeRef.current = { width: size.width, height: size.height };
  }, [size.width, size.height]);

  return (
    <GameShell
      title="Glass Turn"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="glass-turn-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="glass-turn-canvas" />
        <div className={styles.hud}>
          <span className={styles.round} data-testid="glass-turn-round" data-round={round}>
            ROUND {round}
          </span>
          <span className={styles.combo} data-testid="glass-turn-combo" data-combo={combo}>
            COMBO {combo}
          </span>
          <span className={styles.lives} data-testid="glass-turn-lives" data-lives={lives}>
            ライフ {lives} / {LIVES_MAX}
          </span>
        </div>
        <div
          className={styles.gauge}
          data-testid="glass-turn-gauge"
          data-radius={radiusDisplay}
          data-target-min={targetMinDisplay}
          data-target-max={targetMaxDisplay}
          data-temperature={temperatureDisplay}
          data-wobble={wobbleDisplay}
        >
          <div>
            大きさ {radiusDisplay} / 目標 {targetMinDisplay}〜{targetMaxDisplay}
          </div>
          <div className={styles.gaugeBar}>
            <div
              className={styles.gaugeBarFill}
              style={{ width: `${Math.max(0, Math.min(100, temperatureDisplay))}%` }}
            />
          </div>
          <div>歪み {wobbleDisplay}%</div>
        </div>
        <div className={styles.hint}>
          画面を長押しで送風(膨らむ)、押しながら左右に振ると転がして歪みを抑える。目標の大きさで「仕上げる」を押そう。
          大きすぎると割れ、歪みすぎると崩れる。キーボードはEnter長押しで送風、←→/ADで転がす、Fで仕上げる。Space:
          一時停止 / R: リセット
        </div>
        <button
          type="button"
          className={styles.finishButton}
          onClick={handleFinish}
          disabled={isPaused || isOver}
          data-testid="glass-turn-finish"
        >
          仕上げる
        </button>
        {isOver && (
          <div className={styles.gameOver} data-testid="glass-turn-gameover">
            <div className={styles.gameOverTitle}>工房は冷え切った</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="glass-turn-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
