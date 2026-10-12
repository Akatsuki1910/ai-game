"use client";

import { Application, Graphics } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import {
  MAX_SAFE_STRETCH,
  NoodlePullWorld,
  type RoundEndReason,
  SNAP_STRETCH,
} from "./engine/world";
import styles from "./NoodlePullGame.module.scss";

const LEFT_HAND_X_RATIO = 0.16;
const HAND_Y_RATIO = 0.42;
/** stretch=1(MAX_SAFE_STRETCH) に対応する、左手から右手までの基準距離(幅に対する比率)。 */
const STRETCH_REFERENCE_RATIO = 0.62;
const HAND_RADIUS = 20;
/** 離すと同時に強く引く(キーボードは距離が無いので最大まで引く意思表示として大きな値を渡す)。 */
const PULL_TARGET_STRETCH = SNAP_STRETCH + 1;
const MAX_VISIBLE_STRANDS = 48;

const NOODLE_COLOR_SAFE = 0xffe9b3;
const NOODLE_COLOR_DANGER = 0xff6b6b;
const ZONE_COLOR = 0x7cf5c4;
const SNAP_ZONE_COLOR = 0xff6b6b;
const HAND_COLOR = 0xf2c879;
const TRACK_COLOR = 0x2b2f3a;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

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

function noodleColorFor(stretch: number): number {
  const dangerT = clamp((stretch - MAX_SAFE_STRETCH) / (SNAP_STRETCH - MAX_SAFE_STRETCH), 0, 1);
  return lerpColor(NOODLE_COLOR_SAFE, NOODLE_COLOR_DANGER, dangerT);
}

function resultTitle(reason: RoundEndReason): string {
  if (reason === "folded") return "きれいに畳めた!";
  if (reason === "weak") return "まだ緩い…";
  if (reason === "snapped") return "伸ばしすぎて切れた!";
  return "時間切れ…";
}

export function NoodlePullGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [round, setRound] = useState(1);
  const [freshnessPercent, setFreshnessPercent] = useState(100);
  const [strandCount, setStrandCount] = useState(1);
  const [isRoundOver, setIsRoundOver] = useState(false);
  const [resultInfo, setResultInfo] = useState<{
    reason: RoundEndReason;
    roundScore: number;
  } | null>(null);
  const [isPaused, setIsPaused] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<NoodlePullWorld | null>(null);
  const appRef = useRef<Application | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  const isPullingRef = useRef(false);

  const handleTogglePause = useCallback(() => {
    if (!loopRef.current) return;
    setIsPaused(loopRef.current.togglePause());
  }, []);

  const handlePullStart = useCallback(() => {
    if (loopRef.current?.isPaused) return;
    isPullingRef.current = true;
  }, []);

  const handlePullRelease = useCallback(() => {
    if (loopRef.current?.isPaused) return;
    isPullingRef.current = false;
    worldRef.current?.attemptFold();
  }, []);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    let disposed = false;

    const app = new Application();
    const world = new NoodlePullWorld();
    worldRef.current = world;

    const trackGraphics = new Graphics();
    const handGraphics = new Graphics();
    const noodleGraphics = new Graphics();

    let draggingPointerId: number | null = null;

    world.onRoundResolved = (event) => {
      setResultInfo({ reason: event.reason, roundScore: event.roundScore });
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x1c130c,
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
      app.stage.addChild(trackGraphics, noodleGraphics, handGraphics);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds, elapsedSeconds) => {
        world.setStretchTarget(isPullingRef.current ? PULL_TARGET_STRETCH : 0, deltaSeconds);
        world.step(deltaSeconds);

        setScore(world.score);
        setRound(world.round);
        setFreshnessPercent(Math.round(world.freshnessRatio * 100));
        setStrandCount(world.strandCount);
        setIsRoundOver(world.isRoundOver);

        const { width, height } = sizeRef.current;
        if (width <= 0 || height <= 0) return;

        const leftX = width * LEFT_HAND_X_RATIO;
        const handY = height * HAND_Y_RATIO;
        const referenceLength = width * STRETCH_REFERENCE_RATIO;
        const rightX = leftX + world.stretch * referenceLength;

        trackGraphics.clear();
        const trackY = height * 0.72;
        const trackHeight = 16;
        trackGraphics
          .roundRect(leftX, trackY, referenceLength * SNAP_STRETCH, trackHeight, 8)
          .fill({ color: TRACK_COLOR, alpha: 0.85 });
        trackGraphics
          .rect(
            leftX + world.zone.min * referenceLength,
            trackY,
            (world.zone.max - world.zone.min) * referenceLength,
            trackHeight,
          )
          .fill({ color: ZONE_COLOR, alpha: 0.55 });
        trackGraphics
          .rect(
            leftX + referenceLength * MAX_SAFE_STRETCH,
            trackY,
            referenceLength * (SNAP_STRETCH - MAX_SAFE_STRETCH),
            trackHeight,
          )
          .fill({ color: SNAP_ZONE_COLOR, alpha: 0.3 });
        const markerX = clamp(
          leftX + world.stretch * referenceLength,
          leftX,
          leftX + referenceLength * SNAP_STRETCH,
        );
        trackGraphics
          .circle(markerX, trackY + trackHeight / 2, 6)
          .fill({ color: 0xffffff, alpha: 0.9 });

        noodleGraphics.clear();
        const visibleStrands = Math.min(world.strandCount, MAX_VISIBLE_STRANDS);
        const color = noodleColorFor(world.stretch);
        for (let i = 0; i < visibleStrands; i++) {
          const spread = visibleStrands > 1 ? (i / (visibleStrands - 1) - 0.5) * 18 : 0;
          const wobble = Math.sin(elapsedSeconds * 3 + i) * 2;
          const y = handY + spread;
          noodleGraphics
            .moveTo(leftX, y)
            .quadraticCurveTo(
              (leftX + rightX) / 2,
              y + wobble + (world.stretch > MAX_SAFE_STRETCH ? 0 : 6),
              rightX,
              y,
            )
            .stroke({ width: 2.4, color, alpha: 0.85 });
        }

        handGraphics.clear();
        handGraphics
          .circle(leftX, handY, HAND_RADIUS)
          .fill({ color: HAND_COLOR, alpha: 0.95 })
          .circle(rightX, handY, HAND_RADIUS)
          .fill({ color: HAND_COLOR, alpha: 0.95 });
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => {
          if (draggingPointerId !== null) return;
          draggingPointerId = pointer.id;
          handlePullStart();
        },
        onPointerUp: (pointer) => {
          if (pointer.id !== draggingPointerId) return;
          draggingPointerId = null;
          handlePullRelease();
        },
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
          } else if (key === "r") {
            world.reset();
            setResultInfo(null);
          } else if (key === "enter") {
            handlePullStart();
          }
        },
        onKeyUp: (key) => {
          if (key === "enter") {
            handlePullRelease();
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
  }, [handlePullStart, handlePullRelease]);

  useEffect(() => {
    sizeRef.current = { width: size.width, height: size.height };
  }, [size.width, size.height]);

  return (
    <GameShell
      title="Noodle Pull"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="noodle-pull-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="noodle-pull-canvas" />
        <div className={styles.hud}>
          <span className={styles.round} data-testid="noodle-pull-round">
            ROUND {round}
          </span>
          <span className={styles.strands} data-testid="noodle-pull-strands">
            麺 {strandCount.toLocaleString("ja-JP")}本
          </span>
          <span className={styles.freshnessLabel} data-testid="noodle-pull-freshness">
            鮮度 {freshnessPercent}%
          </span>
          <div className={styles.freshnessTrack}>
            <div className={styles.freshnessFill} style={{ width: `${freshnessPercent}%` }} />
          </div>
        </div>
        <div className={styles.hint}>
          長押しで麺を引き伸ばし、緑のゾーンに入ったら離して畳む(キーボードはEnter長押し)。
          伸ばしすぎる(赤いゾーン)と離さなくても千切れる。畳むたびに麺は倍の本数に。 Space: 一時停止
          / R: セッション全体をリセット。
        </div>
        {isRoundOver && resultInfo && (
          <div className={styles.result} data-testid="noodle-pull-result">
            <div className={styles.resultTitle}>{resultTitle(resultInfo.reason)}</div>
            <div className={styles.resultScore}>+{resultInfo.roundScore}</div>
          </div>
        )}
      </div>
    </GameShell>
  );
}
