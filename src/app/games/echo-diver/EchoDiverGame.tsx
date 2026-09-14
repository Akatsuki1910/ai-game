"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import styles from "./EchoDiverGame.module.scss";
import { EchoDiverWorld, MAX_CHARGES, PING_LIFETIME } from "./engine/world";

const COLOR_BG = 0x020308;
const COLOR_BOUNDARY = 0x1c2c3a;
const COLOR_SUB = 0xd8f4ff;
const COLOR_SUB_NOSE = 0xffffff;
const COLOR_ROCK = 0x263447;
const COLOR_ROCK_EDGE = 0x46597a;
const COLOR_PEARL = 0xffe066;
const COLOR_LEVIATHAN = 0xff5470;
const COLOR_LEVIATHAN_EDGE = 0xffc2cc;
const COLOR_PING_RING = 0x6ee7ff;

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

const PING_KEYS = new Set(["e", "enter"]);
const TAP_MAX_DIST_PX = 14;

interface FloatingLabel {
  text: Text;
  age: number;
  lifetime: number;
}

function drawSubShape(g: Graphics, radius: number): void {
  g.clear();
  g.ellipse(0, 0, radius * 1.2, radius * 0.72)
    .fill({ color: COLOR_SUB, alpha: 0.95 })
    .stroke({ width: 1.5, color: 0xffffff, alpha: 0.35 });
  g.circle(radius * 0.85, 0, radius * 0.3).fill({ color: COLOR_SUB_NOSE, alpha: 0.6 });
  g.moveTo(-radius * 1.1, 0)
    .lineTo(-radius * 1.6, radius * 0.55)
    .lineTo(-radius * 1.6, -radius * 0.55)
    .closePath()
    .fill({ color: COLOR_SUB, alpha: 0.85 });
}

function drawLeviathanShape(g: Graphics, radius: number): void {
  g.clear();
  g.moveTo(radius * 1.5, 0)
    .lineTo(radius * 0.4, radius * 0.95)
    .lineTo(-radius * 1.0, radius * 0.6)
    .lineTo(-radius * 1.6, 0)
    .lineTo(-radius * 1.0, -radius * 0.6)
    .lineTo(radius * 0.4, -radius * 0.95)
    .closePath()
    .fill({ color: COLOR_LEVIATHAN, alpha: 0.92 })
    .stroke({ width: 1.5, color: COLOR_LEVIATHAN_EDGE, alpha: 0.55 });
  g.circle(radius * 0.55, 0, radius * 0.18).fill({ color: 0xfff2f2, alpha: 0.9 });
}

function drawRockShape(g: Graphics, radius: number): void {
  g.clear();
  g.circle(0, 0, radius)
    .fill({ color: COLOR_ROCK, alpha: 0.96 })
    .stroke({ width: 2, color: COLOR_ROCK_EDGE, alpha: 0.5 });
}

function drawPearlShape(g: Graphics, radius: number): void {
  g.clear();
  g.circle(0, 0, radius * 2).fill({ color: COLOR_PEARL, alpha: 0.16 });
  g.circle(0, 0, radius)
    .fill({ color: COLOR_PEARL, alpha: 0.95 })
    .stroke({ width: 1, color: 0xffffff, alpha: 0.6 });
}

export function EchoDiverGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const dangerRef = useRef<HTMLDivElement | null>(null);

  const worldRef = useRef<EchoDiverWorld | null>(null);
  const appRef = useRef<Application | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);

  const [score, setScore] = useState(0);
  const [pearlsCollected, setPearlsCollected] = useState(0);
  const [charges, setCharges] = useState(MAX_CHARGES);
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
    const world = new EchoDiverWorld(1, 1);
    worldRef.current = world;

    const boundaryGraphics = new Graphics();
    const rockContainer = new Container();
    let rockGraphics: Graphics[] = [];
    let drawnLayoutVersion = -1;
    const pearlContainer = new Container();
    const pearlGraphics: Graphics[] = [];
    const pingGraphics = new Graphics();
    const leviathanGraphics = new Graphics();
    const subGraphics = new Graphics();
    const popupContainer = new Container();
    const floatingLabels: FloatingLabel[] = [];
    const heldKeys = new Set<string>();
    let activePointerId: number | null = null;

    const spawnLabel = (text: string, color: number, x: number, y: number) => {
      const label = new Text({ text, style: { fill: color, fontSize: 18, fontWeight: "700" } });
      label.anchor.set(0.5, 1);
      label.position.set(x, y);
      popupContainer.addChild(label);
      floatingLabels.push({ text: label, age: 0, lifetime: 0.9 });
    };

    world.onPearlCollected = ({ x, y, points }) => {
      spawnLabel(`+${points}`, COLOR_PEARL, world.offsetX + x, world.offsetY + y - 14);
    };
    world.onCaught = () => {
      spawnLabel(
        "CAUGHT",
        COLOR_LEVIATHAN,
        world.offsetX + world.arenaSize / 2,
        world.offsetY + world.arenaSize / 2 - 20,
      );
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

    const ensurePearlGraphics = () => {
      while (pearlGraphics.length < world.pearls.length) {
        const g = new Graphics();
        drawPearlShape(g, world.pearlRadius);
        pearlContainer.addChild(g);
        pearlGraphics.push(g);
      }
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: COLOR_BG,
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
        boundaryGraphics,
        rockContainer,
        pearlContainer,
        pingGraphics,
        leviathanGraphics,
        subGraphics,
        popupContainer,
      );
      appRef.current = app;
      ensurePearlGraphics();

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds, elapsedSeconds) => {
        world.step(deltaSeconds);
        setScore(Math.floor(world.score));
        setPearlsCollected(world.pearlsCollected);
        setCharges(world.charges);
        if (world.isOver) setIsOver(true);

        if (drawnLayoutVersion !== world.layoutVersion) {
          drawnLayoutVersion = world.layoutVersion;
          for (const g of rockGraphics) g.destroy();
          rockGraphics = world.rocks.map((rock) => {
            const g = new Graphics();
            drawRockShape(g, rock.r);
            rockContainer.addChild(g);
            return g;
          });
        }

        boundaryGraphics.clear();
        boundaryGraphics
          .rect(world.offsetX, world.offsetY, world.arenaSize, world.arenaSize)
          .stroke({
            width: 1.5,
            color: COLOR_BOUNDARY,
            alpha: 0.4 + 0.15 * Math.sin(elapsedSeconds * 1.6),
          });

        for (let i = 0; i < rockGraphics.length; i++) {
          const rock = world.rocks[i];
          const g = rockGraphics[i];
          const vis = world.visibilityAt(rock.x, rock.y);
          g.position.set(world.offsetX + rock.x, world.offsetY + rock.y);
          g.alpha = vis;
          g.visible = vis > 0.02;
        }

        ensurePearlGraphics();
        for (let i = 0; i < world.pearls.length; i++) {
          const pearl = world.pearls[i];
          const g = pearlGraphics[i];
          const vis = world.visibilityAt(pearl.x, pearl.y);
          const pulse = 1 + 0.1 * Math.sin(elapsedSeconds * 3 + i);
          g.position.set(world.offsetX + pearl.x, world.offsetY + pearl.y);
          g.scale.set(pulse);
          g.alpha = vis;
          g.visible = vis > 0.02;
        }

        pingGraphics.clear();
        for (const ping of world.pings) {
          const radius = ping.age * world.pingSpeed;
          const alpha = Math.max(0, 1 - ping.age / PING_LIFETIME) * 0.85;
          pingGraphics
            .circle(world.offsetX + ping.x, world.offsetY + ping.y, radius)
            .stroke({ width: 2.5, color: COLOR_PING_RING, alpha });
        }

        const levVis = world.visibilityAt(world.leviathan.x, world.leviathan.y);
        leviathanGraphics.position.set(
          world.offsetX + world.leviathan.x,
          world.offsetY + world.leviathan.y,
        );
        leviathanGraphics.rotation = world.leviathan.angle;
        leviathanGraphics.alpha = levVis;
        leviathanGraphics.visible = levVis > 0.03;

        if (dangerRef.current) {
          const distToLeviathan = Math.hypot(
            world.leviathan.x - world.sub.x,
            world.leviathan.y - world.sub.y,
          );
          const proximity =
            levVis > 0.03
              ? 0
              : Math.max(0, 1 - distToLeviathan / (world.leviathanSenseRadius * 2.4));
          dangerRef.current.style.opacity = String(proximity * 0.55);
        }

        subGraphics.position.set(world.offsetX + world.sub.x, world.offsetY + world.sub.y);
        subGraphics.rotation = world.sub.angle;
        subGraphics.scale.set(1 + 0.035 * Math.sin(elapsedSeconds * 3.2));

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

      drawSubShape(subGraphics, world.subRadius);
      drawLeviathanShape(leviathanGraphics, world.leviathanRadius);

      const tryPing = () => {
        world.triggerPing();
      };

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
          const dist = Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY);
          if (dist < TAP_MAX_DIST_PX) {
            tryPing();
          }
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
          if (PING_KEYS.has(key)) {
            tryPing();
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

  return (
    <GameShell
      title="Echo Diver"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="echo-diver-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="echo-diver-canvas" />
        <div ref={dangerRef} className={styles.dangerVignette} />
        <div className={styles.hud}>
          <span className={styles.chip} data-testid="echo-diver-pearls">
            真珠 {pearlsCollected}
          </span>
          <span className={styles.chip} data-testid="echo-diver-sonar">
            ソナー {"●".repeat(charges)}
            {"○".repeat(Math.max(0, MAX_CHARGES - charges))}
          </span>
        </div>
        <div className={styles.hint}>
          ドラッグ/長押しした方向へ潜水艇が推進。タップ（PC: クリック / キーボード:
          E）でソナーを発信し周囲を一瞬照らす。ただしソナーは怪物レビヤタンをその場所へ引き寄せる。矢印キー/WASDでも操作可。Space:
          一時停止 / R: リセット
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="echo-diver-gameover">
            <div className={styles.gameOverTitle}>レビヤタンに捕まった…</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="echo-diver-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
