"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import {
  type BreachEvent,
  CATCH_BAND_MAX,
  CATCH_BAND_MIN,
  type CatchEvent,
  INTEGRITY_MAX,
  OrbWeaverWorld,
  SPOKE_COUNT,
} from "./engine/world";
import styles from "./OrbWeaverGame.module.scss";

const OUTER_RADIUS_RATIO = 0.42;
const BUG_COLOR_IN_BAND = 0xffe066;
const BUG_COLOR_OUT_OF_BAND = 0xff9f55;
const FRAYED_COLOR = 0xff6b6b;
const HEALED_COLOR = 0x7cf5c4;
const SPOKE_COLOR = 0xe6e9f0;
const POPUP_LIFETIME = 0.9;

interface PixelPoint {
  x: number;
  y: number;
}

interface WebCenter extends PixelPoint {
  outerRadius: number;
}

function webCenter(width: number, height: number): WebCenter {
  return {
    x: width / 2,
    y: height / 2,
    outerRadius: Math.min(width, height) * OUTER_RADIUS_RATIO,
  };
}

function spokeAngle(spokeIndex: number): number {
  return -Math.PI / 2 + spokeIndex * ((Math.PI * 2) / SPOKE_COUNT);
}

function bugPixelPosition(
  spokeIndex: number,
  radius: number,
  width: number,
  height: number,
): PixelPoint {
  const center = webCenter(width, height);
  const angle = spokeAngle(spokeIndex);
  return {
    x: center.x + Math.cos(angle) * center.outerRadius * radius,
    y: center.y + Math.sin(angle) * center.outerRadius * radius,
  };
}

function bugRadiusPx(width: number, height: number): number {
  const shortest = Math.min(width, height);
  return Math.min(22, Math.max(10, shortest * 0.03));
}

function findSpokeAt(x: number, y: number, width: number, height: number): number {
  const center = webCenter(width, height);
  const angle = Math.atan2(y - center.y, x - center.x);
  const step = (Math.PI * 2) / SPOKE_COUNT;
  const diff = angle - -Math.PI / 2;
  const normalized = ((diff % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return Math.round(normalized / step) % SPOKE_COUNT;
}

function isBugInCatchBand(radius: number): boolean {
  return radius >= CATCH_BAND_MIN && radius <= CATCH_BAND_MAX;
}

interface FloatingPopup {
  text: Text;
  age: number;
}

interface SpokeMarkerState {
  hasBug: boolean;
  isInBand: boolean;
  isFrayed: boolean;
  x: number;
  y: number;
}

export function OrbWeaverGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [integrity, setIntegrity] = useState(INTEGRITY_MAX);
  const [combo, setCombo] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const spokeMarkerRefs = useRef<(HTMLDivElement | null)[]>([]);
  const worldRef = useRef<OrbWeaverWorld | null>(null);
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
    const world = new OrbWeaverWorld();
    worldRef.current = world;

    const sceneGraphics = new Graphics();
    const popupHost = new Container();
    const floatingPopups: FloatingPopup[] = [];
    const repairByPointer = new Map<number, number>();
    const repairByKey = new Map<string, number>();

    const spawnPopup = (label: string, color: number, x: number, y: number): void => {
      const text = new Text({
        text: label,
        style: { fill: color, fontSize: 16, fontWeight: "700" },
      });
      text.anchor.set(0.5, 0.5);
      text.position.set(x, y);
      popupHost.addChild(text);
      floatingPopups.push({ text, age: 0 });
    };

    world.onCatch = ({ spokeIndex, points }: CatchEvent) => {
      const { width, height } = sizeRef.current;
      if (width === 0 || height === 0) return;
      const pos = bugPixelPosition(
        spokeIndex,
        (CATCH_BAND_MIN + CATCH_BAND_MAX) / 2,
        width,
        height,
      );
      spawnPopup(`+${points}`, HEALED_COLOR, pos.x, pos.y - 16);
    };
    world.onBreach = ({ spokeIndex }: BreachEvent) => {
      const { width, height } = sizeRef.current;
      if (width === 0 || height === 0) return;
      const center = webCenter(width, height);
      const angle = spokeAngle(spokeIndex);
      const x = center.x + Math.cos(angle) * center.outerRadius * 0.18;
      const y = center.y + Math.sin(angle) * center.outerRadius * 0.18;
      spawnPopup("破れた!", FRAYED_COLOR, x, y);
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x07080c,
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
      app.stage.addChild(sceneGraphics, popupHost);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        world.step(deltaSeconds);

        setScore(world.score);
        setIntegrity(world.integrity);
        setCombo(world.combo);
        if (world.isOver) setIsOver(true);

        const { width, height } = sizeRef.current;
        if (width > 0 && height > 0) {
          const center = webCenter(width, height);
          const pRadius = bugRadiusPx(width, height);

          sceneGraphics.clear();
          sceneGraphics
            .circle(center.x, center.y, center.outerRadius * CATCH_BAND_MIN)
            .stroke({ width: 1, color: SPOKE_COLOR, alpha: 0.18 });
          sceneGraphics
            .circle(center.x, center.y, center.outerRadius * CATCH_BAND_MAX)
            .stroke({ width: 1, color: SPOKE_COLOR, alpha: 0.18 });

          for (let i = 0; i < SPOKE_COUNT; i++) {
            const angle = spokeAngle(i);
            const endX = center.x + Math.cos(angle) * center.outerRadius;
            const endY = center.y + Math.sin(angle) * center.outerRadius;
            const isFrayed = world.frayedSpokes[i];

            if (isFrayed) {
              sceneGraphics
                .moveTo(center.x, center.y)
                .lineTo(endX, endY)
                .stroke({ width: 3, color: FRAYED_COLOR, alpha: 0.55 });
              const progress = world.repairProgressAt(i);
              if (progress > 0) {
                sceneGraphics
                  .moveTo(center.x, center.y)
                  .lineTo(
                    center.x + Math.cos(angle) * center.outerRadius * progress,
                    center.y + Math.sin(angle) * center.outerRadius * progress,
                  )
                  .stroke({ width: 4, color: HEALED_COLOR, alpha: 0.9 });
              }
            } else {
              sceneGraphics
                .moveTo(center.x, center.y)
                .lineTo(endX, endY)
                .stroke({ width: 3, color: SPOKE_COLOR, alpha: 0.55 });
            }
          }

          sceneGraphics
            .circle(center.x, center.y, pRadius * 0.8)
            .fill({ color: 0x1b1e27, alpha: 0.95 })
            .stroke({ width: 2, color: SPOKE_COLOR, alpha: 0.7 });

          for (const bug of world.bugs) {
            const pos = bugPixelPosition(bug.spokeIndex, bug.radius, width, height);
            const inBand = isBugInCatchBand(bug.radius);
            const color = inBand ? BUG_COLOR_IN_BAND : BUG_COLOR_OUT_OF_BAND;
            if (inBand) {
              sceneGraphics
                .circle(pos.x, pos.y, pRadius + 5)
                .stroke({ width: 2, color: BUG_COLOR_IN_BAND, alpha: 0.8 });
            }
            sceneGraphics
              .circle(pos.x, pos.y, pRadius)
              .fill({ color, alpha: 0.95 })
              .stroke({ width: 2, color: 0xffffff, alpha: 0.5 });
          }

          const markerStates: SpokeMarkerState[] = Array.from({ length: SPOKE_COUNT }, (_, i) => ({
            hasBug: false,
            isInBand: false,
            isFrayed: world.frayedSpokes[i],
            x: center.x + Math.cos(spokeAngle(i)) * center.outerRadius * 0.5,
            y: center.y + Math.sin(spokeAngle(i)) * center.outerRadius * 0.5,
          }));
          for (const bug of world.bugs) {
            const current = markerStates[bug.spokeIndex];
            const inBand = isBugInCatchBand(bug.radius);
            if (!current.hasBug || inBand) {
              const pos = bugPixelPosition(bug.spokeIndex, bug.radius, width, height);
              markerStates[bug.spokeIndex] = {
                hasBug: true,
                isInBand: current.isInBand || inBand,
                isFrayed: current.isFrayed,
                x: pos.x,
                y: pos.y,
              };
            }
          }
          for (let i = 0; i < SPOKE_COUNT; i++) {
            const marker = spokeMarkerRefs.current[i];
            if (!marker) continue;
            const state = markerStates[i];
            marker.style.left = `${state.x}px`;
            marker.style.top = `${state.y}px`;
            marker.dataset.hasBug = String(state.hasBug);
            marker.dataset.inBand = String(state.isInBand);
            marker.dataset.frayed = String(state.isFrayed);
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

      const tryPluckOrRepair = (spokeIndex: number, onRepairStart: () => void): void => {
        if (world.frayedSpokes[spokeIndex]) {
          world.setRepairing(spokeIndex, true);
          onRepairStart();
        } else {
          world.pluck(spokeIndex);
        }
      };

      input.addListener({
        onPointerDown: (pointer) => {
          if (loop.isPaused) return;
          const { width, height } = sizeRef.current;
          if (width === 0 || height === 0) return;
          const spokeIndex = findSpokeAt(pointer.x, pointer.y, width, height);
          tryPluckOrRepair(spokeIndex, () => repairByPointer.set(pointer.id, spokeIndex));
        },
        onPointerUp: (pointer) => {
          const spokeIndex = repairByPointer.get(pointer.id);
          if (spokeIndex === undefined) return;
          repairByPointer.delete(pointer.id);
          world.setRepairing(spokeIndex, false);
        },
        onKeyDown: (key) => {
          if (loop.isPaused && key !== " ") return;
          if (key === " ") {
            setIsPaused(loop.togglePause());
            return;
          }
          if (key === "r") {
            world.reset();
            repairByPointer.clear();
            repairByKey.clear();
            setIsOver(false);
            return;
          }
          if (/^[1-6]$/.test(key)) {
            const spokeIndex = Number(key) - 1;
            if (spokeIndex >= SPOKE_COUNT) return;
            tryPluckOrRepair(spokeIndex, () => repairByKey.set(key, spokeIndex));
          }
        },
        onKeyUp: (key) => {
          const spokeIndex = repairByKey.get(key);
          if (spokeIndex === undefined) return;
          repairByKey.delete(key);
          world.setRepairing(spokeIndex, false);
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

  const integrityRatio = Math.max(0, Math.min(1, integrity / INTEGRITY_MAX));
  const isIntegrityDanger = integrityRatio <= 0.3;

  return (
    <GameShell
      title="Orb Weaver"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="orb-weaver-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="orb-weaver-canvas" />
        {Array.from({ length: SPOKE_COUNT }, (_, i) => i).map((spokeIndex) => (
          <div
            key={spokeIndex}
            ref={(el) => {
              spokeMarkerRefs.current[spokeIndex] = el;
            }}
            className={styles.spokeMarker}
            data-testid={`orb-weaver-spoke-${spokeIndex}`}
            data-spoke-index={spokeIndex}
          />
        ))}
        <div className={styles.hud}>
          <span className={styles.combo} data-testid="orb-weaver-combo">
            COMBO {combo}
          </span>
          <div
            className={styles.integrityBar}
            data-testid="orb-weaver-integrity"
            data-integrity={integrity}
          >
            <div
              className={`${styles.integrityFill} ${isIntegrityDanger ? styles.integrityFillDanger : ""}`}
              style={{ width: `${integrityRatio * 100}%` }}
            />
          </div>
        </div>
        <div className={styles.hint}>
          中心に迫る虫を、糸が光る捕獲圏に入った瞬間にクリック/タップ(キーボードは1〜6)で弾いて捕まえよう。
          中心に到達すると糸が破れる。破れた糸は長押しで補修するまで捕獲不可。Space: 一時停止 / R:
          リセット
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="orb-weaver-gameover">
            <div className={styles.gameOverTitle}>巣が崩壊した</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="orb-weaver-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
