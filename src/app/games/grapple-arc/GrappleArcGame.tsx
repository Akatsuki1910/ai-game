"use client";

import { Application, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import {
  type AnchorGrabbedEvent,
  GRAB_RADIUS,
  GROUND_Y,
  GrappleArcWorld,
  PLAYER_RADIUS,
} from "./engine/world";
import styles from "./GrappleArcGame.module.scss";

interface FloatingScore {
  text: Text;
  age: number;
}

interface TrailPoint {
  x: number;
  y: number;
  age: number;
}

const POPUP_LIFETIME = 0.8;
const TRAIL_LIFETIME = 0.5;
const TRAIL_MIN_INTERVAL = 0.03;
const GRAB_KEYS = new Set(["arrowup", "w"]);

export function GrappleArcGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [distance, setDistance] = useState(0);
  const [combo, setCombo] = useState(0);
  const [bestCombo, setBestCombo] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<GrappleArcWorld | null>(null);
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
    const world = new GrappleArcWorld(1, 1);
    worldRef.current = world;

    const backgroundGraphics = new Graphics();
    const groundGraphics = new Graphics();
    const trailGraphics = new Graphics();
    const anchorGraphics = new Graphics();
    const ropeGraphics = new Graphics();
    const playerGraphics = new Graphics();
    const popupHost = new Graphics();

    const trail: TrailPoint[] = [];
    let trailCooldown = 0;
    const floatingScores: FloatingScore[] = [];
    let elapsedTime = 0;

    world.onAnchorGrabbed = ({ points, combo: currentCombo }: AnchorGrabbedEvent) => {
      const label = `+${points}${currentCombo > 1 ? ` COMBO×${currentCombo}` : ""}`;
      const text = new Text({
        text: label,
        style: { fill: 0xffe066, fontSize: 18, fontWeight: "700" },
      });
      text.anchor.set(0.5, 1);
      popupHost.addChild(text);
      floatingScores.push({ text, age: 0 });
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x090b12,
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
        groundGraphics,
        trailGraphics,
        anchorGraphics,
        ropeGraphics,
        playerGraphics,
        popupHost,
      );
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const toScreen = (worldX: number, worldY: number) => ({
        x: (worldX - world.cameraX) * world.scale,
        y: worldY * world.scale,
      });

      const loop = new GameLoop((deltaSeconds) => {
        world.step(deltaSeconds);
        elapsedTime += deltaSeconds;

        setScore(world.score);
        setDistance(Math.max(0, Math.floor(world.furthestX)));
        setCombo(world.combo);
        setBestCombo(world.bestCombo);
        if (world.isOver) setIsOver(true);

        const scale = world.scale;
        const cameraX = world.cameraX;

        // 奥行き感を出す背景のグリッド（カメラの動きに合わせてスクロールする）
        backgroundGraphics.clear();
        const gridSpacing = 120;
        const gridStartX = Math.floor(cameraX / gridSpacing) * gridSpacing;
        for (
          let x = gridStartX;
          x < cameraX + world.logicalViewWidth + gridSpacing;
          x += gridSpacing
        ) {
          const screenX = (x - cameraX) * scale;
          backgroundGraphics
            .moveTo(screenX, 0)
            .lineTo(screenX, world.height)
            .stroke({ width: 1, color: 0x1c2030, alpha: 0.6 });
        }

        // 谷底（触れると転落してゲームオーバー）
        groundGraphics.clear();
        const groundScreenY = GROUND_Y * scale;
        groundGraphics
          .rect(0, groundScreenY, world.width, Math.max(0, world.height - groundScreenY))
          .fill({ color: 0x2a0d10, alpha: 0.85 });
        const spikeSpacing = 36;
        const spikeStartX = Math.floor(cameraX / spikeSpacing) * spikeSpacing;
        for (
          let x = spikeStartX;
          x < cameraX + world.logicalViewWidth + spikeSpacing;
          x += spikeSpacing
        ) {
          const screenX = (x - cameraX) * scale;
          groundGraphics
            .moveTo(screenX, groundScreenY)
            .lineTo(screenX + (spikeSpacing * scale) / 2, groundScreenY - 14 * scale)
            .lineTo(screenX + spikeSpacing * scale, groundScreenY)
            .closePath()
            .fill({ color: 0xff6b6b, alpha: 0.5 });
        }

        // プレイヤーの軌跡（見た目の演出。物理には影響しない）
        trailCooldown -= deltaSeconds;
        if (trailCooldown <= 0) {
          trailCooldown = TRAIL_MIN_INTERVAL;
          trail.push({ x: world.playerX, y: world.playerY, age: 0 });
        }
        trailGraphics.clear();
        for (let i = trail.length - 1; i >= 0; i--) {
          trail[i].age += deltaSeconds;
          if (trail[i].age >= TRAIL_LIFETIME) {
            trail.splice(i, 1);
            continue;
          }
          const t = 1 - trail[i].age / TRAIL_LIFETIME;
          const p = toScreen(trail[i].x, trail[i].y);
          trailGraphics.circle(p.x, p.y, PLAYER_RADIUS * scale * 0.4 * t).fill({
            color: 0x6ee7ff,
            alpha: t * 0.35,
          });
        }

        // アンカー（掴める杭）
        anchorGraphics.clear();
        for (const anchor of world.anchors) {
          const p = toScreen(anchor.x, anchor.y);
          if (p.x < -60 || p.x > world.width + 60) continue;
          const isAttachedHere = world.isAttached && world.attachedAnchorId === anchor.id;
          const isReachable =
            !world.isAttached &&
            Math.hypot(anchor.x - world.playerX, anchor.y - world.playerY) <= GRAB_RADIUS;
          const color = isAttachedHere ? 0xffe066 : isReachable ? 0x7cf5c4 : 0x6ee7ff;
          const radius = (isAttachedHere ? 12 : 9) * scale;
          anchorGraphics
            .circle(p.x, p.y, radius)
            .fill({ color, alpha: isAttachedHere || isReachable ? 0.95 : 0.55 })
            .stroke({ width: 2, color: 0xf2f3f5, alpha: 0.35 });
          if (isReachable) {
            anchorGraphics
              .circle(p.x, p.y, GRAB_RADIUS * scale)
              .stroke({ width: 1.5, color: 0x7cf5c4, alpha: 0.4 });
          }
        }

        // ロープ
        ropeGraphics.clear();
        if (world.isAttached && world.attachedAnchorId !== null) {
          const anchor = world.anchors.find((a) => a.id === world.attachedAnchorId);
          if (anchor) {
            const anchorScreen = toScreen(anchor.x, anchor.y);
            const playerScreen = toScreen(world.playerX, world.playerY);
            ropeGraphics
              .moveTo(anchorScreen.x, anchorScreen.y)
              .lineTo(playerScreen.x, playerScreen.y)
              .stroke({ width: 2.5, color: 0xf2f3f5, alpha: 0.8 });
          }
        }

        // プレイヤー本体
        playerGraphics.clear();
        const playerScreen = toScreen(world.playerX, world.playerY);
        const pulse = 1 + Math.sin(elapsedTime * 6) * 0.06;
        playerGraphics
          .circle(playerScreen.x, playerScreen.y, PLAYER_RADIUS * scale * pulse)
          .fill({ color: world.isAttached ? 0x6ee7ff : 0xffb454 })
          .stroke({ width: 2, color: 0xf2f3f5, alpha: 0.9 });

        // 加点ポップアップ
        for (let i = floatingScores.length - 1; i >= 0; i--) {
          const entry = floatingScores[i];
          entry.age += deltaSeconds;
          if (entry.age === deltaSeconds) {
            entry.text.position.set(playerScreen.x, playerScreen.y - PLAYER_RADIUS * scale - 4);
          }
          entry.text.position.y -= deltaSeconds * 30;
          entry.text.alpha = Math.max(0, 1 - entry.age / POPUP_LIFETIME);
          if (entry.age >= POPUP_LIFETIME) {
            popupHost.removeChild(entry.text);
            entry.text.destroy();
            floatingScores.splice(i, 1);
          }
        }
      }, 0.1);

      const handleGrabStart = () => world.attemptGrab();
      const handleGrabEnd = () => world.release();

      input.addListener({
        onPointerDown: handleGrabStart,
        onPointerUp: handleGrabEnd,
        onKeyDown: (key) => {
          if (GRAB_KEYS.has(key)) {
            handleGrabStart();
          } else if (key === " ") {
            setIsPaused(loop.togglePause());
          } else if (key === "r") {
            world.reset();
            setIsOver(false);
          }
        },
        onKeyUp: (key) => {
          if (GRAB_KEYS.has(key)) handleGrabEnd();
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
      title="Grapple Arc"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="grapple-arc-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="grapple-arc-canvas" />
        <div className={styles.hud}>
          <span className={styles.distance} data-testid="grapple-arc-distance">
            {distance}m
          </span>
          <span className={styles.combo} data-testid="grapple-arc-combo">
            COMBO {combo} (BEST {bestCombo})
          </span>
        </div>
        <div className={styles.hint}>
          長押しでロープにつかまり、放すと勢いよく飛ぶ。次のアンカーの近くで再びつかんで飛び移り続けろ。
          マウス/タップを長押し、またはキーボードは ↑ / W キー長押し。Space: 一時停止 / R:
          リセット。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="grapple-arc-gameover">
            <div className={styles.gameOverTitle}>谷底へ転落…</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <div className={styles.gameOverSub}>
              DISTANCE {distance}m / BEST COMBO {bestCombo}
            </div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="grapple-arc-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
