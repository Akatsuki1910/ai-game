"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import { KoiClimbWorld, type ObstacleKind, STAMINA_MAX } from "./engine/world";
import styles from "./KoiClimbGame.module.scss";

const COLOR_FLOW_LINE = 0x1c4a52;
const COLOR_KOI_BODY = 0xff7a45;
const COLOR_KOI_BELLY = 0xfff2e6;
const COLOR_KOI_SPOT = 0x8a2f1f;
const COLOR_ROCK = 0x5b5f6a;
const COLOR_ROCK_EDGE = 0x9096a6;
const COLOR_LOG = 0x8a5a2f;
const COLOR_LOG_EDGE = 0xd2a35f;
const COLOR_PEARL = 0xffe066;
const COLOR_DANGER = 0xff6b6b;

const MOVE_KEYS: Record<string, { dx: number; dy: number }> = {
  arrowup: { dx: 0, dy: -1 },
  arrowdown: { dx: 0, dy: 1 },
  arrowleft: { dx: -1, dy: 0 },
  arrowright: { dx: 1, dy: 0 },
  w: { dx: 0, dy: -1 },
  s: { dx: 0, dy: 1 },
  a: { dx: -1, dy: 0 },
  d: { dx: 1, dy: 0 },
};

const FLOW_LINE_COUNT = 6;

interface FloatingLabel {
  text: Text;
  age: number;
  lifetime: number;
}

function drawKoiShape(g: Graphics, radius: number): void {
  g.clear();
  g.ellipse(0, 0, radius * 1.3, radius * 0.75).fill({ color: COLOR_KOI_BODY, alpha: 0.95 });
  g.ellipse(radius * 0.1, radius * 0.28, radius * 1.05, radius * 0.32).fill({
    color: COLOR_KOI_BELLY,
    alpha: 0.55,
  });
  g.circle(-radius * 0.35, -radius * 0.15, radius * 0.22).fill({
    color: COLOR_KOI_SPOT,
    alpha: 0.75,
  });
  g.circle(radius * 0.25, radius * 0.2, radius * 0.16).fill({ color: COLOR_KOI_SPOT, alpha: 0.6 });
  g.moveTo(-radius * 1.15, 0)
    .lineTo(-radius * 1.85, radius * 0.6)
    .lineTo(-radius * 1.85, -radius * 0.6)
    .closePath()
    .fill({ color: COLOR_KOI_BODY, alpha: 0.85 });
  g.circle(radius * 0.95, -radius * 0.12, radius * 0.09).fill({ color: 0x1a0f0a, alpha: 0.9 });
}

export function KoiClimbGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const canvasHostRef = useRef<HTMLDivElement | null>(null);

  const worldRef = useRef<KoiClimbWorld | null>(null);
  const appRef = useRef<Application | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);

  const [score, setScore] = useState(0);
  const [distanceClimbed, setDistanceClimbed] = useState(0);
  const [stamina, setStamina] = useState(STAMINA_MAX);
  const [combo, setCombo] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

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

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    let disposed = false;

    const app = new Application();
    const world = new KoiClimbWorld(1, 1);
    worldRef.current = world;

    const flowGraphics = new Graphics();
    const obstacleGraphics = new Graphics();
    const pearlGraphics = new Graphics();
    const koiGraphics = new Graphics();
    const popupContainer = new Container();
    const floatingLabels: FloatingLabel[] = [];
    let drawnKoiRadius = -1;
    let activePointerId: number | null = null;
    const heldKeys = new Set<string>();

    const spawnLabel = (text: string, color: number, x: number, y: number) => {
      const label = new Text({ text, style: { fill: color, fontSize: 18, fontWeight: "700" } });
      label.anchor.set(0.5, 1);
      label.position.set(x, y);
      popupContainer.addChild(label);
      floatingLabels.push({ text: label, age: 0, lifetime: 0.9 });
    };

    world.onPearlCollected = ({ x, y, points, combo: comboValue }) => {
      const label = comboValue > 1 ? `+${points} COMBO x${comboValue}` : `+${points}`;
      spawnLabel(label, COLOR_PEARL, x, y - 14);
    };
    world.onObstacleHit = ({ x, y }) => {
      spawnLabel("-!", COLOR_DANGER, x, y - 14);
    };

    const applyMoveKeys = () => {
      let dx = 0;
      let dy = 0;
      for (const key of heldKeys) {
        const dir = MOVE_KEYS[key];
        if (!dir) continue;
        dx += dir.dx;
        dy += dir.dy;
      }
      world.setThrust(dx, dy);
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x061a1f,
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
        flowGraphics,
        obstacleGraphics,
        pearlGraphics,
        koiGraphics,
        popupContainer,
      );
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds, elapsedSeconds) => {
        world.step(deltaSeconds);
        setScore(Math.floor(world.score));
        setDistanceClimbed(Math.floor(world.distanceClimbed));
        setStamina(Math.round(world.stamina));
        setCombo(world.combo);
        if (world.isOver) setIsOver(true);

        flowGraphics.clear();
        const spacing = world.height > 0 ? world.height / FLOW_LINE_COUNT : 0;
        const cycle = spacing * (FLOW_LINE_COUNT + 1);
        for (let i = 0; i < FLOW_LINE_COUNT; i++) {
          const y = ((elapsedSeconds * world.currentSpeed + i * spacing) % cycle) - spacing;
          flowGraphics
            .moveTo(0, y)
            .lineTo(world.width, y)
            .stroke({ width: 2, color: COLOR_FLOW_LINE, alpha: 0.5 });
        }

        obstacleGraphics.clear();
        for (const obstacle of world.obstacles) {
          drawObstacleAt(obstacleGraphics, obstacle.kind, obstacle.x, obstacle.y, obstacle.radius);
        }

        pearlGraphics.clear();
        for (const pearl of world.pearls) {
          const pulse = 1 + 0.12 * Math.sin(elapsedSeconds * 3 + pearl.id);
          drawPearlAt(pearlGraphics, pearl.x, pearl.y, pearl.radius * pulse);
        }

        if (drawnKoiRadius !== world.koiRadius) {
          drawnKoiRadius = world.koiRadius;
          drawKoiShape(koiGraphics, world.koiRadius);
        }
        koiGraphics.position.set(world.koi.x, world.koi.y);
        koiGraphics.rotation = world.koi.angle;

        for (let i = floatingLabels.length - 1; i >= 0; i--) {
          const entry = floatingLabels[i];
          entry.age += deltaSeconds;
          entry.text.position.y -= deltaSeconds * 30;
          entry.text.alpha = Math.max(0, 1 - entry.age / entry.lifetime);
          if (entry.age >= entry.lifetime) {
            popupContainer.removeChild(entry.text);
            entry.text.destroy();
            floatingLabels.splice(i, 1);
          }
        }
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => {
          if (activePointerId !== null) return;
          activePointerId = pointer.id;
          world.setThrustTowardStagePoint(pointer.x, pointer.y);
        },
        onPointerMove: (pointer) => {
          if (pointer.id !== activePointerId) return;
          world.setThrustTowardStagePoint(pointer.x, pointer.y);
        },
        onPointerUp: (pointer) => {
          if (pointer.id !== activePointerId) return;
          activePointerId = null;
          world.setThrust(0, 0);
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
          if (key in MOVE_KEYS) {
            heldKeys.add(key);
            applyMoveKeys();
          }
        },
        onKeyUp: (key) => {
          if (key in MOVE_KEYS) {
            heldKeys.delete(key);
            applyMoveKeys();
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
    if (size.width === 0 || size.height === 0) return;
    worldRef.current?.resize(size.width, size.height);
  }, [size.width, size.height]);

  const staminaRatio = Math.max(0, Math.min(1, stamina / STAMINA_MAX));

  return (
    <GameShell
      title="Koi Climb"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="koi-climb-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="koi-climb-canvas" />
        <div className={styles.hud}>
          <div className={styles.staminaChip} data-testid="koi-climb-stamina">
            体力 {stamina}%
            <div className={styles.staminaTrack}>
              <div
                className={styles.staminaFill}
                style={{ width: `${staminaRatio * 100}%` }}
                data-danger={staminaRatio < 0.25}
              />
            </div>
          </div>
          <span className={styles.chip} data-testid="koi-climb-combo">
            コンボ x{combo}
          </span>
          <span className={styles.chip} data-testid="koi-climb-distance">
            {distanceClimbed}m 遡上
          </span>
        </div>
        <div className={styles.hint}>
          ドラッグ/長押しした位置へ鯉を誘導（矢印キー/WASDでも操作可）。岩・流木を避けて真珠を集め、体力を保ちながら滝を登り続けよう。流れは徐々に速くなる。Space:
          一時停止 / R: リセット
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="koi-climb-gameover">
            <div className={styles.gameOverTitle}>力尽きて押し流された…</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <div className={styles.gameOverDistance}>{distanceClimbed}m 遡上</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="koi-climb-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}

function drawObstacleAt(
  g: Graphics,
  kind: ObstacleKind,
  x: number,
  y: number,
  radius: number,
): void {
  if (kind === "rock") {
    g.circle(x, y, radius)
      .fill({ color: COLOR_ROCK, alpha: 0.95 })
      .stroke({ width: 2, color: COLOR_ROCK_EDGE, alpha: 0.5 });
  } else {
    g.roundRect(x - radius * 1.4, y - radius * 0.5, radius * 2.8, radius, radius * 0.5)
      .fill({ color: COLOR_LOG, alpha: 0.95 })
      .stroke({ width: 2, color: COLOR_LOG_EDGE, alpha: 0.5 });
  }
}

function drawPearlAt(g: Graphics, x: number, y: number, radius: number): void {
  g.circle(x, y, radius * 2.2).fill({ color: COLOR_PEARL, alpha: 0.15 });
  g.circle(x, y, radius)
    .fill({ color: COLOR_PEARL, alpha: 0.95 })
    .stroke({ width: 1, color: 0xffffff, alpha: 0.6 });
}
