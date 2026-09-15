"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import { GyroVaultWorld, ROUND_SECONDS } from "./engine/world";
import styles from "./GyroVaultGame.module.scss";

interface FloatingPopup {
  text: Text;
  age: number;
}

const POPUP_LIFETIME = 1;
const MAX_TILT_DRAG = 70; // px。この距離ドラッグすると傾き最大になる

export function GyroVaultGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(ROUND_SECONDS);
  const [goalCount, setGoalCount] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<GyroVaultWorld | null>(null);
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
    setGoalCount(0);
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
    const world = new GyroVaultWorld(1, 1);
    worldRef.current = world;

    const backgroundGraphics = new Graphics();
    const wallGraphics = new Graphics();
    const holeGraphics = new Graphics();
    const checkpointGraphics = new Graphics();
    const goalGraphics = new Graphics();
    const ballGraphics = new Graphics();
    const popupContainer = new Container();
    const floatingPopups: FloatingPopup[] = [];

    let dragPointerId: number | null = null;
    let dragTiltX = 0;
    let dragTiltY = 0;
    let elapsed = 0;

    function spawnPopup(text: string, x: number, y: number, color: number): void {
      const label = new Text({ text, style: { fill: color, fontSize: 18, fontWeight: "700" } });
      label.anchor.set(0.5, 1);
      label.position.set(x, y);
      popupContainer.addChild(label);
      floatingPopups.push({ text: label, age: 0 });
    }

    world.onGoalReached = ({ points, goalCount: nextGoalCount }) => {
      spawnPopup(`+${points}`, world.goal.x, world.goal.y - world.goal.radius, 0xffe066);
      setGoalCount(nextGoalCount);
    };
    world.onFall = ({ penaltySeconds }) => {
      spawnPopup(`-${penaltySeconds}s`, world.ball.x, world.ball.y, 0xff6b6b);
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x0c0a08,
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
        checkpointGraphics,
        holeGraphics,
        wallGraphics,
        goalGraphics,
        ballGraphics,
        popupContainer,
      );
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        elapsed += deltaSeconds;

        const tilt = { x: dragTiltX, y: dragTiltY };
        if (input.isKeyDown("arrowleft") || input.isKeyDown("a")) tilt.x -= 1;
        if (input.isKeyDown("arrowright") || input.isKeyDown("d")) tilt.x += 1;
        if (input.isKeyDown("arrowup") || input.isKeyDown("w")) tilt.y -= 1;
        if (input.isKeyDown("arrowdown") || input.isKeyDown("s")) tilt.y += 1;

        world.step(deltaSeconds, tilt);
        setScore(world.score);
        setTimeRemaining(Math.ceil(world.timeRemaining));
        if (world.isOver) setIsOver(true);

        // 常時アニメーションする背景の警戒スキャンリング（未操作時も画面が動く）
        backgroundGraphics.clear();
        backgroundGraphics.rect(0, 0, world.width, world.height).fill({ color: 0x14100c });
        const ringCount = 4;
        for (let i = 0; i < ringCount; i++) {
          const phase = (elapsed * 0.4 + i / ringCount) % 1;
          const radius = phase * Math.hypot(world.width, world.height) * 0.6;
          backgroundGraphics
            .circle(world.width * 0.5, world.height * 0.5, radius)
            .stroke({ width: 2, color: 0xffb454, alpha: (1 - phase) * 0.12 });
        }

        wallGraphics.clear();
        for (const wall of world.walls) {
          wallGraphics
            .roundRect(wall.x, wall.y, wall.width, wall.height, 4)
            .fill({ color: 0x3a2e1c })
            .stroke({ width: 2, color: 0xffb454, alpha: 0.5 });
        }

        holeGraphics.clear();
        for (const hole of world.holes) {
          holeGraphics.circle(hole.x, hole.y, hole.radius).fill({ color: 0x05050a });
          const swirl = elapsed * 2.2;
          for (let i = 0; i < 3; i++) {
            const angle = swirl + (i * Math.PI * 2) / 3;
            const r = hole.radius * 0.6;
            holeGraphics
              .circle(
                hole.x + Math.cos(angle) * r,
                hole.y + Math.sin(angle) * r,
                hole.radius * 0.12,
              )
              .fill({ color: 0xff6b6b, alpha: 0.45 });
          }
        }

        checkpointGraphics.clear();
        checkpointGraphics
          .circle(world.checkpoint.x, world.checkpoint.y, world.checkpoint.radius)
          .stroke({ width: 2, color: 0x6ee7ff, alpha: 0.7 })
          .circle(world.checkpoint.x, world.checkpoint.y, 3)
          .fill({ color: 0x6ee7ff });

        goalGraphics.clear();
        const goalPulse = 0.5 + Math.sin(elapsed * 3) * 0.5;
        goalGraphics
          .circle(world.goal.x, world.goal.y, world.goal.radius + goalPulse * 6)
          .fill({ color: 0x7cf5c4, alpha: 0.15 + goalPulse * 0.15 })
          .circle(world.goal.x, world.goal.y, world.goal.radius * 0.6)
          .fill({ color: 0x7cf5c4, alpha: 0.9 });

        ballGraphics.clear();
        ballGraphics
          .circle(world.ball.x, world.ball.y, world.ball.radius)
          .fill({ color: 0xf2f3f5 })
          .circle(
            world.ball.x - world.ball.radius * 0.3,
            world.ball.y - world.ball.radius * 0.3,
            world.ball.radius * 0.35,
          )
          .fill({ color: 0xffffff, alpha: 0.7 });

        for (let i = floatingPopups.length - 1; i >= 0; i--) {
          const entry = floatingPopups[i];
          entry.age += deltaSeconds;
          entry.text.position.y -= deltaSeconds * 26;
          entry.text.alpha = Math.max(0, 1 - entry.age / POPUP_LIFETIME);
          if (entry.age >= POPUP_LIFETIME) {
            popupContainer.removeChild(entry.text);
            entry.text.destroy();
            floatingPopups.splice(i, 1);
          }
        }
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => {
          if (dragPointerId !== null) return;
          dragPointerId = pointer.id;
          dragTiltX = 0;
          dragTiltY = 0;
        },
        onPointerMove: (pointer) => {
          if (pointer.id !== dragPointerId) return;
          dragTiltX = Math.min(Math.max((pointer.x - pointer.startX) / MAX_TILT_DRAG, -1), 1);
          dragTiltY = Math.min(Math.max((pointer.y - pointer.startY) / MAX_TILT_DRAG, -1), 1);
        },
        onPointerUp: (pointer) => {
          if (pointer.id !== dragPointerId) return;
          dragPointerId = null;
          dragTiltX = 0;
          dragTiltY = 0;
        },
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
          } else if (key === "r") {
            world.reset();
            setIsOver(false);
            setGoalCount(0);
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
      title="Gyro Vault"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="gyro-vault-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="gyro-vault-canvas" />
        <div className={styles.hud}>
          <span className={styles.timer} data-testid="gyro-vault-timer">
            ⏱ {timeRemaining}s
          </span>
          <span className={styles.goalCount} data-testid="gyro-vault-goal-count">
            🏆 {goalCount}
          </span>
        </div>
        <div className={styles.hint}>
          ドラッグ（または矢印キー/WASD）で盤面を傾けてボールを転がし、穴を避けてゴールの宝石を目指せ。
          チェックポイントを踏むと落下時の復帰地点が進む。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="gyro-vault-gameover">
            <div className={styles.gameOverTitle}>タイムアップ</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="gyro-vault-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
