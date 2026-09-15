"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import { CUT_THRESHOLD, KiteDuelWorld, ROUND_SECONDS } from "./engine/world";
import styles from "./KiteDuelGame.module.scss";

interface FloatingScore {
  text: Text;
  age: number;
}

const POPUP_LIFETIME = 0.9;
const PLAYER_KITE_COLOR = 0x6ee7ff;
const RIVAL_COOL_COLOR = { r: 0x7c, g: 0xf5, b: 0xc4 };
const RIVAL_HOT_COLOR = { r: 0xff, g: 0x6b, b: 0x6b };

function lerpChannel(from: number, to: number, t: number): number {
  return Math.round(from + (to - from) * t);
}

function rivalColor(sawPower: number): number {
  const t = Math.min(1, Math.max(0, sawPower / CUT_THRESHOLD));
  const r = lerpChannel(RIVAL_COOL_COLOR.r, RIVAL_HOT_COLOR.r, t);
  const g = lerpChannel(RIVAL_COOL_COLOR.g, RIVAL_HOT_COLOR.g, t);
  const b = lerpChannel(RIVAL_COOL_COLOR.b, RIVAL_HOT_COLOR.b, t);
  return (r << 16) + (g << 8) + b;
}

export function KiteDuelGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(ROUND_SECONDS);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<KiteDuelWorld | null>(null);
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
    const world = new KiteDuelWorld(1, 1);
    worldRef.current = world;

    const skyGraphics = new Graphics();
    const rivalStringGraphics = new Graphics();
    const rivalGraphics = new Graphics();
    const playerGraphics = new Graphics();
    const popupContainer = new Container();
    const floatingScores: FloatingScore[] = [];
    const activePointerIds = new Set<number>();
    let drawnSkyWidth = -1;
    let drawnSkyHeight = -1;

    world.onKiteCut = ({ points, combo: comboValue, x, y }) => {
      const label = comboValue > 1 ? `+${points} COMBO x${comboValue}` : `+${points}`;
      const text = new Text({
        text: label,
        style: { fill: 0xffe066, fontSize: 18, fontWeight: "700" },
      });
      text.anchor.set(0.5, 1);
      text.position.set(x, y);
      popupContainer.addChild(text);
      floatingScores.push({ text, age: 0 });
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x0b1524,
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
        skyGraphics,
        rivalStringGraphics,
        rivalGraphics,
        playerGraphics,
        popupContainer,
      );
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        if (input.isKeyDown("arrowleft") || input.isKeyDown("a")) {
          world.nudgeControlAngle(-1, deltaSeconds);
        }
        if (input.isKeyDown("arrowright") || input.isKeyDown("d")) {
          world.nudgeControlAngle(1, deltaSeconds);
        }

        world.step(deltaSeconds);
        setScore(Math.floor(world.score));
        setCombo(world.combo);
        setTimeRemaining(Math.ceil(world.timeRemaining));
        if (world.isOver) setIsOver(true);

        if (drawnSkyWidth !== world.width || drawnSkyHeight !== world.height) {
          drawnSkyWidth = world.width;
          drawnSkyHeight = world.height;
          skyGraphics
            .clear()
            .rect(0, 0, world.width, world.height)
            .fill({ color: 0x0b1524 })
            .circle(world.anchor.x, world.anchor.y, 10)
            .fill({ color: 0x2b2f3a });
        }

        const anchor = world.anchor;
        const kite = world.kitePosition;

        rivalStringGraphics.clear();
        rivalGraphics.clear();
        for (const rival of world.opponents) {
          const tension = rival.sawPower / CUT_THRESHOLD;
          const color = rivalColor(rival.sawPower);
          rivalStringGraphics
            .moveTo(rival.x, rival.y)
            .lineTo(rival.x, world.height)
            .stroke({ width: 2 + tension * 2, color, alpha: 0.45 + tension * 0.4 });

          rivalGraphics
            .poly([
              rival.x,
              rival.y - 12,
              rival.x + 9,
              rival.y,
              rival.x,
              rival.y + 12,
              rival.x - 9,
              rival.y,
            ])
            .fill({ color, alpha: 0.95 });
          if (tension > 0) {
            rivalGraphics
              .circle(rival.x, rival.y, 16 + tension * 6)
              .stroke({ width: 2, color, alpha: 0.25 + tension * 0.5 });
          }
        }

        playerGraphics
          .clear()
          .moveTo(anchor.x, anchor.y)
          .lineTo(kite.x, kite.y)
          .stroke({ width: 2, color: PLAYER_KITE_COLOR, alpha: 0.85 })
          .poly([
            kite.x,
            kite.y - 16,
            kite.x + 12,
            kite.y,
            kite.x,
            kite.y + 12,
            kite.x - 12,
            kite.y,
          ])
          .fill({ color: PLAYER_KITE_COLOR, alpha: 0.95 })
          .stroke({ width: 2, color: 0xffffff, alpha: 0.5 });

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
          activePointerIds.add(pointer.id);
          world.setPointerTarget(pointer.x, pointer.y);
        },
        onPointerMove: (pointer) => {
          if (!activePointerIds.has(pointer.id)) return;
          world.setPointerTarget(pointer.x, pointer.y);
        },
        onPointerUp: (pointer) => {
          activePointerIds.delete(pointer.id);
        },
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
      title="Kite Duel"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="kite-duel-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="kite-duel-canvas" />
        <div className={styles.hud}>
          <span className={styles.timer} data-testid="kite-duel-timer">
            ⏱ {timeRemaining}s
          </span>
          <span className={styles.combo} data-testid="kite-duel-combo">
            COMBO x{combo}
          </span>
        </div>
        <div className={styles.hint}>
          ドラッグ(タッチ)またはドラッグ&矢印キー/ADで凧の向きを操作。揺れる相手の凧糸に自分の糸を重ね、旋回させながら切り裂こう。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="kite-duel-gameover">
            <div className={styles.gameOverTitle}>ラウンド終了</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="kite-duel-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
