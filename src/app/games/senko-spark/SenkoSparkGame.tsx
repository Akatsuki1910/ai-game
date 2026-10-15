"use client";

import { Application, BlurFilter, Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import { SenkoSparkWorld, type SparkCaughtEvent, STABILITY_MAX } from "./engine/world";
import styles from "./SenkoSparkGame.module.scss";

const HAND_KEY_SPEED = 220; // px/秒。キーボードで持ち手を動かす速さ(速すぎると揺れやすくなる)
const TAP_MAX_DRAG_DISTANCE = 6;
const EMBER_CORE_RADIUS = 6;
const EMBER_GLOW_RADIUS = 22;
const SPARK_RADIUS = 5;
const POPUP_LIFETIME = 0.8;

interface FloatingScore {
  text: Text;
  age: number;
}

function getStabilityColor(stabilityPercent: number): string {
  if (stabilityPercent < 30) return "#ff6b6b";
  if (stabilityPercent < 60) return "#ffb454";
  return "#7cf5c4";
}

export function SenkoSparkGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [stability, setStability] = useState(STABILITY_MAX);
  const [sparksCaught, setSparksCaught] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const emberMarkerRef = useRef<HTMLDivElement | null>(null);
  const sparkMarkerRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<SenkoSparkWorld | null>(null);
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
    const world = new SenkoSparkWorld(1, 1);
    worldRef.current = world;

    const sparkGraphics = new Graphics();
    const threadGraphics = new Graphics();
    const handGraphics = new Graphics();

    const emberContainer = new Container();
    const emberGlow = new Graphics()
      .circle(0, 0, EMBER_GLOW_RADIUS)
      .fill({ color: 0xffb454, alpha: 0.5 });
    emberGlow.filters = [new BlurFilter({ strength: 10 })];
    emberGlow.blendMode = "add";
    const emberCore = new Graphics()
      .circle(0, 0, EMBER_CORE_RADIUS)
      .fill({ color: 0xfff2cc, alpha: 0.95 });
    emberContainer.addChild(emberGlow, emberCore);

    const popupHost = new Container();
    const floatingScores: FloatingScore[] = [];
    let elapsedTime = 0;

    let draggingPointerId: number | null = null;
    let isPointerDown = false;
    let pointerX = 0;
    let pointerY = 0;

    world.onSparkCaught = ({ points }: SparkCaughtEvent) => {
      const text = new Text({
        text: `+${points}`,
        style: { fill: 0xffe066, fontSize: 18, fontWeight: "700" },
      });
      text.anchor.set(0.5, 1);
      text.position.set(world.emberX, world.emberY - 20);
      popupHost.addChild(text);
      floatingScores.push({ text, age: 0 });
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x0b0c10,
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
      app.stage.addChild(sparkGraphics, threadGraphics, handGraphics, emberContainer, popupHost);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        if (isPointerDown) {
          world.setHandPosition(pointerX, pointerY);
        } else {
          let kx = 0;
          let ky = 0;
          if (input.isKeyDown("arrowleft") || input.isKeyDown("a")) kx -= 1;
          if (input.isKeyDown("arrowright") || input.isKeyDown("d")) kx += 1;
          if (input.isKeyDown("arrowup") || input.isKeyDown("w")) ky -= 1;
          if (input.isKeyDown("arrowdown") || input.isKeyDown("s")) ky += 1;
          if (kx !== 0 || ky !== 0) {
            const length = Math.hypot(kx, ky) || 1;
            world.moveHandBy(
              (kx / length) * HAND_KEY_SPEED * deltaSeconds,
              (ky / length) * HAND_KEY_SPEED * deltaSeconds,
            );
          }
        }

        world.step(deltaSeconds);
        elapsedTime += deltaSeconds;

        setScore(Math.floor(world.score));
        setStability(world.stability);
        setSparksCaught(world.sparksCaught);
        if (world.isOver) setIsOver(true);

        const stabilityRatio = world.stability / STABILITY_MAX;
        const dangerPulse = 0.6 + Math.sin(elapsedTime * 6) * 0.4;
        const isDanger = stabilityRatio < 0.3;

        threadGraphics
          .clear()
          .moveTo(world.handX, world.handY)
          .lineTo(world.emberX, world.emberY)
          .stroke({
            width: 2,
            color: isDanger ? 0xff6b6b : 0xffb454,
            alpha: isDanger ? 0.4 + dangerPulse * 0.4 : 0.6,
          });

        handGraphics
          .clear()
          .circle(world.handX, world.handY, 10)
          .stroke({ width: 2, color: 0xf2f3f5, alpha: 0.7 })
          .circle(world.handX, world.handY, 2.5)
          .fill({ color: 0xf2f3f5, alpha: 0.9 });

        emberContainer.position.set(world.emberX, world.emberY);
        const emberScale = isDanger ? 0.75 + dangerPulse * 0.35 : 1;
        emberContainer.scale.set(emberScale);
        emberGlow.tint = isDanger ? 0xff6b6b : 0xffb454;

        sparkGraphics.clear();
        for (const spark of world.sparks) {
          const bob = Math.sin(elapsedTime * 2.4 + spark.bobPhase) * 4;
          const lifeRatio = 1 - spark.age / 4.5;
          sparkGraphics
            .circle(spark.x, spark.y + bob, SPARK_RADIUS)
            .fill({ color: 0x6ee7ff, alpha: Math.max(0.25, lifeRatio) });
        }

        // canvas座標とCSS座標が一致するため、火球・火花の現在位置をDOM要素のgetBoundingClientRect
        // でそのまま取得できるようにしておく。精密な操作の目印とストーリーテストの両方に使える。
        if (emberMarkerRef.current) {
          emberMarkerRef.current.style.left = `${world.emberX}px`;
          emberMarkerRef.current.style.top = `${world.emberY}px`;
        }
        if (sparkMarkerRef.current) {
          const nearestSpark = world.sparks[0];
          if (nearestSpark) {
            sparkMarkerRef.current.style.left = `${nearestSpark.x}px`;
            sparkMarkerRef.current.style.top = `${nearestSpark.y}px`;
            sparkMarkerRef.current.style.display = "block";
          } else {
            sparkMarkerRef.current.style.display = "none";
          }
        }

        for (let i = floatingScores.length - 1; i >= 0; i--) {
          const entry = floatingScores[i];
          entry.age += deltaSeconds;
          entry.text.position.y -= deltaSeconds * 30;
          entry.text.alpha = Math.max(0, 1 - entry.age / POPUP_LIFETIME);
          if (entry.age >= POPUP_LIFETIME) {
            popupHost.removeChild(entry.text);
            entry.text.destroy();
            floatingScores.splice(i, 1);
          }
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
          const dragDistance = Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY);
          if (dragDistance < TAP_MAX_DRAG_DISTANCE) world.requestFlick();
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
            world.requestFlick();
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

  const stabilityPercent = Math.round((stability / STABILITY_MAX) * 100);
  const stabilityColor = getStabilityColor(stabilityPercent);

  return (
    <GameShell
      title="Senko Spark"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="senko-spark-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="senko-spark-canvas" />
        <div
          ref={emberMarkerRef}
          className={styles.emberMarker}
          data-testid="senko-spark-ember-marker"
        />
        <div
          ref={sparkMarkerRef}
          className={styles.sparkMarker}
          data-testid="senko-spark-spark-marker"
        />
        <div className={styles.hud}>
          <span className={styles.sparks} data-testid="senko-spark-count">
            火花 {sparksCaught}
          </span>
          <div className={styles.stabilityTrack} data-testid="senko-spark-stability">
            <div
              className={styles.stabilityFill}
              data-testid="senko-spark-stability-fill"
              style={{ width: `${stabilityPercent}%`, backgroundColor: stabilityColor }}
            />
          </div>
        </div>
        <div className={styles.hint}>
          ドラッグ/長押しで持ち手をそっと動かし、火球を揺らさずに持ち続けよう。動かさずにタップ(またはEnter)すると近くの火花を掬えるが、掬う反動にも注意。
          キーボードは矢印キー/WASDで移動 / Space: 一時停止 / R: リセット。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="senko-spark-gameover">
            <div className={styles.gameOverTitle}>消えた…</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <div className={styles.gameOverSub}>火花 {sparksCaught}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="senko-spark-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
