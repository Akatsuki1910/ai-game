"use client";

import { Application, Graphics } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import { EARTH_BEADS_PER_ROD, SorobanWorld, START_LIVES } from "./engine/sorobanWorld";
import styles from "./SorobanRushGame.module.scss";

interface Layout {
  rodXs: number[];
  barY: number;
  heavenTop: number;
  earthBottom: number;
  beadRadius: number;
  rodHitHalfWidth: number;
}

type DragZone = "heaven" | "earth";

const FRAME_COLOR = 0x3a2a18;
const BAR_COLOR = 0x6b4a28;
const ROD_COLOR = 0x5a3f22;
const HEAVEN_BEAD_COLOR = 0xffb454;
const EARTH_BEAD_COLOR = 0x6ee7ff;
const SELECTED_GLOW_COLOR = 0xffe066;
const FLASH_CORRECT_COLOR = 0x7cf5c4;
const FLASH_WRONG_COLOR = 0xff6b6b;
const BEAD_FOLLOW_RATE = 14;
const FLASH_DECAY_RATE = 2.4;

function computeLayout(width: number, height: number, digitCount: number): Layout {
  const frameMarginX = width * 0.1;
  const frameTop = height * 0.14;
  const frameBottom = height * 0.88;
  const usableWidth = Math.max(width - frameMarginX * 2, 1);
  const rodXs =
    digitCount <= 1
      ? [width / 2]
      : Array.from(
          { length: digitCount },
          (_, i) => frameMarginX + (usableWidth * i) / (digitCount - 1),
        );
  const heavenZoneHeight = (frameBottom - frameTop) * 0.22;
  const barY = frameTop + heavenZoneHeight;
  const rodSpacing = digitCount > 1 ? usableWidth / (digitCount - 1) : usableWidth * 0.5;
  const earthZoneHeight = frameBottom - barY;
  const beadRadius = Math.max(
    6,
    Math.min(rodSpacing * 0.26, (earthZoneHeight / (EARTH_BEADS_PER_ROD + 1)) * 0.42, 26),
  );
  return {
    rodXs,
    barY,
    heavenTop: frameTop,
    earthBottom: frameBottom,
    beadRadius,
    rodHitHalfWidth: Math.max(rodSpacing * 0.6, beadRadius * 1.6),
  };
}

function findRodAt(x: number, layout: Layout): number | null {
  let bestIndex: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  layout.rodXs.forEach((rodX, index) => {
    const distance = Math.abs(x - rodX);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  if (bestIndex === null || bestDistance > layout.rodHitHalfWidth) return null;
  return bestIndex;
}

function earthRatioFromY(y: number, layout: Layout): number {
  const span = layout.earthBottom - layout.barY;
  if (span <= 0) return 0;
  return (layout.earthBottom - y) / span;
}

function heavenBeadTargetY(layout: Layout, isHeavenDown: boolean): number {
  return isHeavenDown
    ? layout.barY - layout.beadRadius * 1.3
    : layout.heavenTop + layout.beadRadius * 1.2;
}

function earthBeadTargetY(layout: Layout, beadIndex: number, earthUpCount: number): number {
  const step = layout.beadRadius * 2.05;
  if (beadIndex < earthUpCount) {
    return layout.barY + layout.beadRadius * 1.15 + beadIndex * step;
  }
  const rankFromBottom = EARTH_BEADS_PER_ROD - 1 - beadIndex;
  return layout.earthBottom - layout.beadRadius * 1.15 - rankFromBottom * step;
}

function formatDigits(value: number, digitCount: number): string {
  return value.toString().padStart(digitCount, "0");
}

export function SorobanRushGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  // そろばんの初期状態(特に目標の数)はランダムなので、SSRと初回クライアントレンダリングで
  // 値がずれてハイドレーションエラーになる。world の生成・反映はクライアントのみで動く
  // useEffect の中で行い、それまでは空表示にしておく。
  const worldRef = useRef<SorobanWorld | null>(null);

  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(START_LIVES);
  const [targetLabel, setTargetLabel] = useState("");
  const [currentLabel, setCurrentLabel] = useState("");
  const [timeRatio, setTimeRatio] = useState(1);
  const [feedback, setFeedback] = useState<"correct" | "wrong" | "timeout" | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const appRef = useRef<Application | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const canvasSizeRef = useRef({ width: 0, height: 0 });

  const handleTogglePause = useCallback(() => {
    if (!loopRef.current) return;
    setIsPaused(loopRef.current.togglePause());
  }, []);

  const handleSubmit = useCallback(() => {
    worldRef.current?.submit();
  }, []);

  const handleRestart = useCallback(() => {
    worldRef.current?.reset();
    setIsOver(false);
    setScore(0);
    setLives(START_LIVES);
    setFeedback(null);
    if (loopRef.current?.isPaused) {
      loopRef.current.resume();
      setIsPaused(false);
    }
  }, []);

  useEffect(() => {
    canvasSizeRef.current = { width: size.width, height: size.height };
  }, [size.width, size.height]);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    let disposed = false;

    const app = new Application();
    const world = new SorobanWorld();
    worldRef.current = world;

    const frameGraphics = new Graphics();
    const glowGraphics = new Graphics();
    const beadGraphics = new Graphics();
    const flashGraphics = new Graphics();

    const earthVisualY = new Map<number, number[]>();
    const heavenVisualY = new Map<number, number>();
    let previousFeedback: "correct" | "wrong" | "timeout" | null = null;
    let flashAlpha = 0;
    let flashColor = FLASH_CORRECT_COLOR;

    const draggingByPointer = new Map<number, { rodIndex: number; zone: DragZone }>();

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x120d08,
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
      app.stage.addChild(frameGraphics, glowGraphics, beadGraphics, flashGraphics);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds, elapsedSeconds) => {
        world.step(deltaSeconds);

        setScore(world.score);
        setLives(world.lives);
        setTargetLabel(formatDigits(world.targetNumber, world.digitCount));
        setCurrentLabel(formatDigits(world.currentNumber, world.digitCount));
        setTimeRatio(world.roundTimeLimit > 0 ? world.timeRemaining / world.roundTimeLimit : 0);
        if (world.isOver) setIsOver(true);

        if (world.feedback !== previousFeedback && world.feedback) {
          flashAlpha = 0.55;
          flashColor = world.feedback === "correct" ? FLASH_CORRECT_COLOR : FLASH_WRONG_COLOR;
        }
        previousFeedback = world.feedback;
        setFeedback(world.feedback);
        flashAlpha = Math.max(0, flashAlpha - deltaSeconds * FLASH_DECAY_RATE);

        const { width, height } = canvasSizeRef.current;
        if (width <= 0 || height <= 0) return;
        const layout = computeLayout(width, height, world.digitCount);

        frameGraphics
          .clear()
          .roundRect(
            layout.rodXs[0] - layout.beadRadius * 2,
            layout.heavenTop - layout.beadRadius * 1.5,
            layout.rodXs[layout.rodXs.length - 1] - layout.rodXs[0] + layout.beadRadius * 4,
            layout.earthBottom - layout.heavenTop + layout.beadRadius * 3,
            12,
          )
          .fill({ color: FRAME_COLOR, alpha: 0.85 })
          .stroke({ width: 3, color: BAR_COLOR, alpha: 0.9 });

        for (const rodX of layout.rodXs) {
          frameGraphics
            .moveTo(rodX, layout.heavenTop)
            .lineTo(rodX, layout.earthBottom)
            .stroke({ width: 3, color: ROD_COLOR, alpha: 0.9 });
        }
        frameGraphics
          .moveTo(layout.rodXs[0] - layout.beadRadius * 1.6, layout.barY)
          .lineTo(layout.rodXs[layout.rodXs.length - 1] + layout.beadRadius * 1.6, layout.barY)
          .stroke({ width: 4, color: BAR_COLOR, alpha: 1 });

        glowGraphics.clear();
        const pulse = 0.35 + 0.25 * Math.sin(elapsedSeconds * 3.2);
        const selectedX = layout.rodXs[world.selectedRodIndex];
        if (selectedX !== undefined) {
          glowGraphics
            .roundRect(
              selectedX - layout.beadRadius * 1.6,
              layout.heavenTop - layout.beadRadius,
              layout.beadRadius * 3.2,
              layout.earthBottom - layout.heavenTop + layout.beadRadius * 2,
              10,
            )
            .fill({ color: SELECTED_GLOW_COLOR, alpha: pulse * 0.25 });
        }

        beadGraphics.clear();
        world.rods.forEach((rod, rodIndex) => {
          const rodX = layout.rodXs[rodIndex];
          if (rodX === undefined) return;

          const heavenTarget = heavenBeadTargetY(layout, rod.isHeavenDown);
          const previousHeavenY = heavenVisualY.get(rodIndex) ?? heavenTarget;
          const heavenFollow = 1 - Math.exp(-deltaSeconds * BEAD_FOLLOW_RATE);
          const heavenY = previousHeavenY + (heavenTarget - previousHeavenY) * heavenFollow;
          heavenVisualY.set(rodIndex, heavenY);
          beadGraphics
            .poly([
              rodX,
              heavenY - layout.beadRadius,
              rodX + layout.beadRadius,
              heavenY,
              rodX,
              heavenY + layout.beadRadius,
              rodX - layout.beadRadius,
              heavenY,
            ])
            .fill({ color: HEAVEN_BEAD_COLOR, alpha: 0.95 })
            .stroke({ width: 1.5, color: 0xffffff, alpha: 0.4 });

          const previousEarthYs =
            earthVisualY.get(rodIndex) ??
            Array.from({ length: EARTH_BEADS_PER_ROD }, (_, b) => earthBeadTargetY(layout, b, 0));
          const nextEarthYs = previousEarthYs.map((previousY, beadIndex) => {
            const target = earthBeadTargetY(layout, beadIndex, rod.earthUpCount);
            const follow = 1 - Math.exp(-deltaSeconds * BEAD_FOLLOW_RATE);
            return previousY + (target - previousY) * follow;
          });
          earthVisualY.set(rodIndex, nextEarthYs);
          nextEarthYs.forEach((beadY) => {
            beadGraphics
              .circle(rodX, beadY, layout.beadRadius)
              .fill({ color: EARTH_BEAD_COLOR, alpha: 0.95 })
              .stroke({ width: 1.5, color: 0xffffff, alpha: 0.35 });
          });
        });

        flashGraphics.clear();
        if (flashAlpha > 0) {
          flashGraphics
            .rect(0, 0, width, height)
            .fill({ color: flashColor, alpha: flashAlpha * 0.3 });
        }
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => {
          const { width, height } = canvasSizeRef.current;
          if (width <= 0 || height <= 0) return;
          const layout = computeLayout(width, height, world.digitCount);
          const rodIndex = findRodAt(pointer.x, layout);
          if (rodIndex === null) return;

          world.selectedRodIndex = rodIndex;
          if (pointer.y < layout.barY) {
            world.toggleRodHeaven(rodIndex);
            draggingByPointer.set(pointer.id, { rodIndex, zone: "heaven" });
          } else {
            world.setRodEarthFromRatio(rodIndex, earthRatioFromY(pointer.y, layout));
            draggingByPointer.set(pointer.id, { rodIndex, zone: "earth" });
          }
        },
        onPointerMove: (pointer) => {
          const dragging = draggingByPointer.get(pointer.id);
          if (dragging?.zone !== "earth") return;
          const { width, height } = canvasSizeRef.current;
          if (width <= 0 || height <= 0) return;
          const layout = computeLayout(width, height, world.digitCount);
          world.setRodEarthFromRatio(dragging.rodIndex, earthRatioFromY(pointer.y, layout));
        },
        onPointerUp: (pointer) => {
          draggingByPointer.delete(pointer.id);
        },
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
            return;
          }
          if (key === "r") {
            world.reset();
            setIsOver(false);
            setScore(0);
            setLives(START_LIVES);
            setFeedback(null);
            return;
          }
          if (key === "arrowleft" || key === "a") {
            world.selectRod(-1);
          } else if (key === "arrowright" || key === "d") {
            world.selectRod(1);
          } else if (key === "arrowup" || key === "w") {
            world.adjustRodDigit(world.selectedRodIndex, 1);
          } else if (key === "arrowdown" || key === "s") {
            world.adjustRodDigit(world.selectedRodIndex, -1);
          } else if (key === "enter") {
            world.submit();
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

  const timerPercent = Math.max(0, Math.min(1, timeRatio)) * 100;

  return (
    <GameShell
      title="Soroban Rush"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="soroban-rush-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="soroban-rush-canvas" />
        <div className={styles.hud}>
          <div className={styles.hudLeft}>
            <div className={`${styles.statRow} ${styles.target}`} data-testid="soroban-rush-target">
              目標 {targetLabel}
            </div>
            <div className={styles.statRow} data-testid="soroban-rush-current">
              現在 {currentLabel}
            </div>
          </div>
          <div className={`${styles.statRow} ${styles.lives}`} data-testid="soroban-rush-lives">
            {"♥".repeat(lives)}
            {"♡".repeat(Math.max(0, START_LIVES - lives))}
          </div>
        </div>
        {feedback && (
          <div
            className={`${styles.feedback} ${
              feedback === "correct" ? styles.feedbackCorrect : styles.feedbackWrong
            }`}
            data-testid="soroban-rush-feedback"
          >
            {feedback === "correct"
              ? "○ せいかい!"
              : feedback === "timeout"
                ? "× タイムアップ"
                : "× ちがう"}
          </div>
        )}
        <div className={styles.bottomBar}>
          <div className={styles.timerTrack} data-testid="soroban-rush-timer">
            <div
              className={`${styles.timerFill} ${timerPercent < 30 ? styles.timerFillUrgent : ""}`}
              style={{ width: `${timerPercent}%` }}
            />
          </div>
          <button
            type="button"
            className={styles.submitButton}
            onClick={handleSubmit}
            data-testid="soroban-rush-submit"
          >
            決定
          </button>
          <div className={styles.hint}>
            棒の上側(梁より上)をタップで5珠を切替、下側をドラッグで1珠の数を調整。目標の数に合わせて「決定」。
            矢印キー/AD: 桁選択 / ↑↓・WS: 桁の値を変更 / Enter: 決定 / Space: 一時停止 / R: リセット
          </div>
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="soroban-rush-gameover">
            <div className={styles.gameOverTitle}>そろばん破損…</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="soroban-rush-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
