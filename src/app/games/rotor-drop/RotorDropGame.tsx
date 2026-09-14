"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import { type MarbleResolvedEvent, ROUND_SECONDS, RotorDropWorld } from "./engine/world";
import styles from "./RotorDropGame.module.scss";

interface FloatingPopup {
  text: Text;
  age: number;
}

const POPUP_LIFETIME = 0.7;
const PEG_COLOR = 0x6ee7ff;
const MARBLE_COLOR = 0xffe066;
const GOAL_COLOR = 0x7cf5c4;
const HAZARD_COLOR = 0xff6b6b;

export function RotorDropGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(ROUND_SECONDS);
  const [collected, setCollected] = useState(0);
  const [missed, setMissed] = useState(0);
  const [combo, setCombo] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<RotorDropWorld | null>(null);
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
    const world = new RotorDropWorld(1, 1);
    worldRef.current = world;

    const goalGraphics = new Graphics();
    const pegGraphics = new Graphics();
    const marbleGraphics = new Graphics();
    const popupHost = new Container();
    const floatingPopups: FloatingPopup[] = [];
    let lastGoalWidth = -1;
    let lastGoalHeight = -1;

    world.onMarbleResolved = (event: MarbleResolvedEvent) => {
      const text = new Text({
        text: event.isCollected ? `+${event.points}` : "MISS",
        style: {
          fill: event.isCollected ? 0xffe066 : 0xff9d9d,
          fontSize: event.isCollected ? 20 : 14,
          fontWeight: "700",
        },
      });
      text.anchor.set(0.5, 1);
      text.position.set(event.x, world.exitY);
      popupHost.addChild(text);
      floatingPopups.push({ text, age: 0 });
    };

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
      app.stage.addChild(goalGraphics, pegGraphics, marbleGraphics, popupHost);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        const pointer = input.getPrimaryPointer();
        if (pointer) {
          world.setRotationInput(pointer.x < world.width / 2 ? -1 : 1);
        } else if (input.isKeyDown("arrowleft") || input.isKeyDown("a")) {
          world.setRotationInput(-1);
        } else if (input.isKeyDown("arrowright") || input.isKeyDown("d")) {
          world.setRotationInput(1);
        } else {
          world.setRotationInput(0);
        }

        world.step(deltaSeconds);

        setScore(world.score);
        setTimeRemaining(Math.ceil(world.timeRemaining));
        setCollected(world.marblesCollected);
        setMissed(world.marblesMissed);
        setCombo(world.combo);
        if (world.isOver) setIsOver(true);

        // ゴール/ハズレの帯は画面サイズが変わったときだけ描き直せば十分。
        if (world.width !== lastGoalWidth || world.height !== lastGoalHeight) {
          lastGoalWidth = world.width;
          lastGoalHeight = world.height;

          goalGraphics.clear();
          goalGraphics
            .rect(0, world.exitY, world.width, Math.max(0, world.height - world.exitY))
            .fill({ color: HAZARD_COLOR, alpha: 0.12 })
            .rect(
              world.centerX - world.goalHalfWidth,
              world.exitY,
              world.goalHalfWidth * 2,
              Math.max(0, world.height - world.exitY),
            )
            .fill({ color: GOAL_COLOR, alpha: 0.22 })
            .moveTo(0, world.exitY)
            .lineTo(world.width, world.exitY)
            .stroke({ width: 2, color: 0xf2f3f5, alpha: 0.4 });
        }

        // 釘は毎フレーム回転するので、その都度描き直す。
        pegGraphics.clear();
        for (const peg of world.getPegPositions()) {
          pegGraphics
            .circle(peg.x, peg.y, 13)
            .fill({ color: PEG_COLOR, alpha: 0.9 })
            .stroke({ width: 2, color: 0xf2f3f5, alpha: 0.5 });
        }

        marbleGraphics.clear();
        for (const marble of world.marbles) {
          marbleGraphics
            .circle(marble.x, marble.y, 8)
            .fill({ color: MARBLE_COLOR })
            .stroke({ width: 1.5, color: 0x0a0c14, alpha: 0.6 });
        }

        for (let i = floatingPopups.length - 1; i >= 0; i--) {
          const entry = floatingPopups[i];
          entry.age += deltaSeconds;
          entry.text.position.y -= deltaSeconds * 32;
          entry.text.alpha = Math.max(0, 1 - entry.age / POPUP_LIFETIME);
          if (entry.age >= POPUP_LIFETIME) {
            popupHost.removeChild(entry.text);
            entry.text.destroy();
            floatingPopups.splice(i, 1);
          }
        }
      }, 0.1);

      input.addListener({
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
      title="Rotor Drop"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="rotor-drop-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="rotor-drop-canvas" />
        <div className={styles.rotateZones} aria-hidden="true">
          <div className={styles.rotateZone}>← 反時計回り</div>
          <div className={styles.rotateZone}>時計回り →</div>
        </div>
        <div className={styles.hud}>
          <span className={styles.time} data-testid="rotor-drop-time">
            残り {timeRemaining}秒
          </span>
          <span className={styles.result} data-testid="rotor-drop-collected">
            OK {collected}
          </span>
          <span className={styles.result} data-testid="rotor-drop-missed">
            MISS {missed}
          </span>
          {combo >= 2 && (
            <span className={styles.combo} data-testid="rotor-drop-combo">
              COMBO {combo}
            </span>
          )}
        </div>
        <div className={styles.hint}>
          画面の左右どちらかを長押し(または矢印キー/A・D長押し)して釘のリングを回転させ、
          落ちてくるマーブルを中央の緑ゾーンへ導け。Space: 一時停止 / R: リセット。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="rotor-drop-gameover">
            <div className={styles.gameOverTitle}>タイムアップ</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <div className={styles.gameOverSub}>
              OK {collected} / MISS {missed}
            </div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="rotor-drop-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
