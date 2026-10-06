"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import {
  type CatchEvent,
  type FishSpecies,
  LINES_MAX,
  type LossEvent,
  TautLineWorld,
} from "./engine/world";
import styles from "./TautLineGame.module.scss";

const SPECIES_HEX = {
  minnow: 0xbfd7ea,
  bass: 0x4cd9a0,
  marlin: 0x8b6cff,
} as const satisfies Record<FishSpecies, number>;

const SPECIES_LABEL = {
  minnow: "小魚",
  bass: "シーバス",
  marlin: "カジキ",
} as const satisfies Record<FishSpecies, string>;

const SPECIES_RADIUS_SCALE = {
  minnow: 0.8,
  bass: 1.05,
  marlin: 1.35,
} as const satisfies Record<FishSpecies, number>;

const BOAT_X_RATIO = 0.14;
const FISH_MAX_X_RATIO = 0.86;
const LINE_Y_RATIO = 0.48;
const POPUP_LIFETIME = 1.0;
const KEY_PUMP_POWER = 0.45;

const TENSION_COLOR_STOPS: ReadonlyArray<{ at: number; rgb: readonly [number, number, number] }> = [
  { at: 0, rgb: [110, 231, 255] },
  { at: 0.6, rgb: [255, 180, 84] },
  { at: 1, rgb: [255, 107, 107] },
];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function tensionColor(tension: number): number {
  const clamped = Math.min(1, Math.max(0, tension));
  let lower = TENSION_COLOR_STOPS[0];
  let upper = TENSION_COLOR_STOPS[TENSION_COLOR_STOPS.length - 1];
  for (let i = 0; i < TENSION_COLOR_STOPS.length - 1; i++) {
    if (clamped >= TENSION_COLOR_STOPS[i].at && clamped <= TENSION_COLOR_STOPS[i + 1].at) {
      lower = TENSION_COLOR_STOPS[i];
      upper = TENSION_COLOR_STOPS[i + 1];
      break;
    }
  }
  const span = upper.at - lower.at || 1;
  const localT = (clamped - lower.at) / span;
  const r = Math.round(lerp(lower.rgb[0], upper.rgb[0], localT));
  const g = Math.round(lerp(lower.rgb[1], upper.rgb[1], localT));
  const b = Math.round(lerp(lower.rgb[2], upper.rgb[2], localT));
  return (r << 16) | (g << 8) | b;
}

interface PixelPoint {
  x: number;
  y: number;
}

function boatPixelPosition(width: number, height: number): PixelPoint {
  return { x: width * BOAT_X_RATIO, y: height * LINE_Y_RATIO };
}

function fishPixelPosition(distance: number, width: number, height: number): PixelPoint {
  return {
    x: width * (BOAT_X_RATIO + distance * (FISH_MAX_X_RATIO - BOAT_X_RATIO)),
    y: height * LINE_Y_RATIO,
  };
}

function fishRadius(species: FishSpecies, width: number, height: number): number {
  const shortest = Math.min(width, height);
  const base = Math.min(26, Math.max(13, shortest * 0.032));
  return base * SPECIES_RADIUS_SCALE[species];
}

interface FloatingPopup {
  text: Text;
  age: number;
}

export function TautLineGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [lines, setLines] = useState(LINES_MAX);
  const [tensionPercent, setTensionPercent] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const fishMarkerRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<TautLineWorld | null>(null);
  const appRef = useRef<Application | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const sizeRef = useRef({ width: 0, height: 0 });

  const handleTogglePause = useCallback(() => {
    if (!loopRef.current) return;
    setIsPaused(loopRef.current.togglePause());
  }, []);

  const handleRestart = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    world.reset();
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
    const world = new TautLineWorld();
    worldRef.current = world;

    const lineGraphics = new Graphics();
    const fishGraphics = new Graphics();
    const labelText = new Text({
      text: "",
      style: { fill: 0xf2f3f5, fontSize: 14, fontWeight: "700" },
    });
    labelText.anchor.set(0.5, 1);
    const floatingPopups: FloatingPopup[] = [];
    const popupHost = new Container();
    const pointerLastY = new Map<number, number>();

    const spawnPopup = (label: string, color: number, x: number, y: number): void => {
      const text = new Text({
        text: label,
        style: { fill: color, fontSize: 18, fontWeight: "800" },
      });
      text.anchor.set(0.5, 0.5);
      text.position.set(x, y);
      popupHost.addChild(text);
      floatingPopups.push({ text, age: 0 });
    };

    world.onCatch = ({ species, points }: CatchEvent) => {
      const { width, height } = sizeRef.current;
      if (width === 0 || height === 0) return;
      const pos = boatPixelPosition(width, height);
      spawnPopup(`+${points} ${SPECIES_LABEL[species]}`, SPECIES_HEX[species], pos.x, pos.y - 30);
    };
    world.onLoss = ({ species, reason }: LossEvent) => {
      const { width, height } = sizeRef.current;
      if (width === 0 || height === 0) return;
      const pos = fishPixelPosition(world.distance, width, height);
      const label = reason === "snapped" ? "ライン切れ!" : `${SPECIES_LABEL[species]}に逃げられた`;
      spawnPopup(label, reason === "snapped" ? 0xff6b6b : 0xffb454, pos.x, pos.y - 30);
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x071824,
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
      app.stage.addChild(lineGraphics, fishGraphics, labelText, popupHost);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds, elapsedSeconds) => {
        world.step(deltaSeconds);

        setScore(world.score);
        setCombo(world.combo);
        setLines(world.lines);
        setTensionPercent(Math.round(world.tension * 100));
        if (world.isOver) setIsOver(true);

        const { width, height } = sizeRef.current;
        if (width > 0 && height > 0) {
          const boat = boatPixelPosition(width, height);
          const bob = Math.sin(elapsedSeconds * 2.4) * Math.min(6, height * 0.012);
          const fish = fishPixelPosition(world.distance, width, height);
          fish.y += bob;
          const radius = fishRadius(world.species, width, height);

          lineGraphics.clear();
          const lineColor = tensionColor(world.tension);
          lineGraphics
            .moveTo(boat.x, boat.y)
            .lineTo(fish.x, fish.y)
            .stroke({ width: 2 + world.tension * 4, color: lineColor, alpha: 0.95 });
          lineGraphics
            .poly([boat.x, boat.y - 14, boat.x + 22, boat.y, boat.x, boat.y + 14])
            .fill({ color: 0x2b2f3a, alpha: 0.95 })
            .stroke({ width: 2, color: 0x6ee7ff, alpha: 0.8 });

          fishGraphics.clear();
          if (world.isRunning) {
            const pulse = 1 + Math.sin(elapsedSeconds * 10) * 0.12;
            fishGraphics
              .circle(fish.x, fish.y, (radius + 8) * pulse)
              .stroke({ width: 3, color: 0xff6b6b, alpha: 0.75 });
          }
          fishGraphics
            .circle(fish.x, fish.y, radius)
            .fill({ color: SPECIES_HEX[world.species], alpha: 0.95 })
            .stroke({ width: 2, color: 0xffffff, alpha: 0.7 });

          labelText.text = world.isRunning
            ? `${SPECIES_LABEL[world.species]} 引いてる!`
            : SPECIES_LABEL[world.species];
          labelText.position.set(fish.x, fish.y - radius - 6);

          if (fishMarkerRef.current) {
            fishMarkerRef.current.style.left = `${fish.x}px`;
            fishMarkerRef.current.style.top = `${fish.y}px`;
            fishMarkerRef.current.dataset.species = world.species;
            fishMarkerRef.current.dataset.running = String(world.isRunning);
            fishMarkerRef.current.dataset.distance = String(Math.round(world.distance * 100));
          }

          for (let i = floatingPopups.length - 1; i >= 0; i--) {
            const entry = floatingPopups[i];
            entry.age += deltaSeconds;
            entry.text.position.y -= deltaSeconds * 24;
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
        onPointerDown: (pointer) => {
          if (loop.isPaused || world.isOver) return;
          pointerLastY.set(pointer.id, pointer.y);
        },
        onPointerMove: (pointer) => {
          if (loop.isPaused || world.isOver) return;
          const lastY = pointerLastY.get(pointer.id);
          if (lastY === undefined) return;
          const { height } = sizeRef.current;
          const pumpPixelsForFullPower = Math.max(32, height * 0.16);
          const movedUp = lastY - pointer.y;
          if (movedUp > 0) {
            world.reel(Math.min(1, movedUp / pumpPixelsForFullPower));
          }
          pointerLastY.set(pointer.id, pointer.y);
        },
        onPointerUp: (pointer) => {
          pointerLastY.delete(pointer.id);
        },
        onKeyDown: (key) => {
          if (loop.isPaused && key !== " ") return;
          if (key === " ") {
            setIsPaused(loop.togglePause());
            return;
          }
          if (key === "r") {
            world.reset();
            pointerLastY.clear();
            setIsOver(false);
            return;
          }
          if (!world.isOver && (key === "arrowup" || key === "w")) {
            world.reel(KEY_PUMP_POWER);
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
    sizeRef.current = { width: size.width, height: size.height };
  }, [size.width, size.height]);

  return (
    <GameShell
      title="Taut Line"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="taut-line-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="taut-line-canvas" />
        <div ref={fishMarkerRef} className={styles.fishMarker} data-testid="taut-line-fish" />
        <div className={styles.hud}>
          <span className={styles.combo} data-testid="taut-line-combo">
            COMBO {combo}
          </span>
          <span className={styles.lines} data-testid="taut-line-lines" data-lines={lines}>
            ライン {lines} / {LINES_MAX}
          </span>
          <span
            className={styles.tension}
            data-testid="taut-line-tension"
            data-tension={tensionPercent}
          >
            テンション {tensionPercent}%
            <span className={styles.tensionTrack}>
              <span
                className={styles.tensionFill}
                style={{ width: `${tensionPercent}%` }}
                data-dangerous={tensionPercent >= 80}
              />
            </span>
          </span>
        </div>
        <div className={styles.hint}>
          画面を押して上へ引く(ポンピング)動作を繰り返してリールを巻こう。魚が穏やかな間に巻き寄せ、
          強く引く(run)間は巻きすぎるとラインが切れる。キーボードは↑/W連打でリール、Space: 一時停止
          / R: リセット
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="taut-line-gameover">
            <div className={styles.gameOverTitle}>今日の釣果</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="taut-line-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
