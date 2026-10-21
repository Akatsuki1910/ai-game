"use client";

import { Application, Graphics } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import styles from "./CruxHoldGame.module.scss";
import { CruxHoldWorld, type Hand, START_GRIP } from "./engine/world";

const LEFT_HAND_COLOR = 0x6ee7ff;
const RIGHT_HAND_COLOR = 0xffb454;
const ANCHOR_COLOR = 0x9aa0ac;
const IN_WINDOW_COLOR = 0x7cf5c4;
const GAUGE_TRACK_COLOR = 0x2b2f3a;
const LEDGE_COLOR = 0x343946;
const BODY_COLOR = 0x1b1e27;

const HAND_COLOR: Record<Hand, number> = { left: LEFT_HAND_COLOR, right: RIGHT_HAND_COLOR };

const GAUGE_WIDTH_RATIO = 0.62;
const GAUGE_Y_RATIO = 0.16;
const GAUGE_HEIGHT = 18;
const CLIMBER_Y_RATIO = 0.58;
const HAND_OFFSET_RATIO = 0.1;
const LEDGE_SPACING = 70;
/** 高さが1m進むごとに崖の帯がどれだけスクロールして見えるか(ピクセル)。 */
const LEDGE_SCROLL_PER_METER = 10;
/** 表示上の高さは、実際の heightClimbed へ毎フレーム少しずつ近づける(急なジャンプを避ける)。 */
const VISUAL_HEIGHT_EASING = 5;

export function CruxHoldGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [heightClimbed, setHeightClimbed] = useState(0);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [leftGrip, setLeftGrip] = useState(START_GRIP);
  const [rightGrip, setRightGrip] = useState(START_GRIP);
  const [requiredHand, setRequiredHand] = useState<Hand>("right");
  const [isReachInWindow, setIsReachInWindow] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<CruxHoldWorld | null>(null);
  const appRef = useRef<Application | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  const visualHeightRef = useRef(0);

  const handleTogglePause = useCallback(() => {
    if (!loopRef.current) return;
    setIsPaused(loopRef.current.togglePause());
  }, []);

  const handleRestart = useCallback(() => {
    worldRef.current?.reset();
    visualHeightRef.current = 0;
    setIsOver(false);
    if (loopRef.current?.isPaused) {
      loopRef.current.resume();
      setIsPaused(false);
    }
  }, []);

  const handleTapHand = useCallback((hand: Hand) => {
    if (!worldRef.current || loopRef.current?.isPaused) return;
    worldRef.current.tapHand(hand);
  }, []);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    let disposed = false;

    const app = new Application();
    const world = new CruxHoldWorld();
    worldRef.current = world;

    const ledgeGraphics = new Graphics();
    const gaugeGraphics = new Graphics();
    const climberGraphics = new Graphics();

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x11151c,
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
      app.stage.addChild(ledgeGraphics, climberGraphics, gaugeGraphics);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        world.step(deltaSeconds);

        setScore(world.score);
        setHeightClimbed(world.heightClimbed);
        setCombo(world.combo);
        setMaxCombo(world.maxCombo);
        setLeftGrip(world.leftGrip);
        setRightGrip(world.rightGrip);
        setRequiredHand(world.requiredHand);
        setIsReachInWindow(world.isReachInWindow);
        if (world.isOver) setIsOver(true);

        visualHeightRef.current +=
          (world.heightClimbed - visualHeightRef.current) *
          Math.min(1, deltaSeconds * VISUAL_HEIGHT_EASING);

        const { width, height } = sizeRef.current;
        if (width > 0 && height > 0) {
          const scrollOffset = (visualHeightRef.current * LEDGE_SCROLL_PER_METER) % LEDGE_SPACING;

          ledgeGraphics.clear();
          for (let y = -scrollOffset; y < height + LEDGE_SPACING; y += LEDGE_SPACING) {
            ledgeGraphics
              .moveTo(0, y)
              .lineTo(width, y)
              .stroke({ width: 2, color: LEDGE_COLOR, alpha: 0.5 });
          }

          const climberX = width / 2;
          const climberY = height * CLIMBER_Y_RATIO;
          const handOffset = Math.max(28, width * HAND_OFFSET_RATIO);
          const handRadius = Math.max(14, Math.min(width, height) * 0.035);

          climberGraphics.clear();
          climberGraphics.circle(climberX, climberY, handRadius * 1.3).fill({
            color: BODY_COLOR,
            alpha: 0.9,
          });

          const handsEntries: { hand: Hand; x: number }[] = [
            { hand: "left", x: climberX - handOffset },
            { hand: "right", x: climberX + handOffset },
          ];
          for (const { hand, x } of handsEntries) {
            const isRequired = hand === world.requiredHand;
            const color = isRequired
              ? world.isReachInWindow
                ? IN_WINDOW_COLOR
                : HAND_COLOR[hand]
              : ANCHOR_COLOR;
            climberGraphics
              .circle(x, climberY - handRadius * 0.6, handRadius)
              .fill({ color, alpha: isRequired ? 1 : 0.55 })
              .stroke({ width: 3, color: HAND_COLOR[hand], alpha: isRequired ? 1 : 0.35 });
          }

          const gaugeWidth = Math.min(420, width * GAUGE_WIDTH_RATIO);
          const gaugeX = climberX - gaugeWidth / 2;
          const gaugeY = height * GAUGE_Y_RATIO;
          const activeColor = HAND_COLOR[world.requiredHand];

          gaugeGraphics.clear();
          gaugeGraphics
            .roundRect(gaugeX, gaugeY, gaugeWidth, GAUGE_HEIGHT, 8)
            .fill({ color: GAUGE_TRACK_COLOR, alpha: 0.9 });

          const bandX = gaugeX + world.windowStart * gaugeWidth;
          const bandWidth = (world.windowEnd - world.windowStart) * gaugeWidth;
          gaugeGraphics
            .roundRect(bandX, gaugeY, bandWidth, GAUGE_HEIGHT, 6)
            .fill({ color: activeColor, alpha: world.isReachInWindow ? 0.55 : 0.3 });

          const markerX = gaugeX + Math.min(1, world.reach) * gaugeWidth;
          gaugeGraphics
            .circle(markerX, gaugeY + GAUGE_HEIGHT / 2, GAUGE_HEIGHT * 0.65)
            .fill({ color: world.isReachInWindow ? IN_WINDOW_COLOR : activeColor, alpha: 1 });
        }
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => {
          if (loop.isPaused) return;
          const { width } = sizeRef.current;
          if (width <= 0) return;
          handleTapHand(pointer.x < width / 2 ? "left" : "right");
        },
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
            return;
          }
          if (key === "r") {
            world.reset();
            visualHeightRef.current = 0;
            setIsOver(false);
            return;
          }
          if (loop.isPaused) return;
          if (key === "arrowleft" || key === "a") handleTapHand("left");
          else if (key === "arrowright" || key === "d") handleTapHand("right");
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
  }, [handleTapHand]);

  useEffect(() => {
    sizeRef.current = { width: size.width, height: size.height };
  }, [size.width, size.height]);

  return (
    <GameShell
      title="Crux Hold"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="crux-hold-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="crux-hold-canvas" />
        <div className={styles.hud}>
          <span className={styles.heightLabel} data-testid="crux-hold-height">
            高度 {heightClimbed.toFixed(1)}m
          </span>
          {combo >= 2 && (
            <span className={styles.combo} data-testid="crux-hold-combo">
              COMBO {combo}
            </span>
          )}
        </div>
        <div className={styles.gripRow}>
          <div className={styles.gripBar} data-testid="crux-hold-left-grip" data-grip={leftGrip}>
            <span className={styles.gripLabel}>L</span>
            <div className={styles.gripTrack}>
              <div
                className={styles.gripFill}
                style={{ width: `${leftGrip}%`, background: "#6ee7ff" }}
              />
            </div>
          </div>
          <div className={styles.gripBar} data-testid="crux-hold-right-grip" data-grip={rightGrip}>
            <span className={styles.gripLabel}>R</span>
            <div className={styles.gripTrack}>
              <div
                className={styles.gripFill}
                style={{ width: `${rightGrip}%`, background: "#ffb454" }}
              />
            </div>
          </div>
        </div>
        <div
          className={styles.grabHint}
          data-testid="crux-hold-grab-hint"
          data-required-hand={requiredHand}
          data-in-window={isReachInWindow ? "true" : "false"}
        >
          {isReachInWindow
            ? `掴め! ${requiredHand === "left" ? "LEFT" : "RIGHT"}`
            : `つぎ: ${requiredHand === "left" ? "LEFT" : "RIGHT"}`}
        </div>
        <div className={styles.hint}>
          ホールドが光る(緑)瞬間に、要求された側の手(LEFT/RIGHT)でタップ。左右を間違える・
          タイミングを外す・見逃すと支えている側の腕力が減り、両腕とも尽きると滑落する。
          登るほど判定は狭く速くなる。キーボードは←・A: LEFT / →・D: RIGHT。Space: 一時停止 / R:
          リセット。
        </div>
        <div className={styles.handRow}>
          <button
            type="button"
            className={styles.leftButton}
            data-testid="crux-hold-left-button"
            onPointerDown={() => handleTapHand("left")}
          >
            LEFT
          </button>
          <button
            type="button"
            className={styles.rightButton}
            data-testid="crux-hold-right-button"
            onPointerDown={() => handleTapHand("right")}
          >
            RIGHT
          </button>
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="crux-hold-gameover">
            <div className={styles.gameOverTitle}>滑落...</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <div className={styles.gameOverSub}>
              到達高度 {heightClimbed.toFixed(1)}m / 最大コンボ {maxCombo}
            </div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="crux-hold-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
