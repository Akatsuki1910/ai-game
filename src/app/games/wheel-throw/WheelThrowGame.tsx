"use client";

import { Application, Graphics } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import { BAND_COUNT, MIN_RADIUS, type RoundEndReason, WheelThrowWorld } from "./engine/world";
import styles from "./WheelThrowGame.module.scss";

const POT_TOP_RATIO = 0.24;
const POT_BOTTOM_RATIO = 0.86;
const MAX_RADIUS_PX_RATIO = 0.34;
/** キーボードでカーソル(高さ)を動かす速さ(バンド/秒)。 */
const CURSOR_KEY_SPEED = 9;
const WHEEL_SPIN_SPEED = 1.6; // ラジアン/秒
const WHEEL_SPOKE_COUNT = 10;
const HIGHLIGHT_SPEED = 2.1;
/** この半径を下回り始めると危険色(赤)へ寄っていく。MIN_RADIUSちょうどで完全に赤。 */
const DANGER_ZONE_WIDTH = 0.17;

const CLAY_COLOR = 0xc9793f;
const CLAY_DANGER_COLOR = 0xff5a4a;
const CLAY_STROKE_COLOR = 0x5c3a1e;
const TARGET_COLOR = 0x6ee7ff;
const WHEEL_COLOR = 0x2b2f3a;
const WHEEL_STROKE_COLOR = 0x14161d;
const CURSOR_COLOR = 0xffe066;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** 2つの0xRRGGBBカラーをtで線形補間する。 */
function lerpColor(colorA: number, colorB: number, t: number): number {
  const ratio = clamp(t, 0, 1);
  const rA = (colorA >> 16) & 0xff;
  const gA = (colorA >> 8) & 0xff;
  const bA = colorA & 0xff;
  const rB = (colorB >> 16) & 0xff;
  const gB = (colorB >> 8) & 0xff;
  const bB = colorB & 0xff;
  const r = Math.round(rA + (rB - rA) * ratio);
  const g = Math.round(gA + (gB - gA) * ratio);
  const b = Math.round(bA + (bB - bA) * ratio);
  return (r << 16) | (g << 8) | b;
}

function clayColorFor(radius: number): number {
  const dangerT = 1 - clamp((radius - MIN_RADIUS) / DANGER_ZONE_WIDTH, 0, 1);
  return lerpColor(CLAY_COLOR, CLAY_DANGER_COLOR, dangerT);
}

function bandY(index: number, potTopY: number, potBottomY: number): number {
  const t = index / (BAND_COUNT - 1);
  return potBottomY - t * (potBottomY - potTopY);
}

function resultTitle(reason: RoundEndReason): string {
  if (reason === "collapsed") return "崩れてしまった…";
  if (reason === "dried") return "乾ききった!";
  return "仕上がった!";
}

export function WheelThrowGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [round, setRound] = useState(1);
  const [moisturePercent, setMoisturePercent] = useState(100);
  const [isRoundOver, setIsRoundOver] = useState(false);
  const [resultInfo, setResultInfo] = useState<{
    reason: RoundEndReason;
    roundScore: number;
  } | null>(null);
  const [isPaused, setIsPaused] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<WheelThrowWorld | null>(null);
  const appRef = useRef<Application | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const sizeRef = useRef({ width: 0, height: 0 });

  const handleTogglePause = useCallback(() => {
    if (!loopRef.current) return;
    setIsPaused(loopRef.current.togglePause());
  }, []);

  const handleFinish = useCallback(() => {
    if (!worldRef.current || loopRef.current?.isPaused) return;
    worldRef.current.finishNow();
  }, []);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    let disposed = false;

    const app = new Application();
    const world = new WheelThrowWorld();
    worldRef.current = world;

    const wheelGraphics = new Graphics();
    const targetGraphics = new Graphics();
    const potGraphics = new Graphics();
    const cursorGraphics = new Graphics();

    let draggingPointerId: number | null = null;
    let isPointerDown = false;
    let pointerX = 0;
    let pointerY = 0;

    world.onRoundResolved = (event) => {
      setResultInfo({ reason: event.reason, roundScore: event.roundScore });
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x1a1410,
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
      app.stage.addChild(wheelGraphics, targetGraphics, potGraphics, cursorGraphics);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds, elapsedSeconds) => {
        const { width, height } = sizeRef.current;
        const hasSize = width > 0 && height > 0;
        const potTopY = height * POT_TOP_RATIO;
        const potBottomY = height * POT_BOTTOM_RATIO;
        const cx = width / 2;
        const maxRadiusPx = Math.min(width, height) * MAX_RADIUS_PX_RATIO;

        if (isPointerDown && hasSize) {
          const t = clamp((potBottomY - pointerY) / (potBottomY - potTopY), 0, 1);
          const bandIndex = t * (BAND_COUNT - 1);
          const radiusRatio = clamp(Math.abs(pointerX - cx) / maxRadiusPx, 0, 1);
          world.applyPressure(bandIndex, radiusRatio, deltaSeconds);
        } else {
          let verticalDirection = 0;
          if (input.isKeyDown("arrowup") || input.isKeyDown("w")) verticalDirection += 1;
          if (input.isKeyDown("arrowdown") || input.isKeyDown("s")) verticalDirection -= 1;
          if (verticalDirection !== 0) {
            world.moveCursorBy(verticalDirection * CURSOR_KEY_SPEED * deltaSeconds);
          }

          let horizontalDirection: -1 | 1 | null = null;
          if (input.isKeyDown("arrowleft") || input.isKeyDown("a")) horizontalDirection = -1;
          if (input.isKeyDown("arrowright") || input.isKeyDown("d")) horizontalDirection = 1;
          if (horizontalDirection !== null) {
            world.adjustRadiusAtCursor(horizontalDirection, deltaSeconds);
          }
        }

        world.step(deltaSeconds);

        setScore(world.score);
        setRound(world.round);
        setMoisturePercent(Math.round(world.moistureRatio * 100));
        setIsRoundOver(world.isRoundOver);

        if (!hasSize) return;

        wheelGraphics.clear();
        const wheelY = potBottomY + Math.min(24, height * 0.03);
        const wheelRadiusPx = maxRadiusPx * 1.18;
        wheelGraphics
          .ellipse(cx, wheelY, wheelRadiusPx, wheelRadiusPx * 0.3)
          .fill({ color: WHEEL_COLOR, alpha: 0.95 })
          .stroke({ width: 2, color: WHEEL_STROKE_COLOR, alpha: 0.8 });
        for (let i = 0; i < WHEEL_SPOKE_COUNT; i++) {
          const angle = elapsedSeconds * WHEEL_SPIN_SPEED + (i * Math.PI * 2) / WHEEL_SPOKE_COUNT;
          const ex = cx + Math.cos(angle) * wheelRadiusPx * 0.82;
          const ey = wheelY + Math.sin(angle) * wheelRadiusPx * 0.3 * 0.82;
          wheelGraphics.circle(ex, ey, 3).fill({ color: 0xffffff, alpha: 0.35 });
        }

        targetGraphics.clear();
        targetGraphics.moveTo(cx - world.target[0] * maxRadiusPx, bandY(0, potTopY, potBottomY));
        for (let i = 1; i < BAND_COUNT; i++) {
          targetGraphics.lineTo(cx - world.target[i] * maxRadiusPx, bandY(i, potTopY, potBottomY));
        }
        targetGraphics.stroke({ width: 1.5, color: TARGET_COLOR, alpha: 0.55 });
        targetGraphics.moveTo(cx + world.target[0] * maxRadiusPx, bandY(0, potTopY, potBottomY));
        for (let i = 1; i < BAND_COUNT; i++) {
          targetGraphics.lineTo(cx + world.target[i] * maxRadiusPx, bandY(i, potTopY, potBottomY));
        }
        targetGraphics.stroke({ width: 1.5, color: TARGET_COLOR, alpha: 0.55 });

        potGraphics.clear();
        for (let i = 0; i < BAND_COUNT - 1; i++) {
          const rA = world.radii[i];
          const rB = world.radii[i + 1];
          const yA = bandY(i, potTopY, potBottomY);
          const yB = bandY(i + 1, potTopY, potBottomY);
          const color = clayColorFor(Math.min(rA, rB));
          potGraphics
            .moveTo(cx - rA * maxRadiusPx, yA)
            .lineTo(cx - rB * maxRadiusPx, yB)
            .lineTo(cx + rB * maxRadiusPx, yB)
            .lineTo(cx + rA * maxRadiusPx, yA)
            .closePath()
            .fill({ color, alpha: 0.96 });
        }
        potGraphics.moveTo(cx - world.radii[0] * maxRadiusPx, bandY(0, potTopY, potBottomY));
        for (let i = 1; i < BAND_COUNT; i++) {
          potGraphics.lineTo(cx - world.radii[i] * maxRadiusPx, bandY(i, potTopY, potBottomY));
        }
        potGraphics.stroke({ width: 2, color: CLAY_STROKE_COLOR, alpha: 0.9 });
        potGraphics.moveTo(cx + world.radii[0] * maxRadiusPx, bandY(0, potTopY, potBottomY));
        for (let i = 1; i < BAND_COUNT; i++) {
          potGraphics.lineTo(cx + world.radii[i] * maxRadiusPx, bandY(i, potTopY, potBottomY));
        }
        potGraphics.stroke({ width: 2, color: CLAY_STROKE_COLOR, alpha: 0.9 });

        const topRadiusPx = world.radii[BAND_COUNT - 1] * maxRadiusPx;
        potGraphics
          .ellipse(cx, potTopY, topRadiusPx, Math.max(3, topRadiusPx * 0.26))
          .fill({ color: 0x2a1608, alpha: 0.92 })
          .stroke({ width: 2, color: CLAY_STROKE_COLOR, alpha: 0.9 });

        const highlightX = cx + Math.sin(elapsedSeconds * HIGHLIGHT_SPEED) * maxRadiusPx * 0.55;
        potGraphics
          .rect(highlightX - 3, potTopY, 6, potBottomY - potTopY)
          .fill({ color: 0xffffff, alpha: 0.06 });

        cursorGraphics.clear();
        const cursorY = bandY(world.cursorBandIndex, potTopY, potBottomY);
        const cursorRadiusPx = world.radii[world.cursorBandIndex] * maxRadiusPx;
        const pulse = 0.6 + Math.sin(elapsedSeconds * 6) * 0.4;
        cursorGraphics
          .moveTo(cx - cursorRadiusPx - 14, cursorY)
          .lineTo(cx - cursorRadiusPx - 4, cursorY)
          .moveTo(cx + cursorRadiusPx + 4, cursorY)
          .lineTo(cx + cursorRadiusPx + 14, cursorY)
          .stroke({ width: 3, color: CURSOR_COLOR, alpha: 0.5 + pulse * 0.5 });
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
            setResultInfo(null);
          } else if (key === "enter") {
            handleFinish();
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
  }, [handleFinish]);

  useEffect(() => {
    sizeRef.current = { width: size.width, height: size.height };
  }, [size.width, size.height]);

  return (
    <GameShell
      title="Wheel Throw"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="wheel-throw-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="wheel-throw-canvas" />
        <div className={styles.hud}>
          <span className={styles.round} data-testid="wheel-throw-round">
            ROUND {round}
          </span>
          <span className={styles.moistureLabel} data-testid="wheel-throw-moisture">
            水分 {moisturePercent}%
          </span>
          <div className={styles.moistureTrack}>
            <div className={styles.moistureFill} style={{ width: `${moisturePercent}%` }} />
          </div>
        </div>
        {!isRoundOver && (
          <button
            type="button"
            className={styles.finishButton}
            onClick={handleFinish}
            data-testid="wheel-throw-finish-button"
          >
            仕上げる
          </button>
        )}
        <div className={styles.hint}>
          ドラッグ/タッチで壁を狙った太さへ押し出す(中心に近いほど細くなる、水色の点線がお手本)。矢印キー・WASDでも高さ選択+押し引きができる。中心まで薄くしすぎると崩れて0点。
          水分が尽きるか「仕上げる」で採点し、少し間を置いて次のろくろへ。 Space: 一時停止 / R:
          セッション全体をリセット。
        </div>
        {isRoundOver && resultInfo && (
          <div className={styles.result} data-testid="wheel-throw-result">
            <div className={styles.resultTitle}>{resultTitle(resultInfo.reason)}</div>
            <div className={styles.resultScore}>+{resultInfo.roundScore}</div>
          </div>
        )}
      </div>
    </GameShell>
  );
}
