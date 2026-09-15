"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import {
  type CallAnsweredEvent,
  type CallMissedEvent,
  DOT_HOLD_THRESHOLD_MS,
  type LevelClearedEvent,
  SignalLanternWorld,
  type SignalPhase,
  type SignalSymbol,
  START_LIVES,
} from "./engine/world";
import styles from "./SignalLanternGame.module.scss";

const LIT_COLOR = 0xffd166;
const UNLIT_COLOR = 0x33455c;
const DOT_COLOR = 0x6ee7ff;
const DASH_COLOR = 0xffb454;
const PIP_DONE_COLOR = 0x7cf5c4;
const PIP_WAIT_COLOR = 0x3a4152;
const MISS_COLOR = 0xff6b6b;
const TIMER_SAFE_COLOR = 0x7cf5c4;
const TIMER_WARN_COLOR = 0xffb454;
const TIMER_DANGER_COLOR = 0xff6b6b;

const HOLD_GAUGE_MAX_MS = 900;

interface FloatingPopup {
  text: Text;
  age: number;
}

const POPUP_LIFETIME = 1.0;

function timerColorForFraction(fraction: number): number {
  if (fraction > 0.5) return TIMER_SAFE_COLOR;
  if (fraction > 0.2) return TIMER_WARN_COLOR;
  return TIMER_DANGER_COLOR;
}

export function SignalLanternGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(START_LIVES);
  const [level, setLevel] = useState(1);
  const [combo, setCombo] = useState(0);
  const [symbol, setSymbol] = useState<SignalSymbol>("dot");
  const [phase, setPhase] = useState<SignalPhase>("showing");
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<SignalLanternWorld | null>(null);
  const appRef = useRef<Application | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  const holdStartRef = useRef<number | null>(null);

  const handleTogglePause = useCallback(() => {
    if (!loopRef.current) return;
    setIsPaused(loopRef.current.togglePause());
  }, []);

  const handleRestart = useCallback(() => {
    worldRef.current?.reset();
    holdStartRef.current = null;
    setIsOver(false);
    if (loopRef.current?.isPaused) {
      loopRef.current.resume();
      setIsPaused(false);
    }
  }, []);

  const handleLeverDown = useCallback(() => {
    if (!worldRef.current || loopRef.current?.isPaused) return;
    holdStartRef.current = performance.now();
  }, []);

  const handleLeverUp = useCallback(() => {
    const startedAt = holdStartRef.current;
    holdStartRef.current = null;
    if (startedAt === null || !worldRef.current || loopRef.current?.isPaused) return;
    worldRef.current.releaseLever(performance.now() - startedAt);
  }, []);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    let disposed = false;

    const app = new Application();
    const world = new SignalLanternWorld();
    worldRef.current = world;

    const lanternGraphics = new Graphics();
    const pipGraphics = new Graphics();
    const timerGraphics = new Graphics();
    const holdGaugeGraphics = new Graphics();
    const popupHost = new Container();
    const floatingPopups: FloatingPopup[] = [];

    const spawnPopup = (label: string, color: number, fontSize: number): void => {
      const { width, height } = sizeRef.current;
      const text = new Text({ text: label, style: { fill: color, fontSize, fontWeight: "700" } });
      text.anchor.set(0.5, 0.5);
      text.position.set(width / 2, height * 0.32);
      popupHost.addChild(text);
      floatingPopups.push({ text, age: 0 });
    };

    world.onCallAnswered = ({ points, combo: comboCount }: CallAnsweredEvent) => {
      const label = comboCount > 1 ? `+${points} COMBO x${comboCount}` : `+${points}`;
      spawnPopup(label, PIP_DONE_COLOR, 20);
    };
    world.onCallMissed = ({ reason }: CallMissedEvent) => {
      spawnPopup(reason === "timeout" ? "TIME UP" : "MISS", MISS_COLOR, 18);
    };
    world.onLevelCleared = ({ bonus }: LevelClearedEvent) => {
      spawnPopup(`SIGNAL CLEAR! +${bonus}`, LIT_COLOR, 24);
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x060912,
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
      app.stage.addChild(lanternGraphics, pipGraphics, timerGraphics, holdGaugeGraphics, popupHost);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        world.step(deltaSeconds);

        setScore(world.score);
        setLives(world.lives);
        setLevel(world.level);
        setCombo(world.combo);
        setSymbol(world.currentSymbol);
        setPhase(world.phase);
        if (world.isOver) setIsOver(true);

        const { width, height } = sizeRef.current;
        if (width > 0 && height > 0) {
          const cx = width / 2;
          const lanternCy = height * 0.3;
          const lanternRadius = Math.max(24, Math.min(width, height) * 0.14);
          const isLit = world.phase === "showing";
          const symbolColor = world.currentSymbol === "dot" ? DOT_COLOR : DASH_COLOR;

          lanternGraphics.clear();
          lanternGraphics
            .circle(cx, lanternCy, lanternRadius * 1.6)
            .fill({ color: isLit ? symbolColor : UNLIT_COLOR, alpha: isLit ? 0.18 : 0.08 });
          lanternGraphics
            .circle(cx, lanternCy, lanternRadius)
            .fill({ color: isLit ? LIT_COLOR : UNLIT_COLOR, alpha: isLit ? 1 : 0.6 })
            .stroke({ color: symbolColor, width: 3, alpha: isLit ? 1 : 0.4 });

          const pipCount = world.callsRequired;
          const pipRadius = 7;
          const pipGap = 22;
          const pipRowWidth = (pipCount - 1) * pipGap;
          const pipY = height * 0.5;
          pipGraphics.clear();
          for (let i = 0; i < pipCount; i++) {
            const px = cx - pipRowWidth / 2 + i * pipGap;
            const isDone = i < world.roundIndex;
            pipGraphics
              .circle(px, pipY, pipRadius)
              .fill({ color: isDone ? PIP_DONE_COLOR : PIP_WAIT_COLOR, alpha: isDone ? 1 : 0.5 });
          }

          const barWidth = Math.min(width * 0.6, 360);
          const barHeight = 10;
          const barX = cx - barWidth / 2;
          const barY = height * 0.6;
          timerGraphics.clear();
          timerGraphics
            .roundRect(barX, barY, barWidth, barHeight, 5)
            .fill({ color: 0x161b26, alpha: 0.9 });
          if (world.phase === "input" && world.inputTimeLimitSeconds > 0) {
            const fraction = Math.max(
              0,
              Math.min(1, world.inputTimeRemaining / world.inputTimeLimitSeconds),
            );
            timerGraphics
              .roundRect(barX, barY, barWidth * fraction, barHeight, 5)
              .fill({ color: timerColorForFraction(fraction), alpha: 0.95 });
          }

          const gaugeY = height * 0.7;
          holdGaugeGraphics.clear();
          holdGaugeGraphics
            .roundRect(barX, gaugeY, barWidth, barHeight, 5)
            .fill({ color: 0x161b26, alpha: 0.9 });
          const thresholdRatio = Math.min(1, DOT_HOLD_THRESHOLD_MS / HOLD_GAUGE_MAX_MS);
          holdGaugeGraphics
            .rect(barX + barWidth * thresholdRatio - 1, gaugeY - 3, 2, barHeight + 6)
            .fill({ color: 0xffffff, alpha: 0.7 });
          if (holdStartRef.current !== null) {
            const heldMs = performance.now() - holdStartRef.current;
            const holdFraction = Math.max(0, Math.min(1, heldMs / HOLD_GAUGE_MAX_MS));
            const holdColor = heldMs < DOT_HOLD_THRESHOLD_MS ? DOT_COLOR : DASH_COLOR;
            holdGaugeGraphics
              .roundRect(barX, gaugeY, barWidth * holdFraction, barHeight, 5)
              .fill({ color: holdColor, alpha: 0.95 });
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
          handleLeverDown();
        },
        onPointerUp: () => {
          handleLeverUp();
        },
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
          } else if (key === "r") {
            world.reset();
            holdStartRef.current = null;
            setIsOver(false);
          } else if (key === "enter") {
            handleLeverDown();
          }
        },
        onKeyUp: (key) => {
          if (key === "enter") {
            handleLeverUp();
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
  }, [handleLeverDown, handleLeverUp]);

  useEffect(() => {
    sizeRef.current = { width: size.width, height: size.height };
  }, [size.width, size.height]);

  return (
    <GameShell
      title="Signal Lantern"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="signal-lantern-stage">
        <div
          ref={canvasHostRef}
          className={styles.canvasHost}
          data-testid="signal-lantern-canvas"
        />
        <div className={styles.hud}>
          <span className={styles.level} data-testid="signal-lantern-level">
            LEVEL {level}
          </span>
          <span className={styles.lives} data-testid="signal-lantern-lives">
            ライフ {lives}
          </span>
          {combo >= 2 && (
            <span className={styles.combo} data-testid="signal-lantern-combo">
              COMBO {combo}
            </span>
          )}
        </div>
        <div className={styles.symbolHud} data-testid="signal-lantern-symbol-hint">
          {phase === "input" ? "応答受付中: " : "信号: "}
          {symbol === "dot" ? "・短く" : "－長く"}
        </div>
        <div className={styles.hint}>
          灯台の光の長さ(点=短い/線=長い)を見て、光っていた長さぶん画面(またはEnterキー)を長押しして離すと応答できる。応答フェーズの制限時間内に離さないとミスになる。長押しの目安は下のゲージで確認できる。Space:
          一時停止 / R: リセット。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="signal-lantern-gameover">
            <div className={styles.gameOverTitle}>信号途絶</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <div className={styles.gameOverSub}>到達レベル {level}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="signal-lantern-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
