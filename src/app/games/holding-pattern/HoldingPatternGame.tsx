"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import {
  FUEL_MAX,
  HoldingPatternWorld,
  type IncidentEvent,
  type LandEvent,
  MAX_STRIKES,
  PLANE_RADIUS,
  type Plane,
  type Runway,
} from "./engine/world";
import styles from "./HoldingPatternGame.module.scss";

const PLANE_TIP_LENGTH = 17;
const PLANE_BACK_LENGTH = 11;
const PLANE_BACK_SPREAD = 2.5;
const HIT_PADDING = 16;
const MIN_AIM_DISTANCE = 10;
const TURN_KEY_RATE = 2.4;
const POPUP_LIFETIME = 1;

const FUEL_COLOR_GOOD = 0x7cf5c4;
const FUEL_COLOR_WARNING = 0xffb454;
const FUEL_COLOR_DANGER = 0xff6b6b;
const RUNWAY_COLOR = 0x6ee7ff;
const SELECTION_RING_COLOR = 0xffffff;

interface PixelPoint {
  x: number;
  y: number;
}

function fuelColor(ratio: number): number {
  if (ratio > 0.5) return FUEL_COLOR_GOOD;
  if (ratio > 0.22) return FUEL_COLOR_WARNING;
  return FUEL_COLOR_DANGER;
}

function planeTrianglePoints(x: number, y: number, heading: number): number[] {
  const tipX = x + Math.cos(heading) * PLANE_TIP_LENGTH;
  const tipY = y + Math.sin(heading) * PLANE_TIP_LENGTH;
  const leftX = x + Math.cos(heading + PLANE_BACK_SPREAD) * PLANE_BACK_LENGTH;
  const leftY = y + Math.sin(heading + PLANE_BACK_SPREAD) * PLANE_BACK_LENGTH;
  const rightX = x + Math.cos(heading - PLANE_BACK_SPREAD) * PLANE_BACK_LENGTH;
  const rightY = y + Math.sin(heading - PLANE_BACK_SPREAD) * PLANE_BACK_LENGTH;
  return [tipX, tipY, leftX, leftY, rightX, rightY];
}

function findPlaneAt(planes: readonly Plane[], point: PixelPoint): Plane | null {
  const radius = PLANE_RADIUS + HIT_PADDING;
  for (const plane of planes) {
    if (Math.hypot(plane.x - point.x, plane.y - point.y) <= radius) return plane;
  }
  return null;
}

interface DragState {
  planeId: number;
}

interface FloatingPopup {
  text: Text;
  age: number;
}

export function HoldingPatternGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [strikes, setStrikes] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const planeMarkerRef = useRef<HTMLDivElement | null>(null);
  const beaconMarkerRefs = useRef<(HTMLDivElement | null)[]>([]);
  const worldRef = useRef<HoldingPatternWorld | null>(null);
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
    const world = new HoldingPatternWorld(1, 1);
    worldRef.current = world;

    const runwayGraphics = new Graphics();
    const planeGraphics = new Graphics();
    const popupHost = new Container();
    const floatingPopups: FloatingPopup[] = [];
    const draggingByPointer = new Map<number, DragState>();
    let selectedPlaneId: number | null = null;

    const spawnPopup = (label: string, color: number, x: number, y: number): void => {
      const text = new Text({
        text: label,
        style: { fill: color, fontSize: 15, fontWeight: "700" },
      });
      text.anchor.set(0.5, 0.5);
      text.position.set(x, y);
      popupHost.addChild(text);
      floatingPopups.push({ text, age: 0 });
    };

    world.onLand = ({ points, x, y }: LandEvent) => {
      spawnPopup(`着陸 +${points}`, FUEL_COLOR_GOOD, x, y - 22);
    };
    world.onIncident = ({ reason, x, y }: IncidentEvent) => {
      const label = reason === "collision" ? "異常接近" : "燃料切れ";
      spawnPopup(label, FUEL_COLOR_DANGER, x, y - 22);
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x0a0d14,
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
      app.stage.addChild(runwayGraphics, planeGraphics, popupHost);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        if (selectedPlaneId !== null) {
          if (input.isKeyDown("arrowleft") || input.isKeyDown("a")) {
            world.rotatePlaneTargetHeading(selectedPlaneId, -TURN_KEY_RATE * deltaSeconds);
          }
          if (input.isKeyDown("arrowright") || input.isKeyDown("d")) {
            world.rotatePlaneTargetHeading(selectedPlaneId, TURN_KEY_RATE * deltaSeconds);
          }
        }

        world.step(deltaSeconds);

        if (selectedPlaneId !== null && !world.planes.some((p) => p.id === selectedPlaneId)) {
          selectedPlaneId = null;
        }

        setScore(world.score);
        setStreak(world.streak);
        setStrikes(world.strikes);
        if (world.isOver) setIsOver(true);

        const { width, height } = sizeRef.current;
        if (width > 0 && height > 0) {
          runwayGraphics.clear();
          for (const runway of world.runways) {
            drawRunway(runwayGraphics, runway);
          }

          planeGraphics.clear();
          let urgent: Plane | null = null;
          for (const plane of world.planes) {
            if (!urgent || plane.fuel < urgent.fuel) urgent = plane;

            if (plane.id === selectedPlaneId) {
              planeGraphics
                .circle(plane.x, plane.y, PLANE_RADIUS + 6)
                .stroke({ width: 2, color: SELECTION_RING_COLOR, alpha: 0.85 });
            }

            const points = planeTrianglePoints(plane.x, plane.y, plane.heading);
            const color = fuelColor(plane.fuel / FUEL_MAX);
            planeGraphics
              .poly(points)
              .fill({ color, alpha: 0.95 })
              .stroke({ width: 2, color: 0xffffff, alpha: 0.5 });

            const barWidth = PLANE_RADIUS * 1.8;
            const barX = plane.x - barWidth / 2;
            const barY = plane.y + PLANE_RADIUS + 6;
            planeGraphics.rect(barX, barY, barWidth, 3).fill({ color: 0x000000, alpha: 0.4 });
            planeGraphics
              .rect(barX, barY, barWidth * Math.max(0, plane.fuel / FUEL_MAX), 3)
              .fill({ color, alpha: 0.9 });
          }

          if (planeMarkerRef.current) {
            if (urgent) {
              planeMarkerRef.current.style.left = `${urgent.x}px`;
              planeMarkerRef.current.style.top = `${urgent.y}px`;
              planeMarkerRef.current.style.display = "block";
              planeMarkerRef.current.dataset.planeId = String(urgent.id);
              planeMarkerRef.current.dataset.fuelRatio = String(urgent.fuel / FUEL_MAX);
              planeMarkerRef.current.dataset.heading = String(urgent.heading);
            } else {
              planeMarkerRef.current.style.display = "none";
              delete planeMarkerRef.current.dataset.planeId;
            }
          }

          world.runways.forEach((runway, index) => {
            const marker = beaconMarkerRefs.current[index];
            if (!marker) return;
            marker.style.left = `${runway.beaconX}px`;
            marker.style.top = `${runway.beaconY}px`;
          });

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
          if (loop.isPaused) return;
          const hit = findPlaneAt(world.planes, pointer);
          if (hit) {
            selectedPlaneId = hit.id;
            draggingByPointer.set(pointer.id, { planeId: hit.id });
          } else {
            selectedPlaneId = null;
          }
        },
        onPointerMove: (pointer) => {
          if (loop.isPaused) return;
          const drag = draggingByPointer.get(pointer.id);
          if (!drag) return;
          const plane = world.planes.find((p) => p.id === drag.planeId);
          if (!plane) return;
          const dx = pointer.x - plane.x;
          const dy = pointer.y - plane.y;
          if (Math.hypot(dx, dy) < MIN_AIM_DISTANCE) return;
          world.setPlaneTargetHeading(plane.id, Math.atan2(dy, dx));
        },
        onPointerUp: (pointer) => {
          draggingByPointer.delete(pointer.id);
        },
        onKeyDown: (key) => {
          if (loop.isPaused && key !== " ") return;
          if (key === " ") {
            setIsPaused(loop.togglePause());
            return;
          }
          if (key === "r") {
            world.reset();
            draggingByPointer.clear();
            selectedPlaneId = null;
            setIsOver(false);
            return;
          }
          if (key === "n") {
            selectedPlaneId = world.mostUrgentPlaneId();
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
    worldRef.current?.resize(size.width, size.height);
  }, [size.width, size.height]);

  return (
    <GameShell
      title="Holding Pattern"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="holding-pattern-stage">
        <div
          ref={canvasHostRef}
          className={styles.canvasHost}
          data-testid="holding-pattern-canvas"
        />
        <div
          ref={planeMarkerRef}
          className={styles.planeMarker}
          data-testid="holding-pattern-plane-marker"
        />
        <div
          ref={(el) => {
            beaconMarkerRefs.current[0] = el;
          }}
          className={styles.beaconMarker}
          data-testid="holding-pattern-beacon-0"
        />
        <div
          ref={(el) => {
            beaconMarkerRefs.current[1] = el;
          }}
          className={styles.beaconMarker}
          data-testid="holding-pattern-beacon-1"
        />
        <div className={styles.hud}>
          <span className={styles.streak} data-testid="holding-pattern-streak">
            連続着陸 {streak}
          </span>
          <span
            className={styles.strikes}
            data-testid="holding-pattern-strikes"
            data-strikes={strikes}
          >
            警告 {strikes} / {MAX_STRIKES}
          </span>
        </div>
        <div className={styles.hint}>
          機体をドラッグで選んでビーコンの先まで狙いを定め、滑走路の軸に方位を揃えて着陸させよう。
          機体同士を近づけすぎず、燃料が尽きる前に誘導を。 キーボードはN:
          最も燃料が少ない機体を選択、←→/A・D: 選択機の方位を回転。Space: 一時停止 / R: リセット
        </div>
        <div className={styles.panel} data-testid="holding-pattern-legend">
          {["東ランウェイ", "南ランウェイ"].map((label, index) => (
            <span
              key={label}
              className={styles.legendItem}
              data-testid={`holding-pattern-runway-${index}`}
              data-label={label}
              title={label}
            />
          ))}
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="holding-pattern-gameover">
            <div className={styles.gameOverTitle}>管制不能</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="holding-pattern-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}

function drawRunway(graphics: Graphics, runway: Runway): void {
  graphics
    .rect(runway.x - runway.width / 2, runway.y - runway.height / 2, runway.width, runway.height)
    .fill({ color: RUNWAY_COLOR, alpha: 0.12 })
    .stroke({ width: 2, color: RUNWAY_COLOR, alpha: 0.7 });

  const tickLength = Math.max(runway.width, runway.height) * 0.5;
  const tickX = runway.x + Math.cos(runway.heading) * tickLength;
  const tickY = runway.y + Math.sin(runway.heading) * tickLength;
  graphics
    .moveTo(runway.x, runway.y)
    .lineTo(tickX, tickY)
    .stroke({ width: 3, color: RUNWAY_COLOR, alpha: 0.9 });

  graphics
    .moveTo(runway.x, runway.y)
    .lineTo(runway.beaconX, runway.beaconY)
    .stroke({ width: 1, color: RUNWAY_COLOR, alpha: 0.35 });
  graphics.circle(runway.beaconX, runway.beaconY, 6).fill({ color: RUNWAY_COLOR, alpha: 0.8 });
}
