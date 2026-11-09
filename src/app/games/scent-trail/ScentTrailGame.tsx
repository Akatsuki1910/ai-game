"use client";

import { Application, Graphics } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import {
  COLONY_HEALTH_MAX,
  MAX_ANTS,
  PREDATOR_RADIUS,
  ScentTrailWorld,
  TRAIL_MAX_LIFE,
} from "./engine/world";
import styles from "./ScentTrailGame.module.scss";

const BRUSH_SPEED = 260; // px/秒。キーボード操作時のブラシ移動速度
const NEST_COLOR = 0x6ee7ff;
const ANT_COLOR = 0xd8d2c4;
const ANT_CARRYING_COLOR = 0xffb454;
const PREDATOR_COLOR = 0xff6b6b;
const FOOD_COLOR = 0x7cf5c4;
const TRAIL_COLOR = 0x9ad1ff;
const BRUSH_COLOR = 0xffffff;
const ANT_MARKER_INDICES = Array.from({ length: MAX_ANTS }, (_, i) => i);

export function ScentTrailGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [deliveries, setDeliveries] = useState(0);
  const [colonyHealth, setColonyHealth] = useState(COLONY_HEALTH_MAX);
  const [antCount, setAntCount] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const nestMarkerRef = useRef<HTMLDivElement | null>(null);
  const foodMarkerRef = useRef<HTMLDivElement | null>(null);
  const predatorMarkerRef = useRef<HTMLDivElement | null>(null);
  const antMarkerRefs = useRef<Array<HTMLDivElement | null>>([]);
  const worldRef = useRef<ScentTrailWorld | null>(null);
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
    const world = new ScentTrailWorld(1, 1);
    worldRef.current = world;

    const nestGraphics = new Graphics();
    const trailGraphics = new Graphics();
    const foodGraphics = new Graphics();
    const antGraphics = new Graphics();
    const predatorGraphics = new Graphics();
    const brushGraphics = new Graphics();

    let draggingPointerId: number | null = null;
    let isPointerPainting = false;
    let pointerX = 0;
    let pointerY = 0;
    let brushX = 0;
    let brushY = 0;

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x0a0c08,
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
        trailGraphics,
        nestGraphics,
        foodGraphics,
        antGraphics,
        predatorGraphics,
        brushGraphics,
      );
      appRef.current = app;
      brushX = world.nest.x;
      brushY = world.nest.y;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        let paintingByPointer = false;
        if (isPointerPainting) {
          world.setPaintTarget(pointerX, pointerY);
          world.setPainting(true);
          paintingByPointer = true;
        }

        if (!paintingByPointer) {
          let kx = 0;
          let ky = 0;
          if (input.isKeyDown("arrowleft") || input.isKeyDown("a")) kx -= 1;
          if (input.isKeyDown("arrowright") || input.isKeyDown("d")) kx += 1;
          if (input.isKeyDown("arrowup") || input.isKeyDown("w")) ky -= 1;
          if (input.isKeyDown("arrowdown") || input.isKeyDown("s")) ky += 1;
          if (kx !== 0 || ky !== 0) {
            const length = Math.hypot(kx, ky) || 1;
            brushX = Math.min(
              Math.max(brushX + (kx / length) * BRUSH_SPEED * deltaSeconds, 0),
              world.width,
            );
            brushY = Math.min(
              Math.max(brushY + (ky / length) * BRUSH_SPEED * deltaSeconds, 0),
              world.height,
            );
          }
          const isPaintingByKey = input.isKeyDown("enter");
          world.setPaintTarget(brushX, brushY);
          world.setPainting(isPaintingByKey);
        }

        world.step(deltaSeconds);
        setScore(world.score);
        setDeliveries(world.deliveries);
        setColonyHealth(world.colonyHealth);
        setAntCount(world.ants.length);
        if (world.isOver) setIsOver(true);

        trailGraphics.clear();
        for (const point of world.trail) {
          trailGraphics
            .circle(point.x, point.y, 4)
            .fill({ color: TRAIL_COLOR, alpha: Math.max(0, point.life / TRAIL_MAX_LIFE) * 0.5 });
        }

        const nestPulse = 0.35 + Math.sin(performance.now() / 500) * 0.12;
        nestGraphics
          .clear()
          .circle(world.nest.x, world.nest.y, world.nest.radius)
          .stroke({ width: 3, color: NEST_COLOR, alpha: nestPulse });

        foodGraphics
          .clear()
          .star(world.food.x, world.food.y, 5, 10, 4)
          .fill({ color: FOOD_COLOR, alpha: 0.95 });

        antGraphics.clear();
        for (const ant of world.ants) {
          antGraphics
            .circle(ant.x, ant.y, 7)
            .fill({ color: ant.isCarryingFood ? ANT_CARRYING_COLOR : ANT_COLOR, alpha: 0.95 });
        }

        predatorGraphics
          .clear()
          .circle(world.predator.x, world.predator.y, PREDATOR_RADIUS)
          .fill({ color: PREDATOR_COLOR, alpha: 0.85 })
          .circle(world.predator.x, world.predator.y, PREDATOR_RADIUS + 5)
          .stroke({ width: 2, color: PREDATOR_COLOR, alpha: 0.35 });

        const isBrushActive = !paintingByPointer && input.isKeyDown("enter");
        brushGraphics.clear();
        if (!paintingByPointer) {
          brushGraphics
            .circle(brushX, brushY, 10)
            .stroke({ width: 2, color: BRUSH_COLOR, alpha: isBrushActive ? 0.9 : 0.35 });
        }

        // canvas座標とCSS座標が一致するため、DOM要素のgetBoundingClientRectで
        // 各要素の実座標をそのまま特定でき、精密な操作とストーリーテストの両方に使える。
        if (nestMarkerRef.current) {
          nestMarkerRef.current.style.left = `${world.nest.x}px`;
          nestMarkerRef.current.style.top = `${world.nest.y}px`;
        }
        if (foodMarkerRef.current) {
          foodMarkerRef.current.style.left = `${world.food.x}px`;
          foodMarkerRef.current.style.top = `${world.food.y}px`;
        }
        if (predatorMarkerRef.current) {
          predatorMarkerRef.current.style.left = `${world.predator.x}px`;
          predatorMarkerRef.current.style.top = `${world.predator.y}px`;
        }
        for (let i = 0; i < MAX_ANTS; i++) {
          const marker = antMarkerRefs.current[i];
          if (!marker) continue;
          const ant = world.ants[i];
          if (ant) {
            marker.style.left = `${ant.x}px`;
            marker.style.top = `${ant.y}px`;
            marker.style.display = "block";
          } else {
            marker.style.display = "none";
          }
        }
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => {
          if (draggingPointerId !== null) return;
          draggingPointerId = pointer.id;
          isPointerPainting = true;
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
          isPointerPainting = false;
        },
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
          } else if (key === "r") {
            world.reset();
            setIsOver(false);
            brushX = world.nest.x;
            brushY = world.nest.y;
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
      title="Scent Trail"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="scent-trail-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="scent-trail-canvas" />
        <div
          ref={nestMarkerRef}
          className={styles.nestMarker}
          data-testid="scent-trail-nest-marker"
        />
        <div
          ref={foodMarkerRef}
          className={styles.foodMarker}
          data-testid="scent-trail-food-marker"
        />
        <div
          ref={predatorMarkerRef}
          className={styles.predatorMarker}
          data-testid="scent-trail-predator-marker"
        />
        {ANT_MARKER_INDICES.map((i) => (
          <div
            key={i}
            ref={(el) => {
              antMarkerRefs.current[i] = el;
            }}
            className={styles.antMarker}
            data-testid={`scent-trail-ant-marker-${i}`}
          />
        ))}
        <div className={styles.hud}>
          <span className={styles.deliveries} data-testid="scent-trail-deliveries">
            DELIVERIES {deliveries}
          </span>
          <span data-testid="scent-trail-ant-count" hidden>
            {antCount}
          </span>
          <div className={styles.healthBar} data-testid="scent-trail-health">
            <div
              className={styles.healthFill}
              style={{
                width: `${Math.max(0, Math.min(100, (colonyHealth / COLONY_HEALTH_MAX) * 100))}%`,
              }}
            />
          </div>
        </div>
        <div className={styles.hint}>
          ドラッグ/長押しでフェロモンの道を描くと、蟻(白)がその上を素早く進んで餌(緑の星)を巣(水色の輪)へ運ぶ。道は時間で消えるので描き直そう。捕食者(赤)に捕まった蟻はコロニーの体力を減らす。矢印キー/WASDでブラシを移動、Enter長押しで設置。Space:
          一時停止 / R: リセット
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="scent-trail-gameover">
            <div className={styles.gameOverTitle}>コロニー壊滅</div>
            <div className={styles.gameOverScore}>
              SCORE {Math.floor(score).toLocaleString("ja-JP")}
            </div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="scent-trail-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
