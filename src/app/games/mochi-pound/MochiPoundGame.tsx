"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import {
  MochiPoundWorld,
  START_LIVES,
  type StrikeAccuracy,
  type StrikeEvent,
} from "./engine/world";
import styles from "./MochiPoundGame.module.scss";

const MOCHI_COLOR = 0xfaf4e6;
const USU_COLOR = 0x3a2a1c;
const ARM_COLOR = 0xd8c39a;
const MALLET_COLOR = 0x8a5a33;
const HAND_COLOR = 0xe8a97a;
const TARGET_ZONE_COLOR = 0xffe066;
const PERFECT_ZONE_COLOR = 0x7cf5c4;

const ACCURACY_LABELS = {
  perfect: "PERFECT!",
  good: "GOOD",
  miss: "MISS",
  hand: "手を叩いた!",
} as const satisfies Record<StrikeAccuracy, string>;

const ACCURACY_COLORS = {
  perfect: 0xffe066,
  good: 0x7cf5c4,
  miss: 0xff6b6b,
  hand: 0xff6b6b,
} as const satisfies Record<StrikeAccuracy, number>;

interface FloatingPopup {
  text: Text;
  age: number;
}

const POPUP_LIFETIME = 1.0;

export function MochiPoundGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [round, setRound] = useState(1);
  const [lives, setLives] = useState(START_LIVES);
  const [combo, setCombo] = useState(0);
  const [stretchRatio, setStretchRatio] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<MochiPoundWorld | null>(null);
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

  const handleStrike = useCallback(() => {
    if (!worldRef.current || loopRef.current?.isPaused) return;
    worldRef.current.strike();
  }, []);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    let disposed = false;

    const app = new Application();
    const world = new MochiPoundWorld();
    worldRef.current = world;

    const zoneGraphics = new Graphics();
    const usuGraphics = new Graphics();
    const mochiGraphics = new Graphics();
    const handGraphics = new Graphics();
    const armGraphics = new Graphics();
    const popupHost = new Container();
    const floatingPopups: FloatingPopup[] = [];

    world.onStrike = ({ accuracy, points, combo: comboCount }: StrikeEvent) => {
      const { width, height } = sizeRef.current;
      const label =
        accuracy === "perfect" || accuracy === "good"
          ? comboCount > 1
            ? `${ACCURACY_LABELS[accuracy]} +${points} COMBO x${comboCount}`
            : `${ACCURACY_LABELS[accuracy]} +${points}`
          : ACCURACY_LABELS[accuracy];
      const text = new Text({
        text: label,
        style: { fill: ACCURACY_COLORS[accuracy], fontSize: 18, fontWeight: "700" },
      });
      text.anchor.set(0.5, 1);
      text.position.set(width / 2, height * 0.58);
      popupHost.addChild(text);
      floatingPopups.push({ text, age: 0 });
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x0b0806,
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
        zoneGraphics,
        usuGraphics,
        mochiGraphics,
        handGraphics,
        armGraphics,
        popupHost,
      );
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        world.step(deltaSeconds);

        setScore(world.score);
        setRound(world.round);
        setLives(world.lives);
        setCombo(world.combo);
        setStretchRatio(world.stretchGoal > 0 ? world.stretch / world.stretchGoal : 0);
        if (world.isOver) setIsOver(true);

        const { width, height } = sizeRef.current;
        if (width > 0 && height > 0) {
          const pivotX = width / 2;
          const pivotY = height * 0.16;
          const armLength = Math.min(width, height) * 0.34;
          const usuY = pivotY + armLength;
          const usuRadiusX = Math.min(width, height) * 0.14;
          const mochiRadiusX = usuRadiusX * (0.55 + 0.35 * (world.stretch / world.stretchGoal));
          const mochiRadiusY = usuRadiusX * 0.32;

          const standardAngle = Math.PI / 2 + world.angle;
          const malletX = pivotX + Math.cos(standardAngle) * armLength;
          const malletY = pivotY + Math.sin(standardAngle) * armLength;

          zoneGraphics.clear();
          zoneGraphics
            .moveTo(
              pivotX + Math.cos(Math.PI / 2 - world.goodThreshold) * armLength,
              pivotY + Math.sin(Math.PI / 2 - world.goodThreshold) * armLength,
            )
            .arc(
              pivotX,
              pivotY,
              armLength,
              Math.PI / 2 - world.goodThreshold,
              Math.PI / 2 + world.goodThreshold,
            )
            .stroke({ width: 10, color: TARGET_ZONE_COLOR, alpha: 0.35 });
          zoneGraphics
            .moveTo(
              pivotX + Math.cos(Math.PI / 2 - world.perfectThreshold) * armLength,
              pivotY + Math.sin(Math.PI / 2 - world.perfectThreshold) * armLength,
            )
            .arc(
              pivotX,
              pivotY,
              armLength,
              Math.PI / 2 - world.perfectThreshold,
              Math.PI / 2 + world.perfectThreshold,
            )
            .stroke({ width: 10, color: PERFECT_ZONE_COLOR, alpha: 0.6 });

          usuGraphics.clear();
          usuGraphics
            .ellipse(pivotX, usuY + mochiRadiusY * 0.6, usuRadiusX, usuRadiusX * 0.4)
            .fill({ color: USU_COLOR });

          mochiGraphics.clear();
          mochiGraphics
            .ellipse(pivotX, usuY, mochiRadiusX, mochiRadiusY)
            .fill({ color: MOCHI_COLOR })
            .stroke({ width: 2, color: 0xd9cdb0, alpha: 0.8 });

          handGraphics.clear();
          if (world.isHandPresent) {
            handGraphics
              .ellipse(pivotX + mochiRadiusX * 0.85, usuY - mochiRadiusY * 0.2, 16, 22)
              .fill({ color: HAND_COLOR, alpha: 0.9 });
          }

          armGraphics.clear();
          armGraphics
            .moveTo(pivotX, pivotY)
            .lineTo(malletX, malletY)
            .stroke({ width: 6, color: ARM_COLOR });
          armGraphics.circle(pivotX, pivotY, 7).fill({ color: ARM_COLOR });
          armGraphics.circle(malletX, malletY, 18).fill({ color: MALLET_COLOR });
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
          handleStrike();
        },
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
          } else if (key === "r") {
            world.reset();
            setIsOver(false);
          } else if (key === "enter") {
            handleStrike();
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
  }, [handleStrike]);

  useEffect(() => {
    sizeRef.current = { width: size.width, height: size.height };
  }, [size.width, size.height]);

  return (
    <GameShell
      title="Mochi Pound"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="mochi-pound-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="mochi-pound-canvas" />
        <div className={styles.hud}>
          <span className={styles.round} data-testid="mochi-pound-round">
            臼 {round}
          </span>
          <span className={styles.lives} data-testid="mochi-pound-lives">
            ライフ {lives}
          </span>
          {combo >= 2 && (
            <span className={styles.combo} data-testid="mochi-pound-combo">
              COMBO {combo}
            </span>
          )}
        </div>
        <div className={styles.stretchBar} data-testid="mochi-pound-stretch">
          <div className={styles.stretchLabel}>もちもち度 {Math.round(stretchRatio * 100)}%</div>
          <div className={styles.stretchTrack}>
            <div
              className={styles.stretchFill}
              style={{ width: `${Math.min(100, stretchRatio * 100)}%` }}
            />
          </div>
        </div>
        <div className={styles.hint}>
          杵が最下点(緑=PERFECT圏内、黄=GOOD圏内)を通る瞬間にクリック/タップ/Enterで振り下ろす。
          振り下ろした直後は合いの手が餅を返すので、その間に打つと手を叩いてしまう。 Space: 一時停止
          / R: リセット。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="mochi-pound-gameover">
            <div className={styles.gameOverTitle}>もちつき終了</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <div className={styles.gameOverSub}>到達した臼 {round}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="mochi-pound-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
