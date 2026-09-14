"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import {
  type BeatResolvedEvent,
  INTEGRITY_MAX,
  LoomWeaveWorld,
  TARGET_ROWS,
  THREAD_COLORS,
  type ThreadColor,
} from "./engine/world";
import styles from "./LoomWeaveGame.module.scss";

const THREAD_HEX = {
  indigo: 0x5b6ee8,
  gold: 0xffd166,
  crimson: 0xff6b6b,
} as const satisfies Record<ThreadColor, number>;

const THREAD_LABEL = {
  indigo: "藍",
  gold: "金",
  crimson: "緋",
} as const satisfies Record<ThreadColor, string>;

const FLAW_COLOR = 0x4a4f5c;
const EMPTY_SLOT_COLOR = 0x23262f;
const RING_TRACK_COLOR = 0x2b2f3a;
const URGENT_COLOR = 0xff6b6b;
const URGENT_THRESHOLD = 0.25;

interface FloatingPopup {
  text: Text;
  age: number;
}

const POPUP_LIFETIME = 0.9;

function ringRadius(width: number, height: number): number {
  const raw = Math.min(width, height) * 0.16;
  return Math.min(120, Math.max(36, raw));
}

export function LoomWeaveGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [rowsWoven, setRowsWoven] = useState(0);
  const [integrity, setIntegrity] = useState(INTEGRITY_MAX);
  const [combo, setCombo] = useState(0);
  const [activeColor, setActiveColor] = useState<ThreadColor>(THREAD_COLORS[0]);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);
  const [outcome, setOutcome] = useState<"torn" | "finished" | null>(null);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<LoomWeaveWorld | null>(null);
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
    setOutcome(null);
    if (loopRef.current?.isPaused) {
      loopRef.current.resume();
      setIsPaused(false);
    }
  }, []);

  const handleSelectColor = useCallback((color: ThreadColor) => {
    if (!worldRef.current || loopRef.current?.isPaused) return;
    worldRef.current.selectColor(color);
  }, []);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    let disposed = false;

    const app = new Application();
    const world = new LoomWeaveWorld();
    worldRef.current = world;

    const progressGraphics = new Graphics();
    const ringGraphics = new Graphics();
    const queueGraphics = new Graphics();
    const popupHost = new Container();
    const floatingPopups: FloatingPopup[] = [];

    const spawnPopup = (label: string, color: number): void => {
      const { width, height } = sizeRef.current;
      const radius = ringRadius(width, height);
      const text = new Text({
        text: label,
        style: { fill: color, fontSize: 18, fontWeight: "700" },
      });
      text.anchor.set(0.5, 0.5);
      text.position.set(width / 2, height * 0.36 - radius - 16);
      popupHost.addChild(text);
      floatingPopups.push({ text, age: 0 });
    };

    world.onBeatResolved = ({
      isCorrect,
      requiredColor,
      combo: comboCount,
      points,
    }: BeatResolvedEvent) => {
      if (isCorrect) {
        const label = comboCount > 1 ? `+${points} COMBO x${comboCount}` : `+${points}`;
        spawnPopup(label, THREAD_HEX[requiredColor]);
      } else {
        spawnPopup("ほつれた…", URGENT_COLOR);
      }
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x0e0d16,
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
      app.stage.addChild(progressGraphics, ringGraphics, queueGraphics, popupHost);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        world.step(deltaSeconds);

        setScore(world.score);
        setRowsWoven(world.rows.length);
        setIntegrity(world.integrity);
        setCombo(world.combo);
        setActiveColor(world.activeColor);
        if (world.isOver) {
          setIsOver(true);
          setOutcome(world.outcome);
        }

        const { width, height } = sizeRef.current;
        if (width > 0 && height > 0) {
          const cx = width / 2;
          const cy = height * 0.36;
          const radius = ringRadius(width, height);

          ringGraphics.clear();
          ringGraphics.circle(cx, cy, radius).stroke({ width: 10, color: RING_TRACK_COLOR });

          const arcColor =
            world.beatRatio < URGENT_THRESHOLD ? URGENT_COLOR : THREAD_HEX[world.activeColor];
          const startAngle = -Math.PI / 2;
          const endAngle = startAngle + Math.PI * 2 * world.beatRatio;
          if (world.beatRatio > 0) {
            ringGraphics
              .moveTo(cx + Math.cos(startAngle) * radius, cy + Math.sin(startAngle) * radius)
              .arc(cx, cy, radius, startAngle, endAngle)
              .stroke({ width: 10, color: arcColor });
          }
          ringGraphics
            .circle(cx, cy, radius * 0.62)
            .fill({ color: THREAD_HEX[world.activeColor], alpha: 0.85 })
            .stroke({ width: 2, color: 0xffffff, alpha: 0.5 });

          queueGraphics.clear();
          const queueY = cy + radius + 26;
          const upcoming = world.upcomingColors;
          const dotSpacing = 30;
          const queueStartX = cx - ((upcoming.length - 1) * dotSpacing) / 2;
          upcoming.forEach((color, index) => {
            const dotRadius = Math.max(6, 11 - index * 1.4);
            const alpha = Math.max(0.25, 0.95 - index * 0.18);
            queueGraphics
              .circle(queueStartX + index * dotSpacing, queueY, dotRadius)
              .fill({ color: THREAD_HEX[color], alpha });
          });

          progressGraphics.clear();
          const barX0 = width * 0.08;
          const barX1 = width * 0.92;
          const barY = height * 0.82;
          const barHeight = Math.min(26, Math.max(10, height * 0.05));
          const segmentWidth = (barX1 - barX0) / TARGET_ROWS;
          for (let i = 0; i < TARGET_ROWS; i++) {
            const row = world.rows[i];
            const segX = barX0 + i * segmentWidth;
            const fillColor = row
              ? row.isFlawed
                ? FLAW_COLOR
                : THREAD_HEX[row.color]
              : EMPTY_SLOT_COLOR;
            progressGraphics
              .rect(segX + 1, barY, Math.max(1, segmentWidth - 2), barHeight)
              .fill({ color: fillColor, alpha: row ? 0.95 : 0.6 });
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
        }
      }, 0.1);

      input.addListener({
        onKeyDown: (key) => {
          if (loop.isPaused && key !== " ") return;
          if (key === " ") {
            setIsPaused(loop.togglePause());
          } else if (key === "r") {
            world.reset();
            setIsOver(false);
            setOutcome(null);
          } else if (key === "1") {
            handleSelectColor("indigo");
          } else if (key === "2") {
            handleSelectColor("gold");
          } else if (key === "3") {
            handleSelectColor("crimson");
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
  }, [handleSelectColor]);

  useEffect(() => {
    sizeRef.current = { width: size.width, height: size.height };
  }, [size.width, size.height]);

  const integrityPercent = Math.round((integrity / INTEGRITY_MAX) * 100);

  return (
    <GameShell
      title="Loom Weave"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="loom-weave-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="loom-weave-canvas" />
        <div className={styles.hud}>
          <span className={styles.progress} data-testid="loom-weave-progress">
            段 {rowsWoven} / {TARGET_ROWS}
          </span>
          <span
            className={styles.integrity}
            data-testid="loom-weave-integrity"
            data-integrity={integrity}
          >
            耐久 {integrityPercent}%
          </span>
          {combo >= 2 && (
            <span className={styles.combo} data-testid="loom-weave-combo">
              COMBO x{combo}
            </span>
          )}
        </div>
        <div className={styles.hint}>
          リングの色が指示された糸色。輪が閉じきる前に同じ色のボタンを押して機を織ろう。外すと生地が傷み、耐久が尽きると破れる。
        </div>
        <div className={styles.controls}>
          <div
            className={styles.activeColorLabel}
            data-testid="loom-weave-active-color"
            data-color={activeColor}
          >
            次の糸: {THREAD_LABEL[activeColor]}
          </div>
          <div className={styles.colorButtons}>
            {THREAD_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className={styles.colorButton}
                data-thread={color}
                onClick={() => handleSelectColor(color)}
                data-testid={`loom-weave-button-${color}`}
              >
                {THREAD_LABEL[color]}
              </button>
            ))}
          </div>
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="loom-weave-gameover">
            <div className={styles.gameOverTitle}>
              {outcome === "finished" ? "スカーフが完成した！" : "生地が破れた…"}
            </div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <div className={styles.gameOverSub}>
              段数 {rowsWoven} / {TARGET_ROWS}
            </div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="loom-weave-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
