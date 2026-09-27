"use client";

import { Application, Graphics } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import { type GateColor, KAYAK_RADIUS, RapidsSlalomWorld, STARTING_LIVES } from "./engine/world";
import styles from "./RapidsSlalomGame.module.scss";

const KEY_STEER_SPEED = 640; // px/s。キーボードで操舵目標を動かす速さ
const WATER_STRIPE_SPACING = 46;
const WATER_STRIPE_COLOR = 0x1f5c78;

const GATE_COLORS = {
  green: 0x5be089,
  red: 0xff6b6b,
} as const satisfies Record<GateColor, number>;

const POLE_COLOR_RESOLVED_ALPHA = 0.35;
const KAYAK_COLOR = 0xffb454;
const KAYAK_OUTLINE_COLOR = 0x7a4b12;
const ROCK_COLOR = 0x6b6f76;
const ROCK_HIGHLIGHT_COLOR = 0x9aa0ac;

export function RapidsSlalomGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [lives, setLives] = useState(STARTING_LIVES);
  const [isBracing, setIsBracing] = useState(false);
  const [nextGateColor, setNextGateColor] = useState<GateColor | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const kayakMarkerRef = useRef<HTMLDivElement | null>(null);
  const nextGateMarkerRef = useRef<HTMLDivElement | null>(null);
  const nextRockMarkerRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<RapidsSlalomWorld | null>(null);
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

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    let disposed = false;

    const app = new Application();
    const world = new RapidsSlalomWorld(1, 1);
    worldRef.current = world;

    const waterGraphics = new Graphics();
    const gateGraphics = new Graphics();
    const rockGraphics = new Graphics();
    const kayakGraphics = new Graphics();

    let draggingPointerId: number | null = null;
    let isPointerDown = false;

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x05141c,
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
      app.stage.addChild(waterGraphics, rockGraphics, gateGraphics, kayakGraphics);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds, elapsedSeconds) => {
        if (!isPointerDown) {
          let kx = 0;
          if (input.isKeyDown("arrowleft") || input.isKeyDown("a")) kx -= 1;
          if (input.isKeyDown("arrowright") || input.isKeyDown("d")) kx += 1;
          if (kx !== 0) {
            world.setSteerTarget(world.targetX + kx * KEY_STEER_SPEED * deltaSeconds);
          }
        }

        world.step(deltaSeconds);
        setScore(Math.floor(world.score));
        setCombo(world.combo);
        setLives(world.lives);
        setIsBracing(world.isBracing);
        setNextGateColor(world.nextGate?.color ?? null);
        if (world.isOver) setIsOver(true);

        const kayakY = world.kayakY;

        waterGraphics.clear();
        const stripeOffset = (elapsedSeconds * 90) % WATER_STRIPE_SPACING;
        for (
          let y = -WATER_STRIPE_SPACING + stripeOffset;
          y < world.height;
          y += WATER_STRIPE_SPACING
        ) {
          waterGraphics
            .moveTo(0, y)
            .lineTo(world.width, y)
            .stroke({ width: 2, color: WATER_STRIPE_COLOR, alpha: 0.35 });
        }

        gateGraphics.clear();
        for (const gate of world.gates) {
          const color = GATE_COLORS[gate.color];
          const alpha = gate.resolved ? POLE_COLOR_RESOLVED_ALPHA : 0.95;
          const leftX = gate.gapCenterX - gate.gapHalfWidth;
          const rightX = gate.gapCenterX + gate.gapHalfWidth;
          gateGraphics
            .circle(leftX, gate.y, gate.poleRadius)
            .fill({ color, alpha })
            .circle(rightX, gate.y, gate.poleRadius)
            .fill({ color, alpha });
          if (!gate.resolved) {
            gateGraphics
              .moveTo(leftX, gate.y)
              .lineTo(rightX, gate.y)
              .stroke({ width: 2, color, alpha: 0.3 });
          }
        }

        rockGraphics.clear();
        for (const rock of world.rocks) {
          rockGraphics
            .circle(rock.x, rock.y, rock.radius)
            .fill({ color: ROCK_COLOR, alpha: 0.95 })
            .circle(rock.x - rock.radius * 0.3, rock.y - rock.radius * 0.3, rock.radius * 0.35)
            .fill({ color: ROCK_HIGHLIGHT_COLOR, alpha: 0.5 });
        }

        const tilt = Math.max(-1, Math.min(1, world.kayak.vx / 520)) * 0.35;
        kayakGraphics.clear();
        kayakGraphics.setStrokeStyle({ width: 2, color: KAYAK_OUTLINE_COLOR });
        kayakGraphics
          .ellipse(0, 0, KAYAK_RADIUS * 0.65, KAYAK_RADIUS * 1.3)
          .fill({ color: KAYAK_COLOR })
          .stroke();
        kayakGraphics.position.set(world.kayak.x, kayakY);
        kayakGraphics.rotation = tilt;

        if (kayakMarkerRef.current) {
          kayakMarkerRef.current.style.left = `${world.kayak.x}px`;
          kayakMarkerRef.current.style.top = `${kayakY}px`;
        }
        const nextGate = world.nextGate;
        if (nextGateMarkerRef.current) {
          if (nextGate) {
            nextGateMarkerRef.current.style.left = `${nextGate.gapCenterX}px`;
            nextGateMarkerRef.current.style.top = `${nextGate.y}px`;
            nextGateMarkerRef.current.style.display = "block";
          } else {
            nextGateMarkerRef.current.style.display = "none";
          }
        }
        const nextRock = world.rocks.find((rock) => !rock.resolved);
        if (nextRockMarkerRef.current) {
          if (nextRock) {
            nextRockMarkerRef.current.style.left = `${nextRock.x}px`;
            nextRockMarkerRef.current.style.top = `${nextRock.y}px`;
            nextRockMarkerRef.current.style.display = "block";
          } else {
            nextRockMarkerRef.current.style.display = "none";
          }
        }
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => {
          if (draggingPointerId !== null) return;
          draggingPointerId = pointer.id;
          isPointerDown = true;
          world.setSteerTarget(pointer.x);
          world.brace();
        },
        onPointerMove: (pointer) => {
          if (pointer.id !== draggingPointerId) return;
          world.setSteerTarget(pointer.x);
        },
        onPointerUp: (pointer) => {
          if (pointer.id !== draggingPointerId) return;
          draggingPointerId = null;
          isPointerDown = false;
        },
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
          } else if (key === "r") {
            world.reset();
            setIsOver(false);
          } else if (key === "enter") {
            world.brace();
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
      title="Rapids Slalom"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="rapids-slalom-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="rapids-slalom-canvas" />
        <div
          ref={kayakMarkerRef}
          className={styles.kayakMarker}
          data-testid="rapids-slalom-kayak-marker"
        />
        <div
          ref={nextGateMarkerRef}
          className={styles.gateMarker}
          data-testid="rapids-slalom-next-gate-marker"
        />
        <div
          ref={nextRockMarkerRef}
          className={styles.rockMarker}
          data-testid="rapids-slalom-next-rock-marker"
        />
        <div className={styles.hud}>
          <span className={styles.combo} data-testid="rapids-slalom-combo">
            COMBO {combo}
          </span>
          <span className={styles.lives} data-testid="rapids-slalom-lives">
            {"🛶".repeat(Math.max(0, lives))}
            {"·".repeat(Math.max(0, STARTING_LIVES - lives))}
          </span>
          <span
            className={`${styles.nextGate} ${nextGateColor === "red" ? styles.nextGateRed : ""}`}
            data-testid="rapids-slalom-next-gate-color"
          >
            次のゲート:{" "}
            {nextGateColor === "red" ? "赤(ブレース)" : nextGateColor === "green" ? "緑" : "-"}
          </span>
          {isBracing && (
            <span className={styles.braceFlash} data-testid="rapids-slalom-bracing">
              ブレース中!
            </span>
          )}
        </div>
        <div className={styles.hint}>
          ドラッグ/タップした位置へ操舵。緑ゲートはそのまま、赤ゲートはブレース(タップ/クリック/Enter)しながら通過。灰色の岩は避けよう。
          矢印キー/AD: 操舵 / Enter: ブレース / Space: 一時停止 / R: リセット
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="rapids-slalom-gameover">
            <div className={styles.gameOverTitle}>転覆した</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="rapids-slalom-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
