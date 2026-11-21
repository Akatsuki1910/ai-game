"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import {
  CAR_CAPACITY,
  DWELL_SECONDS,
  FLOOR_COUNT,
  PATIENCE_MAX,
  ROUND_SECONDS,
  ShaftDispatchWorld,
} from "./engine/world";
import styles from "./ShaftDispatchGame.module.scss";

const COLOR_SHAFT_BORDER = 0x2b2f3a;
const COLOR_SHAFT_FILL = 0x14161d;
const COLOR_CAR_IDLE = 0x6ee7ff;
const COLOR_CAR_DOOR_OPEN = 0xffe066;
const COLOR_PATIENCE_GOOD = 0x7cf5c4;
const COLOR_PATIENCE_BAD = 0xff6b6b;
const COLOR_TEXT = 0xf2f3f5;
const COLOR_MISS_TEXT = 0xff6b6b;

const MAX_VISIBLE_WAITING_PER_FLOOR = 5;
const POPUP_LIFETIME = 0.9;
/** 呼び出しボタンは建物の見た目通り、最上階から最下階の順に並べる。 */
const CALL_PANEL_FLOOR_ORDER = Array.from({ length: FLOOR_COUNT }, (_, i) => FLOOR_COUNT - 1 - i);

function floorLabel(floorIndex: number): string {
  return `${floorIndex + 1}F`;
}

function lerpColor(colorA: number, colorB: number, t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  const ar = (colorA >> 16) & 0xff;
  const ag = (colorA >> 8) & 0xff;
  const ab = colorA & 0xff;
  const br = (colorB >> 16) & 0xff;
  const bg = (colorB >> 8) & 0xff;
  const bb = colorB & 0xff;
  const r = Math.round(ar + (br - ar) * clamped);
  const g = Math.round(ag + (bg - ag) * clamped);
  const b = Math.round(ab + (bb - ab) * clamped);
  return (r << 16) | (g << 8) | b;
}

interface FloatingPopup {
  text: Text;
  age: number;
}

export function ShaftDispatchGame() {
  const { ref: stageRef } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(ROUND_SECONDS);
  const [deliveredCount, setDeliveredCount] = useState(0);
  const [missedCount, setMissedCount] = useState(0);
  const [carFloorLabel, setCarFloorLabel] = useState(floorLabel(FLOOR_COUNT - 1));
  const [isDoorOpen, setIsDoorOpen] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<ShaftDispatchWorld | null>(null);
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

  const handleCallFloor = useCallback((floorIndex: number) => {
    worldRef.current?.requestCar(floorIndex);
  }, []);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    let disposed = false;

    const app = new Application();
    const world = new ShaftDispatchWorld();
    worldRef.current = world;

    const shaftGraphics = new Graphics();
    const carGraphics = new Graphics();
    const waitingGraphics = new Graphics();
    const carLabel = new Text({
      text: "",
      style: { fill: 0x05060a, fontSize: 14, fontWeight: "700" },
    });
    carLabel.anchor.set(0.5);
    const floorLabels: Text[] = Array.from({ length: FLOOR_COUNT }, () => {
      const label = new Text({
        text: "",
        style: { fill: COLOR_TEXT, fontSize: 13, fontWeight: "600" },
      });
      label.anchor.set(0, 0.5);
      return label;
    });
    const floorLabelContainer = new Container();
    floorLabelContainer.addChild(...floorLabels);
    const overflowLabels: Text[] = Array.from({ length: FLOOR_COUNT }, () => {
      const label = new Text({
        text: "",
        style: { fill: COLOR_TEXT, fontSize: 12, fontWeight: "600" },
      });
      label.anchor.set(0, 0.5);
      return label;
    });
    const overflowLabelContainer = new Container();
    overflowLabelContainer.addChild(...overflowLabels);
    const popupContainer = new Container();
    const floatingPopups: FloatingPopup[] = [];

    world.onDelivered = ({ floor, points }) => {
      const text = new Text({
        text: `+${points}`,
        style: { fill: 0xffe066, fontSize: 18, fontWeight: "700" },
      });
      text.anchor.set(0.5, 1);
      text.position.set(0, floor);
      text.label = `floor:${floor}`;
      popupContainer.addChild(text);
      floatingPopups.push({ text, age: 0 });
    };
    world.onMissed = ({ floor }) => {
      const text = new Text({
        text: "見送り -25",
        style: { fill: COLOR_MISS_TEXT, fontSize: 14, fontWeight: "700" },
      });
      text.anchor.set(0.5, 1);
      text.position.set(0, floor);
      text.label = `floor:${floor}`;
      popupContainer.addChild(text);
      floatingPopups.push({ text, age: 0 });
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x05060a,
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
        shaftGraphics,
        waitingGraphics,
        carGraphics,
        carLabel,
        floorLabelContainer,
        overflowLabelContainer,
        popupContainer,
      );
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds, elapsedSeconds) => {
        world.step(deltaSeconds);
        setScore(Math.floor(world.score));
        setTimeRemaining(Math.ceil(world.timeRemaining));
        setDeliveredCount(world.deliveredCount);
        setMissedCount(world.missedCount);
        setCarFloorLabel(floorLabel(Math.round(world.carFloor)));
        setIsDoorOpen(world.isDoorOpen);
        if (world.isOver) setIsOver(true);

        const width = app.screen.width;
        const height = app.screen.height;
        if (width <= 0 || height <= 0) return;

        const topMargin = Math.min(64, height * 0.1);
        const bottomMargin = Math.min(88, height * 0.16);
        const buildingHeight = Math.max(80, height - topMargin - bottomMargin);
        const floorHeight = buildingHeight / FLOOR_COUNT;
        const shaftX = width * 0.08;
        const shaftWidth = width * 0.3;
        const platformX = shaftX + shaftWidth + width * 0.03;
        const platformWidth = width * 0.24;

        const floorTopY = (floorIndex: number) =>
          topMargin + (FLOOR_COUNT - 1 - floorIndex) * floorHeight;

        shaftGraphics.clear();
        shaftGraphics
          .rect(shaftX, topMargin, shaftWidth, buildingHeight)
          .fill({ color: COLOR_SHAFT_FILL, alpha: 0.6 })
          .stroke({ width: 2, color: COLOR_SHAFT_BORDER });
        for (let f = 0; f <= FLOOR_COUNT; f++) {
          const y = topMargin + (FLOOR_COUNT - f) * floorHeight;
          shaftGraphics
            .moveTo(shaftX, y)
            .lineTo(platformX + platformWidth, y)
            .stroke({ width: 1, color: COLOR_SHAFT_BORDER, alpha: 0.6 });
        }

        for (let f = 0; f < FLOOR_COUNT; f++) {
          const label = floorLabels[f];
          label.text = floorLabel(f);
          label.position.set(shaftX + 6, floorTopY(f) + floorHeight / 2);
        }

        waitingGraphics.clear();
        for (let f = 0; f < FLOOR_COUNT; f++) {
          const queue = world.waitingByFloor[f];
          const rowY = floorTopY(f) + floorHeight / 2;
          const dotRadius = Math.max(4, Math.min(9, floorHeight * 0.18));
          const visibleCount = Math.min(queue.length, MAX_VISIBLE_WAITING_PER_FLOOR);
          for (let i = 0; i < visibleCount; i++) {
            const passenger = queue[i];
            const t = 1 - Math.max(0, passenger.patience) / PATIENCE_MAX;
            const color = lerpColor(COLOR_PATIENCE_GOOD, COLOR_PATIENCE_BAD, t);
            const dotX = platformX + dotRadius + i * (dotRadius * 2 + 4);
            waitingGraphics.circle(dotX, rowY, dotRadius).fill({ color, alpha: 0.9 });
          }
          const overflowLabel = overflowLabels[f];
          if (queue.length > visibleCount) {
            overflowLabel.text = `+${queue.length - visibleCount}`;
            overflowLabel.position.set(
              platformX + dotRadius * 2 + visibleCount * (dotRadius * 2 + 4),
              rowY,
            );
          } else {
            overflowLabel.text = "";
          }
        }

        const doorProgress = world.isDoorOpen ? 1 - world.doorTimer / DWELL_SECONDS : 0;
        const carTopY = topMargin + (FLOOR_COUNT - 1 - world.carFloor) * floorHeight;
        const carPadding = floorHeight * 0.08;
        const carColor = world.isDoorOpen
          ? COLOR_CAR_DOOR_OPEN
          : lerpColor(
              COLOR_CAR_IDLE,
              COLOR_CAR_DOOR_OPEN,
              Math.sin(elapsedSeconds * 3) * 0.15 + 0.15,
            );

        carGraphics.clear();
        carGraphics
          .rect(
            shaftX + carPadding,
            carTopY + carPadding,
            shaftWidth - carPadding * 2,
            floorHeight - carPadding * 2,
          )
          .fill({ color: carColor, alpha: 0.92 })
          .stroke({ width: 2, color: 0xffffff, alpha: 0.5 });

        if (world.isDoorOpen) {
          const gap = (shaftWidth - carPadding * 2) * 0.5 * Math.min(1, doorProgress * 2);
          const doorY = carTopY + carPadding;
          const doorHeight = floorHeight - carPadding * 2;
          carGraphics
            .rect(shaftX + carPadding, doorY, gap, doorHeight)
            .fill({ color: COLOR_SHAFT_FILL, alpha: 0.85 });
          carGraphics
            .rect(shaftX + shaftWidth - carPadding - gap, doorY, gap, doorHeight)
            .fill({ color: COLOR_SHAFT_FILL, alpha: 0.85 });
        }

        carLabel.text = `${world.onboard.length}/${CAR_CAPACITY}`;
        carLabel.position.set(shaftX + shaftWidth / 2, carTopY + floorHeight / 2);

        for (let i = floatingPopups.length - 1; i >= 0; i--) {
          const entry = floatingPopups[i];
          entry.age += deltaSeconds;
          const floor = Number(entry.text.label.split(":")[1] ?? 0);
          entry.text.position.set(
            shaftX + shaftWidth + 14,
            floorTopY(floor) + floorHeight / 2 - entry.age * 24,
          );
          entry.text.alpha = Math.max(0, 1 - entry.age / POPUP_LIFETIME);
          if (entry.age >= POPUP_LIFETIME) {
            popupContainer.removeChild(entry.text);
            entry.text.destroy();
            floatingPopups.splice(i, 1);
          }
        }
      }, 0.1);

      input.addListener({
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
            return;
          }
          if (key === "r") {
            world.reset();
            setIsOver(false);
            return;
          }
          const digit = Number(key);
          if (Number.isInteger(digit) && digit >= 1 && digit <= FLOOR_COUNT) {
            world.requestCar(digit - 1);
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

  return (
    <GameShell
      title="Shaft Dispatch"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="shaft-dispatch-stage">
        <div
          ref={canvasHostRef}
          className={styles.canvasHost}
          data-testid="shaft-dispatch-canvas"
        />
        <div className={styles.hud}>
          <span className={styles.hudItem} data-testid="shaft-dispatch-timer">
            ⏱ {timeRemaining}s
          </span>
          <span className={styles.hudItem} data-testid="shaft-dispatch-delivered">
            🛗 {deliveredCount}
          </span>
          <span className={styles.hudItem} data-testid="shaft-dispatch-missed">
            😠 {missedCount}
          </span>
        </div>
        <div className={styles.carStatus}>
          <span data-testid="shaft-dispatch-car-floor">{carFloorLabel}</span>
          <span data-testid="shaft-dispatch-doors">{isDoorOpen ? "扉:開" : "扉:閉"}</span>
        </div>
        <div className={styles.callPanel}>
          {CALL_PANEL_FLOOR_ORDER.map((floorIndex) => (
            <button
              key={floorIndex}
              type="button"
              className={styles.callButton}
              onClick={() => handleCallFloor(floorIndex)}
              data-testid={`shaft-dispatch-call-${floorIndex + 1}`}
            >
              {floorLabel(floorIndex)}へ呼ぶ
            </button>
          ))}
        </div>
        <div className={styles.hint}>
          ボタンで各階にエレベーターを呼び、来た乗客を乗せて行き先の階へ届けよう。
          待たせすぎると乗客は見送られてしまう(スコア減点)。数字キー1〜6でも呼べる。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="shaft-dispatch-gameover">
            <div className={styles.gameOverTitle}>営業終了</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <div className={styles.gameOverStats}>
              運んだ人数 {deliveredCount} / 見送り {missedCount}
            </div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="shaft-dispatch-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
