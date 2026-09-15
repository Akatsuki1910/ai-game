"use client";

import { Application, Graphics } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import styles from "./DandelionGaleGame.module.scss";
import { DandelionGaleWorld, SEED_RADIUS, STARTING_LIVES } from "./engine/world";

const KEY_FAN_OFFSET = 60; // px。キーボード操作時、種の反対側に仮想ファンを置く距離
const SEED_COLOR = 0xf2f3f5;
const SEED_FLUFF_COLOR = 0xdfe6ee;
const TARGET_COLOR = 0xff8fd0;
const RAINDROP_COLOR = 0x6ee7ff;
const FAN_COLOR = 0x9aa0ac;

export function DandelionGaleGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [lives, setLives] = useState(STARTING_LIVES);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const targetMarkerRef = useRef<HTMLDivElement | null>(null);
  const seedMarkerRef = useRef<HTMLDivElement | null>(null);
  const raindropMarkerRef = useRef<HTMLDivElement | null>(null);
  const raindropMarker2Ref = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<DandelionGaleWorld | null>(null);
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
    const world = new DandelionGaleWorld(1, 1);
    worldRef.current = world;

    const targetGraphics = new Graphics();
    const raindropGraphics = new Graphics();
    const seedGraphics = new Graphics();
    const fanGraphics = new Graphics();

    let draggingPointerId: number | null = null;
    let isPointerDown = false;
    let pointerX = 0;
    let pointerY = 0;

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x0d1a12,
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
      app.stage.addChild(targetGraphics, raindropGraphics, fanGraphics, seedGraphics);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        let fanDrivenByPointer = false;
        if (isPointerDown) {
          world.setFanPosition(pointerX, pointerY);
          world.setFanActive(true);
          fanDrivenByPointer = true;
        }

        if (!fanDrivenByPointer) {
          let kx = 0;
          let ky = 0;
          if (input.isKeyDown("arrowleft") || input.isKeyDown("a")) kx -= 1;
          if (input.isKeyDown("arrowright") || input.isKeyDown("d")) kx += 1;
          if (input.isKeyDown("arrowup") || input.isKeyDown("w")) ky -= 1;
          if (input.isKeyDown("arrowdown") || input.isKeyDown("s")) ky += 1;

          if (kx !== 0 || ky !== 0) {
            const length = Math.hypot(kx, ky) || 1;
            world.setFanPosition(
              world.seed.x - (kx / length) * KEY_FAN_OFFSET,
              world.seed.y - (ky / length) * KEY_FAN_OFFSET,
            );
            world.setFanActive(true);
          } else {
            world.setFanActive(false);
          }
        }

        world.step(deltaSeconds);
        setScore(Math.floor(world.score));
        setCombo(world.combo);
        setLives(world.lives);
        if (world.isOver) setIsOver(true);

        const pulse = 0.5 + Math.sin(performance.now() / 260) * 0.2;
        targetGraphics
          .clear()
          .circle(world.target.x, world.target.y, world.target.radius)
          .stroke({ width: 3, color: TARGET_COLOR, alpha: pulse })
          .circle(world.target.x, world.target.y, 5)
          .fill({ color: TARGET_COLOR, alpha: 0.9 });

        raindropGraphics.clear();
        for (const raindrop of world.raindrops) {
          if (!raindrop.isActive) continue;
          raindropGraphics
            .circle(raindrop.x, raindrop.y, raindrop.radius)
            .fill({ color: RAINDROP_COLOR, alpha: 0.85 });
        }

        seedGraphics.clear();
        seedGraphics
          .circle(world.seed.x, world.seed.y, SEED_RADIUS * 1.7)
          .fill({ color: SEED_FLUFF_COLOR, alpha: 0.25 });
        seedGraphics.circle(world.seed.x, world.seed.y, SEED_RADIUS).fill({
          color: SEED_COLOR,
          alpha: 0.95,
        });

        fanGraphics.clear();
        if (world.fan.isActive) {
          fanGraphics
            .circle(world.fan.x, world.fan.y, 14)
            .stroke({ width: 2, color: FAN_COLOR, alpha: 0.7 });
        }

        // canvas座標とCSS座標が一致するため、DOM要素のgetBoundingClientRectで
        // 各要素の実座標をそのまま特定でき、精密な操作とストーリーテストの両方に使える。
        if (targetMarkerRef.current) {
          targetMarkerRef.current.style.left = `${world.target.x}px`;
          targetMarkerRef.current.style.top = `${world.target.y}px`;
        }
        if (seedMarkerRef.current) {
          seedMarkerRef.current.style.left = `${world.seed.x}px`;
          seedMarkerRef.current.style.top = `${world.seed.y}px`;
        }
        const firstRaindrop = world.raindrops[0];
        if (raindropMarkerRef.current && firstRaindrop) {
          raindropMarkerRef.current.style.left = `${firstRaindrop.x}px`;
          raindropMarkerRef.current.style.top = `${firstRaindrop.y}px`;
          raindropMarkerRef.current.style.display = firstRaindrop.isActive ? "block" : "none";
        }
        const secondRaindrop = world.raindrops[1];
        if (raindropMarker2Ref.current && secondRaindrop) {
          raindropMarker2Ref.current.style.left = `${secondRaindrop.x}px`;
          raindropMarker2Ref.current.style.top = `${secondRaindrop.y}px`;
          raindropMarker2Ref.current.style.display = secondRaindrop.isActive ? "block" : "none";
        }
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => {
          if (draggingPointerId !== null) return;
          draggingPointerId = pointer.id;
          isPointerDown = true;
          pointerX = pointer.x;
          pointerY = pointer.y;
        },
        onPointerMove: (pointer) => {
          if (pointer.id !== draggingPointerId) return;
          pointerX = pointer.x;
          pointerY = pointer.y;
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
      title="Dandelion Gale"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="dandelion-gale-stage">
        <div
          ref={canvasHostRef}
          className={styles.canvasHost}
          data-testid="dandelion-gale-canvas"
        />
        <div
          ref={targetMarkerRef}
          className={styles.targetMarker}
          data-testid="dandelion-gale-target-marker"
        />
        <div
          ref={seedMarkerRef}
          className={styles.seedMarker}
          data-testid="dandelion-gale-seed-marker"
        />
        <div
          ref={raindropMarkerRef}
          className={styles.raindropMarker}
          data-testid="dandelion-gale-raindrop-marker"
        />
        <div
          ref={raindropMarker2Ref}
          className={styles.raindropMarker}
          data-testid="dandelion-gale-raindrop-marker-2"
        />
        <div className={styles.hud}>
          <span className={styles.combo} data-testid="dandelion-gale-combo">
            COMBO {combo}
          </span>
          <span className={styles.lives} data-testid="dandelion-gale-lives">
            {"🌱".repeat(Math.max(0, lives))}
            {"·".repeat(Math.max(0, STARTING_LIVES - lives))}
          </span>
        </div>
        <div className={styles.hint}>
          ドラッグ/長押しした位置から風が吹き、種が反対側へ押される。花畑(ピンクの輪)へ種を届けよう。
          雨粒(水色)に当たるとライフが減る。矢印キー/WASDでも操作可能。Space: 一時停止 / R: リセット
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="dandelion-gale-gameover">
            <div className={styles.gameOverTitle}>種が尽きた</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="dandelion-gale-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
