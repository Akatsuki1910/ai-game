"use client";

import { Application, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import styles from "./BubbleGardenGame.module.scss";
import {
  BUBBLE_RADIUS_BY_SIZE,
  BubbleGardenWorld,
  type BubbleSize,
  START_VITALITY,
  sizeForCharge,
} from "./engine/world";

const SIZE_COLOR: Record<BubbleSize, number> = {
  small: 0x6ee7ff,
  medium: 0x7cf5c4,
  large: 0xffb454,
};
const SIZE_LABEL: Record<BubbleSize, string> = { small: "小", medium: "中", large: "大" };
const HAZARD_COLOR = 0xff6b6b;
const WAND_COLOR = 0x9aa0ac;
const PERFECT_LABEL_COLOR = 0xffe066;

const STEER_KEYS: Record<string, -1 | 1> = {
  arrowleft: -1,
  a: -1,
  arrowright: 1,
  d: 1,
};
const CHARGE_KEY = "enter";

interface FloatingLabel {
  text: Text;
  age: number;
  lifetime: number;
}

function drawChargingBubble(
  g: Graphics,
  x: number,
  y: number,
  radius: number,
  color: number,
): void {
  g.clear();
  if (radius <= 0) return;
  g.circle(x, y, radius).fill({ color, alpha: 0.35 }).stroke({ width: 2, color, alpha: 0.75 });
}

function drawFlyingBubble(g: Graphics, x: number, y: number, radius: number, color: number): void {
  g.clear();
  g.circle(x, y, radius).fill({ color, alpha: 0.28 }).stroke({ width: 2.5, color, alpha: 0.9 });
  g.circle(x - radius * 0.35, y - radius * 0.35, radius * 0.3).fill({
    color: 0xffffff,
    alpha: 0.5,
  });
}

function drawWand(g: Graphics, x: number, y: number, size: number): void {
  g.clear();
  g.moveTo(x, y + size * 1.6)
    .lineTo(x, y)
    .stroke({ width: size * 0.4, color: WAND_COLOR, alpha: 0.9 });
  g.circle(x, y, size * 0.8)
    .fill({ color: WAND_COLOR, alpha: 0.2 })
    .stroke({ width: 2, color: WAND_COLOR, alpha: 0.6 });
}

function drawFlower(
  g: Graphics,
  x: number,
  y: number,
  bandHalfWidthPx: number,
  flowerRadius: number,
  color: number,
): void {
  g.clear();
  g.roundRect(
    x - bandHalfWidthPx,
    y - flowerRadius * 1.4,
    bandHalfWidthPx * 2,
    flowerRadius * 2.8,
    10,
  ).fill({
    color,
    alpha: 0.12,
  });
  const petalCount = 6;
  for (let i = 0; i < petalCount; i++) {
    const angle = (i / petalCount) * Math.PI * 2;
    g.circle(
      x + Math.cos(angle) * flowerRadius * 0.9,
      y + Math.sin(angle) * flowerRadius * 0.9,
      flowerRadius * 0.55,
    ).fill({ color, alpha: 0.7 });
  }
  g.circle(x, y, flowerRadius * 0.6).fill({ color: 0xfff6d8, alpha: 0.95 });
}

function drawHazard(g: Graphics, x: number, y: number, radius: number): void {
  g.clear();
  g.ellipse(x, y, radius * 1.3, radius).fill({ color: HAZARD_COLOR, alpha: 0.9 });
  g.ellipse(x - radius * 0.3, y - radius * 1.1, radius * 0.75, radius * 0.4).fill({
    color: HAZARD_COLOR,
    alpha: 0.35,
  });
  g.ellipse(x - radius * 0.3, y + radius * 1.1, radius * 0.75, radius * 0.4).fill({
    color: HAZARD_COLOR,
    alpha: 0.35,
  });
}

export function BubbleGardenGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [vitality, setVitality] = useState(START_VITALITY);
  const [combo, setCombo] = useState(0);
  const [bloomed, setBloomed] = useState(0);
  const [charge, setCharge] = useState(0);
  const [isCharging, setIsCharging] = useState(false);
  const [bubbleSize, setBubbleSize] = useState<BubbleSize | null>(null);
  const [bubbleX, setBubbleX] = useState<number | null>(null);
  const [targetSize, setTargetSize] = useState<BubbleSize>("medium");
  const [targetX, setTargetX] = useState(0.5);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<BubbleGardenWorld | null>(null);
  const appRef = useRef<Application | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  const heldKeysRef = useRef(new Set<string>());

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

  const handleStartCharging = useCallback(() => {
    if (loopRef.current?.isPaused) return;
    worldRef.current?.startCharging();
  }, []);

  const handleReleaseBubble = useCallback(() => {
    if (loopRef.current?.isPaused) return;
    worldRef.current?.releaseBubble();
  }, []);

  const handleSetSteer = useCallback((direction: -1 | 0 | 1) => {
    if (loopRef.current?.isPaused) return;
    worldRef.current?.setSteerKey(direction);
  }, []);

  const recomputeKeySteer = useCallback(() => {
    let direction: -1 | 0 | 1 = 0;
    for (const key of heldKeysRef.current) {
      const mapped = STEER_KEYS[key];
      if (mapped) direction = (direction + mapped) as -1 | 0 | 1;
    }
    handleSetSteer(direction);
  }, [handleSetSteer]);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    let disposed = false;

    const app = new Application();
    const world = new BubbleGardenWorld();
    worldRef.current = world;

    const windGraphics = new Graphics();
    const hazardGraphics = new Graphics();
    const flowerGraphics = new Graphics();
    const wandGraphics = new Graphics();
    const chargingGraphics = new Graphics();
    const bubbleGraphics = new Graphics();
    const floatingLabels: FloatingLabel[] = [];

    const spawnLabel = (text: string, color: number, xNorm: number, yNorm: number) => {
      const { width, height } = sizeRef.current;
      const label = new Text({ text, style: { fill: color, fontSize: 18, fontWeight: "700" } });
      label.anchor.set(0.5, 1);
      label.position.set(xNorm * width, yNorm * height - 12);
      app.stage.addChild(label);
      floatingLabels.push({ text: label, age: 0, lifetime: 1.0 });
    };

    world.onFlowerMatched = ({ size: matchedSize, isPerfect, points }) => {
      spawnLabel(
        isPerfect ? `PERFECT +${points}` : `+${points}`,
        isPerfect ? PERFECT_LABEL_COLOR : SIZE_COLOR[matchedSize],
        world.target.x,
        0.16,
      );
    };
    world.onBubbleLost = ({ reason }) => {
      const label =
        reason === "hazard" ? "虫に邪魔された" : reason === "overcharge" ? "暴発!" : "ミス";
      spawnLabel(label, HAZARD_COLOR, world.wandPosition.x, 0.5);
    };
    world.onGardenWilted = () => {
      setIsOver(true);
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x0d1a14,
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
        windGraphics,
        flowerGraphics,
        hazardGraphics,
        wandGraphics,
        chargingGraphics,
        bubbleGraphics,
      );
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        world.step(deltaSeconds);

        setScore(world.score);
        setVitality(world.vitality);
        setCombo(world.combo);
        setBloomed(world.bloomed);
        setCharge(world.charge);
        setIsCharging(world.isCharging);
        setBubbleSize(world.bubble?.size ?? null);
        setBubbleX(world.bubble?.x ?? null);
        setTargetSize(world.target.size);
        setTargetX(world.target.x);

        for (let i = floatingLabels.length - 1; i >= 0; i--) {
          const label = floatingLabels[i];
          label.age += deltaSeconds;
          label.text.position.y -= deltaSeconds * 26;
          label.text.alpha = Math.max(0, 1 - label.age / label.lifetime);
          if (label.age >= label.lifetime) {
            label.text.destroy();
            floatingLabels.splice(i, 1);
          }
        }

        const { width, height } = sizeRef.current;
        if (width <= 0 || height <= 0) return;

        const minSide = Math.min(width, height);

        windGraphics.clear();
        const windAccel = world.windAccel;
        const windStrength = Math.min(1, Math.abs(windAccel) / 0.9);
        if (windStrength > 0.02) {
          const arrowY = height * 0.5;
          const arrowX = windAccel > 0 ? width * 0.08 : width * 0.92;
          const dir = windAccel > 0 ? 1 : -1;
          windGraphics
            .moveTo(arrowX - dir * 14, arrowY - 10)
            .lineTo(arrowX + dir * 14, arrowY)
            .lineTo(arrowX - dir * 14, arrowY + 10)
            .closePath()
            .fill({ color: 0xbfe9ff, alpha: 0.25 + windStrength * 0.5 });
        }

        drawHazard(
          hazardGraphics,
          world.hazard.x * width,
          world.hazard.y * height,
          world.hazard.radius * minSide,
        );

        const flowerRadius = Math.max(16, minSide * 0.05);
        drawFlower(
          flowerGraphics,
          world.target.x * width,
          world.target.y * height,
          world.target.bandHalfWidth * width,
          flowerRadius,
          SIZE_COLOR[world.target.size],
        );

        const wand = world.wandPosition;
        drawWand(wandGraphics, wand.x * width, wand.y * height, Math.max(10, minSide * 0.03));

        if (world.isCharging) {
          const previewSize = sizeForCharge(world.charge);
          const previewRadius =
            minSide * (0.018 + BUBBLE_RADIUS_BY_SIZE[previewSize] * world.charge);
          const previewColor = world.charge >= 1 ? HAZARD_COLOR : 0xffffff;
          drawChargingBubble(
            chargingGraphics,
            wand.x * width,
            wand.y * height,
            previewRadius,
            previewColor,
          );
        } else {
          chargingGraphics.clear();
        }

        if (world.bubble) {
          drawFlyingBubble(
            bubbleGraphics,
            world.bubble.x * width,
            world.bubble.y * height,
            world.bubble.radius * minSide,
            SIZE_COLOR[world.bubble.size],
          );
        } else {
          bubbleGraphics.clear();
        }
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => {
          if (loop.isPaused) return;
          const { width } = sizeRef.current;
          if (width <= 0) return;
          if (world.bubble) {
            world.setPointerSteerTarget(pointer.x / width);
          } else {
            world.startCharging();
          }
        },
        onPointerMove: (pointer) => {
          if (loop.isPaused) return;
          const { width } = sizeRef.current;
          if (width <= 0 || !world.bubble) return;
          world.setPointerSteerTarget(pointer.x / width);
        },
        onPointerUp: () => {
          if (loop.isPaused) return;
          if (world.isCharging) world.releaseBubble();
          world.setPointerSteerTarget(null);
        },
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
          if (loop.isPaused) return;
          if (key === CHARGE_KEY) {
            world.startCharging();
            return;
          }
          if (key in STEER_KEYS) {
            heldKeysRef.current.add(key);
            recomputeKeySteer();
          }
        },
        onKeyUp: (key) => {
          if (loop.isPaused) return;
          if (key === CHARGE_KEY) {
            world.releaseBubble();
            return;
          }
          if (key in STEER_KEYS) {
            heldKeysRef.current.delete(key);
            recomputeKeySteer();
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
      for (const label of floatingLabels) label.text.destroy();
      if (appRef.current) {
        appRef.current.destroy(true, { children: true });
        appRef.current = null;
      }
    };
  }, [recomputeKeySteer]);

  useEffect(() => {
    sizeRef.current = { width: size.width, height: size.height };
  }, [size.width, size.height]);

  return (
    <GameShell
      title="Bubble Garden"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="bubble-garden-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="bubble-garden-canvas" />

        <div className={styles.topRow}>
          <div
            className={styles.vitalityBar}
            data-testid="bubble-garden-vitality"
            data-vitality={vitality}
          >
            <span className={styles.vitalityLabel}>元気</span>
            <div className={styles.vitalityTrack}>
              <div className={styles.vitalityFill} style={{ width: `${vitality}%` }} />
            </div>
          </div>
          <div
            className={styles.targetHint}
            data-testid="bubble-garden-target"
            data-size={targetSize}
            data-x={targetX}
          >
            次の花: {SIZE_LABEL[targetSize]}
          </div>
          <div
            className={styles.targetHint}
            data-testid="bubble-garden-bloomed"
            data-bloomed={bloomed}
          >
            開花 {bloomed}
          </div>
          {combo >= 2 && (
            <div className={styles.combo} data-testid="bubble-garden-combo">
              COMBO {combo}
            </div>
          )}
        </div>

        <div
          className={styles.bubbleHint}
          data-testid="bubble-garden-bubble"
          data-size={bubbleSize ?? ""}
          data-x={bubbleX ?? ""}
        >
          {bubbleSize ? `泡: ${SIZE_LABEL[bubbleSize]}` : "泡を育てて放とう"}
        </div>

        <div
          className={styles.chargeBar}
          data-testid="bubble-garden-charge"
          data-charge={charge}
          data-charging={isCharging ? "true" : "false"}
        >
          <div
            className={styles.chargeFill}
            style={{ width: `${charge * 100}%`, background: charge >= 1 ? "#ff6b6b" : "#6ee7ff" }}
          />
        </div>

        <div className={styles.hint}>
          押している間(長押し)で泡を育て、離すと放つ。短いほど小さく、粘るほど大きいが粘りすぎると暴発する。
          上昇中はドラッグ/矢印キーで風に流されないよう狙いを保ち、花と同じ大きさ・同じ位置へ届けよう。虫に触れると失敗。
          キーボードはEnter長押しで育てて放ち、←→・ADで狙いを調整。Space: 一時停止 / R: リセット。
        </div>

        <div className={styles.controlRow}>
          <button
            type="button"
            className={styles.steerButton}
            data-testid="bubble-garden-steer-left"
            onPointerDown={() => handleSetSteer(-1)}
            onPointerUp={() => handleSetSteer(0)}
            onPointerLeave={() => handleSetSteer(0)}
          >
            ◀
          </button>
          <button
            type="button"
            className={styles.blowButton}
            data-testid="bubble-garden-blow-button"
            onPointerDown={handleStartCharging}
            onPointerUp={handleReleaseBubble}
            onPointerLeave={handleReleaseBubble}
          >
            ふく
          </button>
          <button
            type="button"
            className={styles.steerButton}
            data-testid="bubble-garden-steer-right"
            onPointerDown={() => handleSetSteer(1)}
            onPointerUp={() => handleSetSteer(0)}
            onPointerLeave={() => handleSetSteer(0)}
          >
            ▶
          </button>
        </div>

        {isOver && (
          <div className={styles.gameOver} data-testid="bubble-garden-gameover">
            <div className={styles.gameOverTitle}>庭がしおれてしまった...</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <div className={styles.gameOverSub}>開花数 {bloomed}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="bubble-garden-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
