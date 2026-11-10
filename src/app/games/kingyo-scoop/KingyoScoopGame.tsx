"use client";

import { Application, Graphics } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import { CATCH_TIME, KingyoScoopWorld, START_DURABILITY } from "./engine/world";
import styles from "./KingyoScoopGame.module.scss";

const POI_KEY_SPEED = 620; // px/s
const WATER_COLOR = 0x1c4f6b;
const WATER_SURFACE_COLOR = 0x2f7ea8;
const FISH_BODY_COLOR = 0xff6a3d;
const FISH_BODY_DARK_COLOR = 0xd94a1f;
const FISH_TAIL_COLOR = 0xffb199;
const POI_FRAME_COLOR = 0x7a4a23;
const CATCH_RING_COLOR = 0xfff07c;

function durabilityToColor(ratio: number): number {
  const from = { r: 0x6b, g: 0x4a, b: 0x33 };
  const to = { r: 0xff, g: 0xf6, b: 0xe3 };
  const r = Math.round(from.r + (to.r - from.r) * ratio);
  const g = Math.round(from.g + (to.g - from.g) * ratio);
  const b = Math.round(from.b + (to.b - from.b) * ratio);
  return (r << 16) | (g << 8) | b;
}

export function KingyoScoopGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [durability, setDurability] = useState(START_DURABILITY);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<KingyoScoopWorld | null>(null);
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
    setScore(0);
    setDurability(START_DURABILITY);
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
    const world = new KingyoScoopWorld(1, 1);
    worldRef.current = world;

    const waterGraphics = new Graphics();
    const fishGraphics = new Graphics();
    const poiGraphics = new Graphics();
    let drawnWaterWidth = -1;
    let drawnWaterHeight = -1;
    let isPointerDown = false;

    world.onCatch = ({ score: currentScore }) => {
      setScore(currentScore);
    };
    world.onBreak = () => {
      setIsOver(true);
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: WATER_COLOR,
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
      app.stage.addChild(waterGraphics, fishGraphics, poiGraphics);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        let dx = 0;
        let dy = 0;
        if (input.isKeyDown("arrowleft") || input.isKeyDown("a")) dx -= 1;
        if (input.isKeyDown("arrowright") || input.isKeyDown("d")) dx += 1;
        if (input.isKeyDown("arrowup") || input.isKeyDown("w")) dy -= 1;
        if (input.isKeyDown("arrowdown") || input.isKeyDown("s")) dy += 1;
        if (dx !== 0 || dy !== 0) {
          world.movePoiBy(dx * POI_KEY_SPEED * deltaSeconds, dy * POI_KEY_SPEED * deltaSeconds);
        }

        world.setDipped(isPointerDown || input.isKeyDown(" "));
        world.step(deltaSeconds);
        setDurability(world.poi.durability);
        if (world.isOver) setIsOver(true);

        if (drawnWaterWidth !== world.width || drawnWaterHeight !== world.height) {
          drawnWaterWidth = world.width;
          drawnWaterHeight = world.height;
          waterGraphics
            .clear()
            .rect(0, 0, world.width, world.height)
            .fill({ color: WATER_COLOR })
            .rect(0, 0, world.width, world.height * 0.12)
            .fill({ color: WATER_SURFACE_COLOR, alpha: 0.35 });
        }

        fishGraphics.clear();
        for (const fish of world.fish) {
          const tailAngle = Math.atan2(fish.vy, fish.vx) + Math.PI;
          const tailBaseX = fish.x + Math.cos(tailAngle) * fish.radius * 0.7;
          const tailBaseY = fish.y + Math.sin(tailAngle) * fish.radius * 0.7;
          const tailSpread = tailAngle + Math.PI / 2;
          const tailTipX = fish.x + Math.cos(tailAngle) * fish.radius * 1.9;
          const tailTipY = fish.y + Math.sin(tailAngle) * fish.radius * 1.9;

          fishGraphics
            .moveTo(
              tailBaseX + Math.cos(tailSpread) * fish.radius * 0.5,
              tailBaseY + Math.sin(tailSpread) * fish.radius * 0.5,
            )
            .lineTo(tailTipX, tailTipY)
            .lineTo(
              tailBaseX - Math.cos(tailSpread) * fish.radius * 0.5,
              tailBaseY - Math.sin(tailSpread) * fish.radius * 0.5,
            )
            .closePath()
            .fill({ color: FISH_TAIL_COLOR, alpha: 0.9 });

          fishGraphics
            .ellipse(fish.x, fish.y, fish.radius, fish.radius * 0.68)
            .fill({ color: FISH_BODY_COLOR })
            .stroke({ width: 2, color: FISH_BODY_DARK_COLOR });

          const eyeAngle = Math.atan2(fish.vy, fish.vx);
          fishGraphics
            .circle(
              fish.x + Math.cos(eyeAngle) * fish.radius * 0.55,
              fish.y + Math.sin(eyeAngle) * fish.radius * 0.3,
              fish.radius * 0.12,
            )
            .fill({ color: 0x1a1a1a });
        }

        const { poi } = world;
        const durabilityRatio = poi.durability / START_DURABILITY;
        poiGraphics.clear();
        poiGraphics
          .moveTo(poi.x, poi.y + poi.radius * 0.6)
          .lineTo(poi.x, poi.y + poi.radius * 2.1)
          .stroke({ width: 7, color: POI_FRAME_COLOR });
        poiGraphics.circle(poi.x, poi.y, poi.radius).stroke({ width: 5, color: POI_FRAME_COLOR });
        poiGraphics
          .circle(poi.x, poi.y, poi.radius * 0.82)
          .fill({ color: durabilityToColor(durabilityRatio), alpha: 0.55 + durabilityRatio * 0.3 });

        if (world.catchProgress > 0) {
          const progressRatio = Math.min(1, world.catchProgress / CATCH_TIME);
          poiGraphics
            .arc(
              poi.x,
              poi.y,
              poi.radius + 6,
              -Math.PI / 2,
              -Math.PI / 2 + Math.PI * 2 * progressRatio,
            )
            .stroke({ width: 4, color: CATCH_RING_COLOR });
        }
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => {
          isPointerDown = true;
          world.setPoiPosition(pointer.x, pointer.y);
        },
        onPointerMove: (pointer) => {
          world.setPoiPosition(pointer.x, pointer.y);
        },
        onPointerUp: () => {
          isPointerDown = false;
        },
        onKeyDown: (key) => {
          if (key === "p") {
            setIsPaused(loop.togglePause());
          } else if (key === "r") {
            world.reset();
            setIsOver(false);
            setScore(0);
            setDurability(START_DURABILITY);
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

  const durabilityPercent = Math.round((durability / START_DURABILITY) * 100);

  return (
    <GameShell
      title="Kingyo Scoop"
      score={score}
      scoreLabel="すくった数"
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="kingyo-scoop-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="kingyo-scoop-canvas" />
        <div className={styles.hud}>
          <div className={styles.durabilityLabel}>ポイの耐久度</div>
          <div className={styles.durabilityBar}>
            <div
              className={styles.durabilityFill}
              style={{ width: `${durabilityPercent}%` }}
              data-testid="kingyo-scoop-durability-fill"
            />
          </div>
          <span className={styles.durabilityValue} data-testid="kingyo-scoop-durability">
            {durabilityPercent}%
          </span>
        </div>
        <div className={styles.hint}>
          ドラッグ/長押しでポイを水に浸け、金魚に重ねたまま動かさず待つとすくえる。浸けている時間と動かす速さに応じてポイが傷み、耐久度が尽きると破れる。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="kingyo-scoop-gameover">
            <div className={styles.gameOverTitle}>ポイが破れた!</div>
            <div className={styles.gameOverScore}>
              すくった金魚 {score.toLocaleString("ja-JP")}匹
            </div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="kingyo-scoop-restart"
            >
              新しいポイでもう一度
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
