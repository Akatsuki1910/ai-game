"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import { createBackgroundFilter } from "./engine/backgroundFilter";
import { type Prism, PrismDriftWorld } from "./engine/world";
import styles from "./PrismDriftGame.module.scss";

const PRISM_COLORS: Record<Prism["type"], number> = {
  mirror: 0x6ee7ff,
  splitter: 0x7cf5c4,
};

interface FloatingScore {
  text: Text;
  age: number;
}

const POPUP_LIFETIME = 0.9;

export function PrismDriftGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const canvasHostRef = useRef<HTMLDivElement | null>(null);

  const worldRef = useRef<PrismDriftWorld | null>(null);
  const appRef = useRef<Application | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);

  const [score, setScore] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(90);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    let disposed = false;

    const app = new Application();
    const world = new PrismDriftWorld(1, 1);
    worldRef.current = world;

    const backgroundGraphics = new Graphics();
    const backgroundFilter = createBackgroundFilter();
    backgroundGraphics.filters = [backgroundFilter];

    const beamGraphics = new Graphics();
    const prismGraphics = new Graphics();
    const targetGraphics = new Graphics();
    const emitterGraphics = new Graphics();
    const popupContainer = new Container();
    const floatingScores: FloatingScore[] = [];
    const draggingByPointer = new Map<number, number>();
    let drawnBackgroundWidth = -1;
    let drawnBackgroundHeight = -1;

    world.onTargetCompleted = ({ target, points, combo }) => {
      const label = combo > 0 ? `+${points} COMBO x${combo + 1}` : `+${points}`;
      const text = new Text({
        text: label,
        style: { fill: 0xffe066, fontSize: 18, fontWeight: "700" },
      });
      text.anchor.set(0.5, 1);
      text.position.set(target.x, target.y - target.radius);
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
        backgroundGraphics,
        beamGraphics,
        targetGraphics,
        prismGraphics,
        emitterGraphics,
        popupContainer,
      );
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        world.step(deltaSeconds);
        setScore(Math.floor(world.score));
        setTimeRemaining(Math.ceil(world.timeRemaining));
        if (world.isOver) setIsOver(true);

        backgroundFilter.time += deltaSeconds;
        if (drawnBackgroundWidth !== world.width || drawnBackgroundHeight !== world.height) {
          drawnBackgroundWidth = world.width;
          drawnBackgroundHeight = world.height;
          backgroundGraphics
            .clear()
            .rect(0, 0, world.width, world.height)
            .fill({ color: 0xffffff });
        }

        beamGraphics.clear();
        for (const seg of world.lastSegments) {
          const alpha = Math.max(0.35, 1 - seg.depth * 0.15);
          beamGraphics
            .moveTo(seg.x1, seg.y1)
            .lineTo(seg.x2, seg.y2)
            .stroke({ width: 3, color: 0xffffff, alpha });
        }

        prismGraphics.clear();
        for (const prism of world.prisms) {
          prismGraphics
            .circle(prism.x, prism.y, prism.radius)
            .fill({ color: PRISM_COLORS[prism.type], alpha: 0.85 })
            .stroke({ width: 2, color: 0xffffff, alpha: 0.6 });
        }

        targetGraphics.clear();
        for (const target of world.targets) {
          const t = target.charge / 100;
          targetGraphics
            .circle(target.x, target.y, target.radius + 6)
            .stroke({ width: 3, color: 0xffffff, alpha: 0.15 + t * 0.5 });
          targetGraphics
            .circle(target.x, target.y, target.radius * (0.5 + t * 0.5))
            .fill({ color: target.illuminated ? 0xffe066 : 0xff6b6b, alpha: 0.9 });
        }

        emitterGraphics.clear();
        emitterGraphics.circle(4, world.height / 2, 10).fill({ color: 0xffffff });

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
          const prism = world.findPrismAt(pointer.x, pointer.y);
          if (prism) draggingByPointer.set(pointer.id, prism.id);
        },
        onPointerMove: (pointer) => {
          const prismId = draggingByPointer.get(pointer.id);
          if (prismId !== undefined) world.setPrismPosition(prismId, pointer.x, pointer.y);
        },
        onPointerUp: (pointer) => {
          const prismId = draggingByPointer.get(pointer.id);
          draggingByPointer.delete(pointer.id);
          if (prismId === undefined) return;
          const dragDistance = Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY);
          if (dragDistance < 6) world.cyclePrismType(prismId);
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
      title="Prism Drift"
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
          プリズムをドラッグして移動、タップで種類を切り替え（水色=ミラー /
          緑=分岐）。揺れ動く的にレーザーを当て続けてチャージしよう。
        </div>
        {isOver && (
          <div className={styles.gameOver}>
            <div className={styles.gameOverTitle}>ラウンド終了</div>
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
