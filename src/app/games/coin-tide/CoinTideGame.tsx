"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import styles from "./CoinTideGame.module.scss";
import { type Coin, CoinTideWorld, ROUND_SECONDS } from "./engine/world";

const COIN_COLORS = {
  standard: 0xd7dce2,
  bonus: 0xffd166,
} as const satisfies Record<Coin["kind"], number>;

interface FloatingPopup {
  text: Text;
  age: number;
}

const POPUP_LIFETIME = 0.8;
const AIM_STEP_PER_SECOND = 220;

export function CoinTideGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [stock, setStock] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(ROUND_SECONDS);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<CoinTideWorld | null>(null);
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
    const world = new CoinTideWorld(1, 1);
    worldRef.current = world;

    const backgroundGraphics = new Graphics();
    const pusherGraphics = new Graphics();
    const coinGraphics = new Graphics();
    const aimGraphics = new Graphics();
    const popupContainer = new Container();
    const floatingPopups: FloatingPopup[] = [];
    let isLeftHeld = false;
    let isRightHeld = false;

    world.onCoinScored = ({ coin, points }) => {
      const isBonus = coin.kind === "bonus";
      const text = new Text({
        text: isBonus ? `BONUS +${points}` : `+${points}`,
        style: {
          fill: isBonus ? 0xffd166 : 0xf2f3f5,
          fontSize: isBonus ? 20 : 16,
          fontWeight: "700",
        },
      });
      text.anchor.set(0.5, 0.5);
      text.position.set(coin.x, world.height - 12);
      popupContainer.addChild(text);
      floatingPopups.push({ text, age: 0 });
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
        backgroundGraphics,
        pusherGraphics,
        coinGraphics,
        aimGraphics,
        popupContainer,
      );
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        if (isLeftHeld) world.setAim(world.aimX - AIM_STEP_PER_SECOND * deltaSeconds);
        if (isRightHeld) world.setAim(world.aimX + AIM_STEP_PER_SECOND * deltaSeconds);

        world.step(deltaSeconds);
        setScore(Math.floor(world.score));
        setStock(world.stock);
        setTimeRemaining(Math.ceil(world.timeRemaining));
        if (world.isOver) setIsOver(true);

        backgroundGraphics.clear().rect(0, 0, world.width, world.height).fill({ color: 0x14161d });
        backgroundGraphics
          .rect(0, world.height - 4, world.width, 4)
          .fill({ color: 0x6ee7ff, alpha: 0.5 });

        pusherGraphics
          .clear()
          .rect(0, 0, world.width, world.pusherY)
          .fill({ color: 0x2b2f3a })
          .rect(0, Math.max(0, world.pusherY - 6), world.width, 6)
          .fill({ color: 0x6ee7ff, alpha: 0.7 });

        coinGraphics.clear();
        for (const coin of world.coins) {
          coinGraphics
            .circle(coin.x, coin.y, coin.radius)
            .fill({ color: COIN_COLORS[coin.kind] })
            .stroke({ width: 2, color: 0x05060a, alpha: 0.5 });
        }

        aimGraphics
          .clear()
          .moveTo(world.aimX, 0)
          .lineTo(world.aimX, world.pusherMinY)
          .stroke({ width: 2, color: 0xffffff, alpha: 0.4 })
          .circle(world.aimX, 6, 5)
          .fill({ color: 0xffffff, alpha: 0.9 });

        for (let i = floatingPopups.length - 1; i >= 0; i--) {
          const popup = floatingPopups[i];
          popup.age += deltaSeconds;
          popup.text.position.y -= deltaSeconds * 24;
          popup.text.alpha = Math.max(0, 1 - popup.age / POPUP_LIFETIME);
          if (popup.age >= POPUP_LIFETIME) {
            popupContainer.removeChild(popup.text);
            popup.text.destroy();
            floatingPopups.splice(i, 1);
          }
        }
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => {
          world.setAim(pointer.x);
          world.dropCoin();
        },
        onPointerMove: (pointer) => {
          world.setAim(pointer.x);
        },
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
          } else if (key === "r") {
            world.reset();
            setIsOver(false);
          } else if (key === "enter") {
            world.dropCoin();
          } else if (key === "arrowleft" || key === "a") {
            isLeftHeld = true;
          } else if (key === "arrowright" || key === "d") {
            isRightHeld = true;
          }
        },
        onKeyUp: (key) => {
          if (key === "arrowleft" || key === "a") isLeftHeld = false;
          if (key === "arrowright" || key === "d") isRightHeld = false;
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
      title="Coin Tide"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="coin-tide-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="coin-tide-canvas" />
        <div className={styles.hud}>
          <span className={styles.timer} data-testid="coin-tide-timer">
            ⏱ {timeRemaining}s
          </span>
          <span className={styles.stock} data-testid="coin-tide-stock">
            🪙 {stock}
          </span>
        </div>
        <div className={styles.hint}>
          クリック/タップでコインを投入。プッシャーと緩やかな流れが奥から前縁へ押し流す。
          落ちた分だけ得点（金色はボーナス）。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="coin-tide-gameover">
            <div className={styles.gameOverTitle}>ラウンド終了</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="coin-tide-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
