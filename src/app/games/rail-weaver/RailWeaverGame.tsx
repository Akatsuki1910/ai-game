"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import { PLANK_STOCK_MAX, RailWeaverWorld, REACH_DISTANCE } from "./engine/world";
import styles from "./RailWeaverGame.module.scss";

const CART_X_RATIO = 0.22;
const TRACK_Y_RATIO = 0.56;
const EDGE_MARGIN = 28;
const VISIBLE_UNITS_AHEAD = 7.6;
const BEHIND_UNITS_VISIBLE = 1.4;
const GAP_WIDTH_UNITS = 0.9;

const SKY_COLOR = 0x16202c;
const CHASM_COLOR = 0x0a0c12;
const RAIL_COLOR = 0x7c6a52;
const CART_COLOR = 0xffb454;
const WHEEL_COLOR = 0x2b2f3a;
const PLANK_COLOR = 0x7cf5c4;
const REACH_ZONE_COLOR = 0x6ee7ff;
const WARNING_COLOR = 0xff6b6b;
const POPUP_LIFETIME = 0.9;

function cartPixelX(width: number): number {
  return width * CART_X_RATIO;
}

function trackPixelY(height: number): number {
  return height * TRACK_Y_RATIO;
}

function pxPerUnit(width: number): number {
  return Math.max(24, (width - cartPixelX(width) - EDGE_MARGIN) / VISIBLE_UNITS_AHEAD);
}

function gapPixelX(distanceAhead: number, width: number): number {
  return cartPixelX(width) + distanceAhead * pxPerUnit(width);
}

function railThickness(width: number, height: number): number {
  const shortest = Math.min(width, height);
  return Math.max(8, Math.min(18, shortest * 0.028));
}

interface FloatingPopup {
  text: Text;
  age: number;
}

export function RailWeaverGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [plankStock, setPlankStock] = useState(PLANK_STOCK_MAX);
  const [distanceMeters, setDistanceMeters] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const nextGapMarkerRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<RailWeaverWorld | null>(null);
  const appRef = useRef<Application | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const sizeRef = useRef({ width: 0, height: 0 });

  const handleTogglePause = useCallback(() => {
    if (!loopRef.current) return;
    setIsPaused(loopRef.current.togglePause());
  }, []);

  const handleRestart = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    world.reset();
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
    const world = new RailWeaverWorld();
    worldRef.current = world;

    const sceneGraphics = new Graphics();
    const popupHost = new Container();
    const floatingPopups: FloatingPopup[] = [];

    const spawnPopup = (label: string, color: number, x: number, y: number): void => {
      const text = new Text({
        text: label,
        style: { fill: color, fontSize: 18, fontWeight: "700" },
      });
      text.anchor.set(0.5, 0.5);
      text.position.set(x, y);
      popupHost.addChild(text);
      floatingPopups.push({ text, age: 0 });
    };

    const tryLayPlank = (): void => {
      if (loopRef.current?.isPaused) return;
      const { width, height } = sizeRef.current;
      if (width === 0 || height === 0) return;
      const scoreBefore = world.score;
      const result = world.layPlank();
      const popupX = cartPixelX(width) + pxPerUnit(width) * REACH_DISTANCE * 0.5;
      const popupY = trackPixelY(height) - 32;
      if (result === "filled") {
        spawnPopup(`+${world.score - scoreBefore}`, PLANK_COLOR, popupX, popupY);
      } else if (result === "no-stock") {
        spawnPopup("板切れ!", WARNING_COLOR, popupX, popupY);
      }
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: SKY_COLOR,
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
      app.stage.addChild(sceneGraphics, popupHost);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        world.step(deltaSeconds);

        setScore(world.score);
        setCombo(world.combo);
        setPlankStock(world.plankStock);
        setDistanceMeters(Math.floor(world.distance * 10));
        if (world.isOver) setIsOver(true);

        const { width, height } = sizeRef.current;
        if (width > 0 && height > 0) {
          const cartX = cartPixelX(width);
          const trackY = trackPixelY(height);
          const thickness = railThickness(width, height);
          const gapWidthPx = GAP_WIDTH_UNITS * pxPerUnit(width);
          const reachWidthPx = REACH_DISTANCE * pxPerUnit(width);

          sceneGraphics.clear();
          sceneGraphics.rect(0, 0, width, trackY).fill({ color: SKY_COLOR });
          sceneGraphics.rect(0, trackY, width, height - trackY).fill({ color: CHASM_COLOR });

          sceneGraphics
            .rect(cartX, trackY - thickness * 1.6, reachWidthPx, thickness * 3.2)
            .fill({ color: REACH_ZONE_COLOR, alpha: 0.12 });

          sceneGraphics
            .moveTo(0, trackY)
            .lineTo(width, trackY)
            .stroke({ width: thickness, color: RAIL_COLOR, alpha: 0.9 });

          const visibleGaps = world.gaps.filter(
            (gap) =>
              gap.distanceAhead >= -BEHIND_UNITS_VISIBLE &&
              gap.distanceAhead <= VISIBLE_UNITS_AHEAD + 1,
          );
          for (const gap of visibleGaps) {
            const gx = gapPixelX(gap.distanceAhead, width);
            if (gap.isFilled) {
              sceneGraphics
                .rect(gx - gapWidthPx / 2, trackY - thickness, gapWidthPx, thickness * 2)
                .fill({ color: PLANK_COLOR, alpha: 0.95 })
                .stroke({ width: 2, color: 0xffffff, alpha: 0.6 });
            } else {
              const isUrgent = gap.distanceAhead > 0 && gap.distanceAhead <= REACH_DISTANCE;
              sceneGraphics
                .rect(gx - gapWidthPx / 2, trackY - thickness * 1.4, gapWidthPx, thickness * 2.8)
                .fill({ color: CHASM_COLOR, alpha: 1 });
              if (isUrgent) {
                sceneGraphics
                  .rect(gx - gapWidthPx / 2, trackY - thickness * 1.4, gapWidthPx, thickness * 2.8)
                  .stroke({ width: 2, color: WARNING_COLOR, alpha: 0.9 });
              }
            }
          }

          const cartLift = world.isOver ? thickness * 2.5 : 0;
          sceneGraphics
            .roundRect(
              cartX - thickness * 2.2,
              trackY - thickness * 2 + cartLift,
              thickness * 4.4,
              thickness * 2,
              4,
            )
            .fill({ color: world.isOver ? WARNING_COLOR : CART_COLOR, alpha: 0.95 });
          sceneGraphics
            .circle(cartX - thickness * 1.2, trackY + cartLift, thickness * 0.7)
            .fill({ color: WHEEL_COLOR });
          sceneGraphics
            .circle(cartX + thickness * 1.2, trackY + cartLift, thickness * 0.7)
            .fill({ color: WHEEL_COLOR });

          const nextGap = world.nextLayableGap();
          if (nextGapMarkerRef.current) {
            if (nextGap) {
              const gx = gapPixelX(nextGap.distanceAhead, width);
              nextGapMarkerRef.current.style.left = `${gx}px`;
              nextGapMarkerRef.current.style.top = `${trackY}px`;
              nextGapMarkerRef.current.style.display = "block";
              nextGapMarkerRef.current.dataset.inReach = "true";
              nextGapMarkerRef.current.dataset.gapId = String(nextGap.id);
            } else {
              nextGapMarkerRef.current.style.display = "none";
              nextGapMarkerRef.current.dataset.inReach = "false";
              delete nextGapMarkerRef.current.dataset.gapId;
            }
          }

          for (let i = floatingPopups.length - 1; i >= 0; i--) {
            const entry = floatingPopups[i];
            entry.age += deltaSeconds;
            entry.text.position.y -= deltaSeconds * 26;
            entry.text.alpha = Math.max(0, 1 - entry.age / POPUP_LIFETIME);
            if (entry.age >= POPUP_LIFETIME) {
              popupHost.removeChild(entry.text);
              entry.text.destroy();
              floatingPopups.splice(i, 1);
            }
          }
        }
      }, 0.1);

      input.addListener({
        onPointerDown: () => {
          tryLayPlank();
        },
        onKeyDown: (key) => {
          if (loop.isPaused && key !== " ") return;
          if (key === " ") {
            setIsPaused(loop.togglePause());
            return;
          }
          if (key === "r") {
            world.reset();
            setIsOver(false);
            return;
          }
          if (key === "enter") {
            tryLayPlank();
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
    sizeRef.current = { width: size.width, height: size.height };
  }, [size.width, size.height]);

  return (
    <GameShell
      title="Rail Weaver"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="rail-weaver-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="rail-weaver-canvas" />
        <div
          ref={nextGapMarkerRef}
          className={styles.nextGapMarker}
          data-testid="rail-weaver-next-gap"
          data-in-reach="false"
        />
        <div className={styles.hud}>
          <span className={styles.combo} data-testid="rail-weaver-combo">
            COMBO {combo}
          </span>
          <span
            className={styles.plankStock}
            data-testid="rail-weaver-plank-stock"
            data-stock={plankStock}
          >
            板 {plankStock} / {PLANK_STOCK_MAX}
          </span>
          <span
            className={styles.distance}
            data-testid="rail-weaver-distance"
            data-distance={distanceMeters}
          >
            進んだ距離 {distanceMeters}m
          </span>
        </div>
        <div className={styles.hint}>
          前方のレールの切れ目が近づいたら、キャンバスをタップ/クリックして板を渡そう。板切れ・補修漏れでトロッコが谷に落ちると終了。
          キーボードはEnter: 板を渡す / Space: 一時停止 / R: リセット
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="rail-weaver-gameover">
            <div className={styles.gameOverTitle}>脱線</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="rail-weaver-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
