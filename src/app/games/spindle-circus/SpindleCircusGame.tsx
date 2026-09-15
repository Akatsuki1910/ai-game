"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import {
  DANGER_WOBBLE,
  type PlateFellEvent,
  type PlateSpunEvent,
  SPINDLE_COUNT,
  SpindleCircusWorld,
  START_LIVES,
} from "./engine/world";
import styles from "./SpindleCircusGame.module.scss";

const STABLE_COLOR = 0x7cf5c4;
const WARNING_COLOR = 0xffb454;
const DANGER_COLOR = 0xff6b6b;
const POLE_COLOR = 0x4a4f5c;
const EMPTY_SLOT_COLOR = 0x2b2f3a;
const SPUN_TEXT_COLOR = 0xffe066;
const FELL_TEXT_COLOR = 0xff6b6b;

const POPUP_LIFETIME = 1.0;

interface FloatingPopup {
  text: Text;
  age: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpColor(colorA: number, colorB: number, t: number): number {
  const ratio = Math.min(1, Math.max(0, t));
  const aR = (colorA >> 16) & 0xff;
  const aG = (colorA >> 8) & 0xff;
  const aB = colorA & 0xff;
  const bR = (colorB >> 16) & 0xff;
  const bG = (colorB >> 8) & 0xff;
  const bB = colorB & 0xff;
  const r = Math.round(lerp(aR, bR, ratio));
  const g = Math.round(lerp(aG, bG, ratio));
  const b = Math.round(lerp(aB, bB, ratio));
  return (r << 16) | (g << 8) | b;
}

function colorForWobble(wobble: number): number {
  if (wobble < DANGER_WOBBLE) {
    return lerpColor(STABLE_COLOR, WARNING_COLOR, wobble / DANGER_WOBBLE);
  }
  return lerpColor(WARNING_COLOR, DANGER_COLOR, (wobble - DANGER_WOBBLE) / (1 - DANGER_WOBBLE));
}

function spindleIndexFromX(x: number, width: number): number {
  if (width <= 0) return 0;
  const raw = Math.floor((x / width) * SPINDLE_COUNT);
  return Math.min(SPINDLE_COUNT - 1, Math.max(0, raw));
}

export function SpindleCircusGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(START_LIVES);
  const [combo, setCombo] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<SpindleCircusWorld | null>(null);
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

  const handleSpin = useCallback((index: number) => {
    if (!worldRef.current || loopRef.current?.isPaused) return;
    worldRef.current.spinSpindle(index);
  }, []);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    let disposed = false;

    const app = new Application();
    const world = new SpindleCircusWorld();
    worldRef.current = world;

    const spindleGraphics = new Graphics();
    const popupHost = new Container();
    const floatingPopups: FloatingPopup[] = [];

    const spawnPopup = (label: string, color: number, x: number, y: number): void => {
      const text = new Text({
        text: label,
        style: { fill: color, fontSize: 18, fontWeight: "700" },
      });
      text.anchor.set(0.5, 0.5);
      text.position.set(x, y);
      popupHost.addChild(text);
      floatingPopups.push({ text, age: 0 });
    };

    world.onPlateSpun = ({ spindleIndex, points, combo: comboCount }: PlateSpunEvent) => {
      const { width, height } = sizeRef.current;
      const x = width * ((spindleIndex + 0.5) / SPINDLE_COUNT);
      const label = comboCount > 1 ? `+${points} COMBO x${comboCount}` : `+${points}`;
      spawnPopup(label, SPUN_TEXT_COLOR, x, height * 0.2);
    };
    world.onPlateFell = ({ spindleIndex }: PlateFellEvent) => {
      const { width, height } = sizeRef.current;
      const x = width * ((spindleIndex + 0.5) / SPINDLE_COUNT);
      spawnPopup("落下!", FELL_TEXT_COLOR, x, height * 0.4);
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x0b0c10,
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
      app.stage.addChild(spindleGraphics, popupHost);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        world.step(deltaSeconds);

        setScore(world.score);
        setLives(world.lives);
        setCombo(world.combo);
        if (world.isOver) setIsOver(true);

        const { width, height } = sizeRef.current;
        if (width > 0 && height > 0) {
          const baselineY = height * 0.82;
          const plateY = height * 0.28;
          const laneWidth = width / SPINDLE_COUNT;
          const plateRadius = Math.min(laneWidth * 0.32, height * 0.14, 46);

          spindleGraphics.clear();
          for (const spindle of world.spindles) {
            const cx = laneWidth * (spindle.id + 0.5);

            spindleGraphics
              .moveTo(cx, baselineY)
              .lineTo(cx, plateY)
              .stroke({ width: 4, color: POLE_COLOR, alpha: 0.8 });
            spindleGraphics.circle(cx, baselineY, 10).fill({ color: POLE_COLOR, alpha: 0.9 });

            if (!spindle.hasPlate) {
              spindleGraphics
                .circle(cx, plateY, plateRadius * 0.6)
                .stroke({ width: 2, color: EMPTY_SLOT_COLOR, alpha: 0.6 });
              continue;
            }

            const wobbleShake =
              Math.sin(world.elapsedSeconds * (6 + spindle.wobble * 10) + spindle.id * 1.7) *
              spindle.wobble *
              plateRadius *
              0.4;
            const plateColor = colorForWobble(spindle.wobble);
            const px = cx + wobbleShake;
            const squish = 1 - spindle.wobble * 0.25;

            spindleGraphics
              .ellipse(px, plateY, plateRadius, plateRadius * squish)
              .fill({ color: plateColor, alpha: 0.9 })
              .stroke({ width: 2, color: 0xffffff, alpha: 0.35 });

            const spokeX = Math.cos(spindle.spinAngle) * plateRadius * 0.85;
            const spokeY = Math.sin(spindle.spinAngle) * plateRadius * 0.85 * squish;
            spindleGraphics
              .moveTo(px - spokeX, plateY - spokeY)
              .lineTo(px + spokeX, plateY + spokeY)
              .stroke({ width: 2, color: 0xffffff, alpha: 0.55 });
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
        onPointerDown: (pointer) => {
          handleSpin(spindleIndexFromX(pointer.x, sizeRef.current.width));
        },
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
          } else if (key === "r") {
            world.reset();
            setIsOver(false);
          } else {
            const digit = Number.parseInt(key, 10);
            if (Number.isInteger(digit) && digit >= 1 && digit <= SPINDLE_COUNT) {
              handleSpin(digit - 1);
            }
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
  }, [handleSpin]);

  useEffect(() => {
    sizeRef.current = { width: size.width, height: size.height };
  }, [size.width, size.height]);

  return (
    <GameShell
      title="Spindle Circus"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="spindle-circus-stage">
        <div
          ref={canvasHostRef}
          className={styles.canvasHost}
          data-testid="spindle-circus-canvas"
        />
        <div className={styles.hud}>
          <span className={styles.lives} data-testid="spindle-circus-lives">
            ライフ {lives}
          </span>
          {combo >= 2 && (
            <span className={styles.combo} data-testid="spindle-circus-combo">
              COMBO {combo}
            </span>
          )}
        </div>
        <div className={styles.hint}>
          回っている柱をタップ(またはキーボードの1〜{SPINDLE_COUNT})でスピンをかけ直す。
          ぐらつきが赤くなる前に回せ。ぎりぎりで回すほど高得点だが、放置すると皿が落ちてライフが減る。
          Space: 一時停止 / R: リセット。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="spindle-circus-gameover">
            <div className={styles.gameOverTitle}>すべての皿が割れた</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="spindle-circus-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
