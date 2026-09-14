"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import {
  type LockCompletedEvent,
  type LockMissedEvent,
  PulseLockWorld,
  START_LIVES,
  type TumblerSolvedEvent,
} from "./engine/world";
import styles from "./PulseLockGame.module.scss";

const SOLVED_COLOR = 0x7cf5c4;
const ACTIVE_COLOR = 0x6ee7ff;
const WAITING_COLOR = 0x4a4f5c;
const TARGET_COLOR = 0xffe066;
const INDICATOR_COLOR = 0xffffff;
const MISS_COLOR = 0xff6b6b;

const RADIUS_RATIO_MAX = 0.42;
const RADIUS_RATIO_MIN = 0.16;

interface FloatingPopup {
  text: Text;
  age: number;
}

const POPUP_LIFETIME = 1.0;

function ringRadius(width: number, height: number, count: number, index: number): number {
  const shortest = Math.min(width, height);
  const maxRadius = shortest * RADIUS_RATIO_MAX;
  if (count <= 1) return maxRadius;
  const minRadius = shortest * RADIUS_RATIO_MIN;
  return maxRadius - index * ((maxRadius - minRadius) / (count - 1));
}

export function PulseLockGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(START_LIVES);
  const [level, setLevel] = useState(1);
  const [combo, setCombo] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<PulseLockWorld | null>(null);
  const appRef = useRef<Application | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const sizeRef = useRef({ width: 0, height: 0 });

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

  const handleAttempt = useCallback(() => {
    if (!worldRef.current || loopRef.current?.isPaused) return;
    worldRef.current.attemptLock();
  }, []);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    let disposed = false;

    const app = new Application();
    const world = new PulseLockWorld();
    worldRef.current = world;

    const ringGraphics = new Graphics();
    const popupHost = new Container();
    const floatingPopups: FloatingPopup[] = [];

    const spawnPopup = (label: string, color: number, fontSize: number): void => {
      const { width, height } = sizeRef.current;
      const text = new Text({ text: label, style: { fill: color, fontSize, fontWeight: "700" } });
      text.anchor.set(0.5, 0.5);
      text.position.set(width / 2, height / 2);
      popupHost.addChild(text);
      floatingPopups.push({ text, age: 0 });
    };

    world.onTumblerSolved = ({ points, combo: comboCount }: TumblerSolvedEvent) => {
      const label = comboCount > 1 ? `+${points} COMBO x${comboCount}` : `+${points}`;
      spawnPopup(label, TARGET_COLOR, 20);
    };
    world.onLockMissed = (_event: LockMissedEvent) => {
      spawnPopup("MISS", MISS_COLOR, 18);
    };
    world.onLockCompleted = ({ bonus }: LockCompletedEvent) => {
      spawnPopup(`LOCK OPEN! +${bonus}`, SOLVED_COLOR, 24);
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x0a0910,
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
      app.stage.addChild(ringGraphics, popupHost);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        world.step(deltaSeconds);

        setScore(world.score);
        setLives(world.lives);
        setLevel(world.level);
        setCombo(world.combo);
        if (world.isOver) setIsOver(true);

        const { width, height } = sizeRef.current;
        if (width > 0 && height > 0) {
          const cx = width / 2;
          const cy = height / 2;
          const count = world.tumblers.length;

          ringGraphics.clear();
          for (let i = 0; i < count; i++) {
            const tumbler = world.tumblers[i];
            const radius = ringRadius(width, height, count, i);
            const isActive = i === world.activeTumblerIndex;
            const ringColor = tumbler.isSolved
              ? SOLVED_COLOR
              : isActive
                ? ACTIVE_COLOR
                : WAITING_COLOR;
            const ringAlpha = tumbler.isSolved ? 0.3 : isActive ? 0.85 : 0.25;
            ringGraphics
              .circle(cx, cy, radius)
              .stroke({ width: 2, color: ringColor, alpha: ringAlpha });

            const zoneStartX = cx + Math.cos(tumbler.targetStart) * radius;
            const zoneStartY = cy + Math.sin(tumbler.targetStart) * radius;
            ringGraphics
              .moveTo(zoneStartX, zoneStartY)
              .arc(cx, cy, radius, tumbler.targetStart, tumbler.targetStart + tumbler.targetWidth)
              .stroke({
                width: isActive ? 10 : 6,
                color: TARGET_COLOR,
                alpha: tumbler.isSolved ? 0.2 : isActive ? 0.9 : 0.3,
              });

            if (tumbler.isSolved) {
              const midAngle = tumbler.targetStart + tumbler.targetWidth / 2;
              const markerX = cx + Math.cos(midAngle) * radius;
              const markerY = cy + Math.sin(midAngle) * radius;
              ringGraphics.circle(markerX, markerY, 5).fill({ color: SOLVED_COLOR });
            } else {
              const dirX = Math.cos(tumbler.angle);
              const dirY = Math.sin(tumbler.angle);
              ringGraphics
                .moveTo(cx + dirX * (radius - 12), cy + dirY * (radius - 12))
                .lineTo(cx + dirX * (radius + 12), cy + dirY * (radius + 12))
                .stroke({
                  width: isActive ? 4 : 2,
                  color: INDICATOR_COLOR,
                  alpha: isActive ? 1 : 0.35,
                });
            }
          }
        }

        for (let i = floatingPopups.length - 1; i >= 0; i--) {
          const entry = floatingPopups[i];
          entry.age += deltaSeconds;
          entry.text.position.y -= deltaSeconds * 26;
          entry.text.alpha = Math.max(0, 1 - entry.age / POPUP_LIFETIME);
          if (entry.age >= POPUP_LIFETIME) {
            popupHost.removeChild(entry.text);
            entry.text.destroy();
            floatingPopups.splice(i, 1);
          }
        }
      }, 0.1);

      input.addListener({
        onPointerDown: () => {
          handleAttempt();
        },
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
          } else if (key === "r") {
            world.reset();
            setIsOver(false);
          } else if (key === "enter") {
            handleAttempt();
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
  }, [handleAttempt]);

  useEffect(() => {
    sizeRef.current = { width: size.width, height: size.height };
  }, [size.width, size.height]);

  return (
    <GameShell
      title="Pulse Lock"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="pulse-lock-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="pulse-lock-canvas" />
        <div className={styles.hud}>
          <span className={styles.level} data-testid="pulse-lock-level">
            LEVEL {level}
          </span>
          <span className={styles.lives} data-testid="pulse-lock-lives">
            ライフ {lives}
          </span>
          {combo >= 2 && (
            <span className={styles.combo} data-testid="pulse-lock-combo">
              COMBO {combo}
            </span>
          )}
        </div>
        <div className={styles.hint}>
          リングを流れる指針が黄色いターゲットゾーンに重なった瞬間にタップ(またはEnterキー)で解錠。外すとライフが1減る。すべて解錠すると次のロックへ。Space:
          一時停止 / R: リセット。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="pulse-lock-gameover">
            <div className={styles.gameOverTitle}>ロック失敗</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <div className={styles.gameOverSub}>到達レベル {level}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="pulse-lock-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
