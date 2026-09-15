"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import { KendamaWorld } from "./engine/world";
import styles from "./KendamaSwingGame.module.scss";

const CUP_KEY_SPEED = 520; // px/秒。キーボードでカップを動かす速さ
const POPUP_LIFETIME = 0.8;

interface FloatingScore {
  text: Text;
  age: number;
}

export function KendamaSwingGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [lives, setLives] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<KendamaWorld | null>(null);
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
    const world = new KendamaWorld(1, 1);
    worldRef.current = world;

    const floorGraphics = new Graphics();
    const ropeGraphics = new Graphics();
    const cupGraphics = new Graphics();
    const ballGraphics = new Graphics();
    const popupContainer = new Container();

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x0a0c14,
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
      app.stage.addChild(floorGraphics, ropeGraphics, ballGraphics, cupGraphics, popupContainer);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      let isPointerDown = false;
      let pointerX = 0;
      let pointerY = 0;
      let draggingPointerId: number | null = null;
      const floatingScores: FloatingScore[] = [];

      world.onCatch = ({ points, combo: comboValue }) => {
        const label = comboValue > 1 ? `+${points} COMBO x${comboValue}` : `+${points}`;
        const text = new Text({
          text: label,
          style: { fill: 0xffe066, fontSize: 18, fontWeight: "700" },
        });
        text.anchor.set(0.5, 1);
        text.position.set(world.cup.x, world.cup.y - 60);
        popupContainer.addChild(text);
        floatingScores.push({ text, age: 0 });
      };

      const loop = new GameLoop((deltaSeconds) => {
        if (isPointerDown) {
          world.setCupPosition(pointerX, pointerY);
        } else {
          let kx = 0;
          let ky = 0;
          if (input.isKeyDown("arrowleft") || input.isKeyDown("a")) kx -= 1;
          if (input.isKeyDown("arrowright") || input.isKeyDown("d")) kx += 1;
          if (input.isKeyDown("arrowup") || input.isKeyDown("w")) ky -= 1;
          if (input.isKeyDown("arrowdown") || input.isKeyDown("s")) ky += 1;
          if (kx !== 0 || ky !== 0) {
            const length = Math.hypot(kx, ky) || 1;
            world.moveCupBy(
              (kx / length) * CUP_KEY_SPEED * deltaSeconds,
              (ky / length) * CUP_KEY_SPEED * deltaSeconds,
            );
          }
        }

        world.step(deltaSeconds);
        setScore(Math.floor(world.score));
        setCombo(world.combo);
        setLives(world.lives);
        if (world.isOver) setIsOver(true);

        const floorY = world.height - 18;
        floorGraphics
          .clear()
          .rect(0, floorY, world.width, Math.max(0, world.height - floorY))
          .fill({ color: 0xff6b6b, alpha: 0.12 })
          .moveTo(0, floorY)
          .lineTo(world.width, floorY)
          .stroke({ width: 2, color: 0xff6b6b, alpha: 0.5 });

        ropeGraphics
          .clear()
          .moveTo(world.cup.x, world.cup.y)
          .lineTo(world.ball.x, world.ball.y)
          .stroke({ width: 2, color: 0xffffff, alpha: 0.35 });

        const mouthX = world.cup.x;
        const mouthY = world.cup.y - 32;
        cupGraphics
          .clear()
          .circle(mouthX, mouthY, world.catchRadius)
          .stroke({ width: 2, color: 0x6ee7ff, alpha: world.isHeld ? 0.9 : 0.45 })
          .moveTo(world.cup.x - 22, world.cup.y - 6)
          .lineTo(world.cup.x - 14, world.cup.y + 16)
          .lineTo(world.cup.x + 14, world.cup.y + 16)
          .lineTo(world.cup.x + 22, world.cup.y - 6)
          .stroke({ width: 4, color: 0x6ee7ff, alpha: 0.9 })
          .circle(world.cup.x, world.cup.y, 5)
          .fill({ color: 0x6ee7ff, alpha: 0.9 });

        ballGraphics
          .clear()
          .circle(world.ball.x, world.ball.y, 13)
          .fill({ color: world.isHeld ? 0xffe066 : 0x7cf5c4, alpha: 0.95 });

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
      title="Kendama Swing"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="kendama-swing-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="kendama-swing-canvas" />
        <div className={styles.hud}>
          <span className={styles.combo} data-testid="kendama-swing-combo">
            COMBO {combo}
          </span>
          <span className={styles.lives} data-testid="kendama-swing-lives">
            {"♥".repeat(Math.max(0, lives))}
            {"♡".repeat(Math.max(0, 3 - lives))}
          </span>
        </div>
        <div className={styles.hint}>
          ドラッグ/長押しでカップを動かし、玉を振り上げて受け口に収め続けよう。床に落とすとライフが減る。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="kendama-swing-gameover">
            <div className={styles.gameOverTitle}>ゲームオーバー</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="kendama-swing-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
