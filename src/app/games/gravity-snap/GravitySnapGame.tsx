"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import {
  type Direction,
  directionFromPoint,
  GravitySnapWorld,
  type OrbCollectedEvent,
  START_LIVES,
} from "./engine/world";
import styles from "./GravitySnapGame.module.scss";

const DIRECTION_LABELS = {
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
} as const satisfies Record<Direction, string>;

const KEY_TO_DIRECTION = {
  arrowup: "up",
  w: "up",
  arrowdown: "down",
  s: "down",
  arrowleft: "left",
  a: "left",
  arrowright: "right",
  d: "right",
} as const satisfies Record<string, Direction>;

interface FloatingPopup {
  text: Text;
  age: number;
}

interface TrailPoint {
  x: number;
  y: number;
}

const POPUP_LIFETIME = 0.7;
const TRAIL_LENGTH = 14;
const BALL_COLOR = 0xffe066;
const ORB_COLOR = 0x7cf5c4;
const HAZARD_COLOR = 0xff6b6b;
const EDGE_GLOW_COLOR = 0x6ee7ff;
const ARENA_BORDER_COLOR = 0x2b2f3a;

export function GravitySnapGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(START_LIVES);
  const [direction, setDirection] = useState<Direction>("down");
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<GravitySnapWorld | null>(null);
  const appRef = useRef<Application | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);

  const handleTogglePause = useCallback(() => {
    if (!loopRef.current) return;
    setIsPaused(loopRef.current.togglePause());
  }, []);

  const handleRestart = useCallback(() => {
    worldRef.current?.reset();
    setDirection("down");
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
    const world = new GravitySnapWorld(1, 1);
    worldRef.current = world;

    const backgroundGraphics = new Graphics();
    const edgeGraphics = new Graphics();
    const hazardGraphics = new Graphics();
    const orbGraphics = new Graphics();
    const trailGraphics = new Graphics();
    const ballGraphics = new Graphics();
    const popupContainer = new Container();
    const floatingPopups: FloatingPopup[] = [];
    const trail: TrailPoint[] = [];
    let drawnWidth = -1;
    let drawnHeight = -1;

    world.onOrbCollected = ({ x, y }: OrbCollectedEvent) => {
      const text = new Text({
        text: "+1",
        style: { fill: 0x7cf5c4, fontSize: 18, fontWeight: "700" },
      });
      text.anchor.set(0.5, 1);
      text.position.set(x, y - 10);
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
        backgroundGraphics,
        edgeGraphics,
        hazardGraphics,
        orbGraphics,
        trailGraphics,
        ballGraphics,
        popupContainer,
      );
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const applyDirection = (next: Direction) => {
        world.setDirection(next);
        setDirection((prev) => (prev === next ? prev : next));
      };

      const loop = new GameLoop((deltaSeconds, elapsedSeconds) => {
        world.step(deltaSeconds);
        setScore(world.score);
        setLives(world.lives);
        if (world.isOver) setIsOver(true);

        if (drawnWidth !== world.width || drawnHeight !== world.height) {
          drawnWidth = world.width;
          drawnHeight = world.height;
          backgroundGraphics
            .clear()
            .rect(0, 0, world.width, world.height)
            .stroke({ width: 2, color: ARENA_BORDER_COLOR, alpha: 0.8 });
        }

        edgeGraphics.clear();
        const edgeThickness = 6;
        if (world.direction === "down") {
          edgeGraphics
            .rect(0, world.height - edgeThickness, world.width, edgeThickness)
            .fill({ color: EDGE_GLOW_COLOR, alpha: 0.7 });
        } else if (world.direction === "up") {
          edgeGraphics
            .rect(0, 0, world.width, edgeThickness)
            .fill({ color: EDGE_GLOW_COLOR, alpha: 0.7 });
        } else if (world.direction === "left") {
          edgeGraphics
            .rect(0, 0, edgeThickness, world.height)
            .fill({ color: EDGE_GLOW_COLOR, alpha: 0.7 });
        } else {
          edgeGraphics
            .rect(world.width - edgeThickness, 0, edgeThickness, world.height)
            .fill({ color: EDGE_GLOW_COLOR, alpha: 0.7 });
        }

        hazardGraphics.clear();
        for (const hazard of world.hazards) {
          hazardGraphics
            .star(hazard.x, hazard.y, 7, hazard.radius, hazard.radius * 0.55, elapsedSeconds * 0.6)
            .fill({ color: HAZARD_COLOR, alpha: 0.85 })
            .stroke({ width: 1.5, color: 0x05060a, alpha: 0.6 });
        }

        const orbPulse = 1 + Math.sin(elapsedSeconds * 6) * 0.08;
        orbGraphics
          .clear()
          .circle(world.orb.x, world.orb.y, world.orb.radius * 1.8 * orbPulse)
          .stroke({ width: 2, color: ORB_COLOR, alpha: 0.3 })
          .circle(world.orb.x, world.orb.y, world.orb.radius * orbPulse)
          .fill({ color: ORB_COLOR, alpha: 0.9 });

        trail.push({ x: world.ball.x, y: world.ball.y });
        if (trail.length > TRAIL_LENGTH) trail.shift();
        trailGraphics.clear();
        trail.forEach((point, index) => {
          const t = (index + 1) / trail.length;
          trailGraphics
            .circle(point.x, point.y, world.ball.radius * 0.6 * t)
            .fill({ color: BALL_COLOR, alpha: 0.18 * t });
        });

        const isFlickering =
          world.invincibleRemaining > 0 && Math.floor(elapsedSeconds * 20) % 2 === 0;
        ballGraphics
          .clear()
          .circle(world.ball.x, world.ball.y, world.ball.radius)
          .fill({ color: BALL_COLOR, alpha: isFlickering ? 0.35 : 0.95 })
          .stroke({ width: 2, color: 0xffffff, alpha: 0.6 });

        for (let i = floatingPopups.length - 1; i >= 0; i--) {
          const entry = floatingPopups[i];
          entry.age += deltaSeconds;
          entry.text.position.y -= deltaSeconds * 26;
          entry.text.alpha = Math.max(0, 1 - entry.age / POPUP_LIFETIME);
          if (entry.age >= POPUP_LIFETIME) {
            popupContainer.removeChild(entry.text);
            entry.text.destroy();
            floatingPopups.splice(i, 1);
          }
        }
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => {
          applyDirection(
            directionFromPoint(pointer.x, pointer.y, world.width / 2, world.height / 2),
          );
        },
        onPointerMove: (pointer) => {
          applyDirection(
            directionFromPoint(pointer.x, pointer.y, world.width / 2, world.height / 2),
          );
        },
        onKeyDown: (key) => {
          const mapped = KEY_TO_DIRECTION[key as keyof typeof KEY_TO_DIRECTION];
          if (mapped) {
            applyDirection(mapped);
          } else if (key === " ") {
            setIsPaused(loop.togglePause());
          } else if (key === "r") {
            world.reset();
            setDirection("down");
            setIsOver(false);
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
      title="Gravity Snap"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="gravity-snap-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="gravity-snap-canvas" />
        <div className={styles.hud}>
          <span className={styles.lives} data-testid="gravity-snap-lives">
            ♥ {lives}
          </span>
          <span className={styles.direction} data-testid="gravity-snap-direction">
            {DIRECTION_LABELS[direction]}
          </span>
        </div>
        <div className={styles.hint}>
          キャンバスの上下左右をタップ/クリック（矢印キー/WASDでも可）して重力の向きを切り替え、
          常に引かれ続けるボールを操って緑の的を追い続けろ。赤いハザードに触れるとライフが減る。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="gravity-snap-gameover">
            <div className={styles.gameOverTitle}>ライフが尽きた</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="gravity-snap-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
