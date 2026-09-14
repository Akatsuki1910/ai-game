"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import styles from "./CloseHauledGame.module.scss";
import {
  BOAT_RADIUS,
  type BuoyCapturedEvent,
  CloseHauledWorld,
  NO_GO_RAD,
  ROUND_SECONDS,
} from "./engine/world";

interface FloatingScore {
  text: Text;
  age: number;
}

const POPUP_LIFETIME = 0.9;
const WIND_MARKER_RADIUS = 34;
const WIND_MARKER_MARGIN = 50;

export function CloseHauledGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(ROUND_SECONDS);
  const [buoysCollected, setBuoysCollected] = useState(0);
  const [leg, setLeg] = useState(1);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<CloseHauledWorld | null>(null);
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
    const world = new CloseHauledWorld(1, 1);
    worldRef.current = world;

    const waveGraphics = new Graphics();
    const noGoGraphics = new Graphics();
    const wakeGraphics = new Graphics();
    const buoyGraphics = new Graphics();
    const windMarkerGraphics = new Graphics();
    const boatContainer = new Container();
    const boatGraphics = new Graphics();
    boatContainer.addChild(boatGraphics);
    boatGraphics
      .moveTo(BOAT_RADIUS * 1.6, 0)
      .lineTo(-BOAT_RADIUS, BOAT_RADIUS)
      .lineTo(-BOAT_RADIUS * 0.4, 0)
      .lineTo(-BOAT_RADIUS, -BOAT_RADIUS)
      .closePath()
      .fill({ color: 0xf2f3f5 })
      .stroke({ width: 2, color: 0x6ee7ff, alpha: 0.9 });

    const popupContainer = new Container();
    const floatingScores: FloatingScore[] = [];
    let elapsedTime = 0;

    world.onBuoyCaptured = ({ buoy, points, leg: capturedLeg }: BuoyCapturedEvent) => {
      const label = `+${points} LEG ${capturedLeg}`;
      const text = new Text({
        text: label,
        style: { fill: 0xffe066, fontSize: 18, fontWeight: "700" },
      });
      text.anchor.set(0.5, 1);
      text.position.set(buoy.x, buoy.y - buoy.radius);
      popupContainer.addChild(text);
      floatingScores.push({ text, age: 0 });
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x040a12,
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
        waveGraphics,
        noGoGraphics,
        wakeGraphics,
        buoyGraphics,
        boatContainer,
        windMarkerGraphics,
        popupContainer,
      );
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        if (input.isKeyDown("arrowleft") || input.isKeyDown("a")) {
          world.steerByKey(-1, deltaSeconds);
        }
        if (input.isKeyDown("arrowright") || input.isKeyDown("d")) {
          world.steerByKey(1, deltaSeconds);
        }

        world.step(deltaSeconds);
        elapsedTime += deltaSeconds;

        setScore(Math.floor(world.score));
        setTimeRemaining(Math.ceil(world.timeRemaining));
        setBuoysCollected(world.buoysCollected);
        setLeg(world.leg);
        if (world.isOver) setIsOver(true);

        // 海面の波（見た目の演出兼、無操作でも画面が動いていることの保証）
        waveGraphics.clear();
        const waveSpacing = 46;
        for (let y = -waveSpacing; y < world.height + waveSpacing; y += waveSpacing) {
          waveGraphics.moveTo(0, y);
          for (let x = 0; x <= world.width; x += 24) {
            const wobble = Math.sin(x * 0.02 + elapsedTime * 1.4 + y * 0.05) * 5;
            waveGraphics.lineTo(x, y + wobble);
          }
          waveGraphics.stroke({ width: 1, color: 0x1f3a52, alpha: 0.5 });
        }

        // ノーゴーゾーン（船を中心に、風上方向へ伸びる扇形）
        noGoGraphics.clear();
        noGoGraphics
          .moveTo(world.boatX, world.boatY)
          .arc(
            world.boatX,
            world.boatY,
            80,
            world.windFromAngle - NO_GO_RAD,
            world.windFromAngle + NO_GO_RAD,
          )
          .closePath()
          .fill({ color: 0xff6b6b, alpha: 0.12 });

        // 航跡
        wakeGraphics.clear();
        for (const point of world.wake) {
          const t = 1 - point.age / 2.2;
          wakeGraphics
            .circle(point.x, point.y, 2 + t * 2)
            .fill({ color: 0x9aa0ac, alpha: t * 0.5 });
        }

        // ブイ（脈動させて見つけやすくする）
        buoyGraphics.clear();
        const pulse = 0.85 + Math.sin(elapsedTime * 4) * 0.15;
        buoyGraphics
          .circle(world.activeBuoy.x, world.activeBuoy.y, world.activeBuoy.radius * pulse)
          .fill({ color: 0xffb454, alpha: 0.9 })
          .stroke({ width: 2, color: 0xffffff, alpha: 0.7 });
        buoyGraphics
          .circle(world.activeBuoy.x, world.activeBuoy.y, world.activeBuoy.radius + 10)
          .stroke({ width: 2, color: 0xffb454, alpha: 0.25 });

        // 船
        boatContainer.position.set(world.boatX, world.boatY);
        boatContainer.rotation = world.boatHeading;

        // 風向きインジケータ（画面左上に固定表示、常に揺れて動く）
        windMarkerGraphics.clear();
        const markerX = WIND_MARKER_MARGIN;
        const markerY = WIND_MARKER_MARGIN;
        windMarkerGraphics
          .circle(markerX, markerY, WIND_MARKER_RADIUS)
          .fill({ color: 0x14161d, alpha: 0.55 })
          .stroke({ width: 1, color: 0x2b2f3a });
        const towardAngle = world.windFromAngle + Math.PI;
        const tipX = markerX + Math.cos(towardAngle) * WIND_MARKER_RADIUS * 0.8;
        const tipY = markerY + Math.sin(towardAngle) * WIND_MARKER_RADIUS * 0.8;
        const tailX = markerX - Math.cos(towardAngle) * WIND_MARKER_RADIUS * 0.8;
        const tailY = markerY - Math.sin(towardAngle) * WIND_MARKER_RADIUS * 0.8;
        windMarkerGraphics
          .moveTo(tailX, tailY)
          .lineTo(tipX, tipY)
          .stroke({ width: 3, color: 0x6ee7ff });
        windMarkerGraphics
          .moveTo(tipX, tipY)
          .lineTo(tipX - Math.cos(towardAngle - 0.5) * 10, tipY - Math.sin(towardAngle - 0.5) * 10)
          .lineTo(tipX - Math.cos(towardAngle + 0.5) * 10, tipY - Math.sin(towardAngle + 0.5) * 10)
          .closePath()
          .fill({ color: 0x6ee7ff });

        // 加点ポップアップ
        for (let i = floatingScores.length - 1; i >= 0; i--) {
          const entry = floatingScores[i];
          entry.age += deltaSeconds;
          entry.text.position.y -= deltaSeconds * 28;
          entry.text.alpha = Math.max(0, 1 - entry.age / POPUP_LIFETIME);
          if (entry.age >= POPUP_LIFETIME) {
            popupContainer.removeChild(entry.text);
            entry.text.destroy();
            floatingScores.splice(i, 1);
          }
        }
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => {
          world.setTargetHeadingTowards(pointer.x, pointer.y);
        },
        onPointerMove: (pointer) => {
          world.setTargetHeadingTowards(pointer.x, pointer.y);
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
      title="Close Hauled"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="close-hauled-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="close-hauled-canvas" />
        <div className={styles.hud}>
          <span className={styles.timer} data-testid="close-hauled-timer">
            ⏱ {timeRemaining}s
          </span>
          <span className={styles.legInfo} data-testid="close-hauled-leg">
            BUOY {buoysCollected} / LEG {leg}
          </span>
        </div>
        <div className={styles.hint}>
          タップ/ドラッグで進みたい方角を指す（離しても針路は維持）。矢印キー/A・D:
          舵を切る。赤い扇形（風上のノーゴーゾーン）を避けてジグザグに風上のブイを目指せ。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="close-hauled-gameover">
            <div className={styles.gameOverTitle}>タイムアップ</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="close-hauled-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
