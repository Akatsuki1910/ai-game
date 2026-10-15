"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import {
  type GateResultEvent,
  type HitEvent,
  KAYAK_RADIUS,
  MAX_LIVES,
  RapidsWeaveWorld,
  riverCenterX,
  riverHalfWidth,
} from "./engine/world";
import styles from "./RapidsWeaveGame.module.scss";

/** 画面横幅を何ワールド単位ぶんの視界として表示するか。カヤックは常に画面中央に固定し、カメラはそれに追従する。 */
const VIEW_WORLD_WIDTH = 360;
const KAYAK_SCREEN_Y_RATIO = 0.76;
const LEAN_RANGE_RATIO = 0.35;
const RIVER_SAMPLE_STEP = 24;
const POPUP_LIFETIME = 0.9;
const HIT_FLASH_LIFETIME = 0.4;

interface FloatingPopup {
  text: Text;
  age: number;
}

function heartsLabel(lives: number): string {
  return `${"♥".repeat(Math.max(0, lives))}${"♡".repeat(Math.max(0, MAX_LIVES - lives))}`;
}

export function RapidsWeaveGame() {
  const { ref: stageRef } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(MAX_LIVES);
  const [combo, setCombo] = useState(0);
  const [distanceMeters, setDistanceMeters] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<RapidsWeaveWorld | null>(null);
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
    setCombo(0);
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
    const world = new RapidsWeaveWorld();
    worldRef.current = world;

    const waterGraphics = new Graphics();
    const bankGraphics = new Graphics();
    const rockGraphics = new Graphics();
    const gateGraphics = new Graphics();
    const kayakGraphics = new Graphics();
    const flashGraphics = new Graphics();
    const popupHost = new Container();
    const floatingPopups: FloatingPopup[] = [];
    let hitFlashAge = Number.POSITIVE_INFINITY;

    world.onHit = (_event: HitEvent) => {
      hitFlashAge = 0;
    };

    world.onGateResult = ({ isSuccess, combo: comboValue, points }: GateResultEvent) => {
      const label = isSuccess
        ? `+${points}${comboValue > 1 ? ` COMBO x${comboValue}` : ""}`
        : "MISS";
      const text = new Text({
        text: label,
        style: {
          fill: isSuccess ? 0xffe066 : 0xff6b6b,
          fontSize: isSuccess ? 18 : 16,
          fontWeight: "700",
        },
      });
      text.anchor.set(0.5, 1);
      popupHost.addChild(text);
      floatingPopups.push({ text, age: 0 });
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x0a1016,
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
        bankGraphics,
        waterGraphics,
        rockGraphics,
        gateGraphics,
        kayakGraphics,
        popupHost,
        flashGraphics,
      );
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        const screenWidth = app.screen.width;
        const screenHeight = app.screen.height;
        const screenCenterX = screenWidth / 2;
        const screenKayakY = screenHeight * KAYAK_SCREEN_Y_RATIO;
        const scale = screenWidth > 0 ? screenWidth / VIEW_WORLD_WIDTH : 1;

        const pointer = input.getPrimaryPointer();
        if (pointer) {
          const leanRange = Math.max(60, screenWidth * LEAN_RANGE_RATIO);
          world.setLean((pointer.x - screenCenterX) / leanRange);
        } else if (input.isKeyDown("arrowleft") || input.isKeyDown("a")) {
          world.setLean(-1);
        } else if (input.isKeyDown("arrowright") || input.isKeyDown("d")) {
          world.setLean(1);
        } else {
          world.setLean(0);
        }

        world.step(deltaSeconds);
        setScore(world.score);
        setLives(world.lives);
        setCombo(world.combo);
        setDistanceMeters(Math.floor(world.distance / 10));
        if (world.isOver) setIsOver(true);

        const toScreenX = (worldX: number) => screenCenterX + (worldX - world.lateralX) * scale;
        const toScreenY = (worldDistance: number) =>
          screenKayakY - (worldDistance - world.distance) * scale;

        const viewFrom = world.distance - 60;
        const viewTo = world.distance + screenHeight / scale + 80;

        // 川面と岸(カヤックを中心に、見えている範囲ぶんだけ曲線をサンプリングして描く)
        const leftEdge: { x: number; y: number }[] = [];
        const rightEdge: { x: number; y: number }[] = [];
        for (let d = viewFrom; d <= viewTo; d += RIVER_SAMPLE_STEP) {
          const center = riverCenterX(d);
          const half = riverHalfWidth(d);
          leftEdge.push({ x: toScreenX(center - half), y: toScreenY(d) });
          rightEdge.push({ x: toScreenX(center + half), y: toScreenY(d) });
        }

        bankGraphics.clear().rect(0, 0, screenWidth, screenHeight).fill({ color: 0x3a3226 });

        waterGraphics.clear();
        if (leftEdge.length > 1) {
          waterGraphics.moveTo(leftEdge[0].x, leftEdge[0].y);
          for (let i = 1; i < leftEdge.length; i++)
            waterGraphics.lineTo(leftEdge[i].x, leftEdge[i].y);
          for (let i = rightEdge.length - 1; i >= 0; i--)
            waterGraphics.lineTo(rightEdge[i].x, rightEdge[i].y);
          waterGraphics.closePath().fill({ color: 0x1c5c78, alpha: 0.95 });
          waterGraphics
            .moveTo(leftEdge[0].x, leftEdge[0].y)
            .lineTo(leftEdge[leftEdge.length - 1].x, leftEdge[leftEdge.length - 1].y)
            .stroke({ width: 2, color: 0xbfe3ec, alpha: 0.5 });
          waterGraphics
            .moveTo(rightEdge[0].x, rightEdge[0].y)
            .lineTo(rightEdge[rightEdge.length - 1].x, rightEdge[rightEdge.length - 1].y)
            .stroke({ width: 2, color: 0xbfe3ec, alpha: 0.5 });
        }

        // 岩
        rockGraphics.clear();
        for (const rock of world.rocks) {
          if (rock.distance < viewFrom || rock.distance > viewTo) continue;
          const sx = toScreenX(rock.x);
          const sy = toScreenY(rock.distance);
          const r = rock.radius * scale;
          rockGraphics
            .circle(sx, sy, r)
            .fill({ color: 0x6b5a4a })
            .stroke({ width: 2, color: 0x2e241c, alpha: 0.8 });
        }

        // ゲート(通過口の両端にブイを置く)
        gateGraphics.clear();
        for (const gate of world.gates) {
          if (gate.distance < viewFrom || gate.distance > viewTo) continue;
          const sy = toScreenY(gate.distance);
          const leftX = toScreenX(gate.gapCenterX - gate.gapHalfWidth);
          const rightX = toScreenX(gate.gapCenterX + gate.gapHalfWidth);
          const color = gate.isResolved ? (gate.wasSuccess ? 0x7cf5c4 : 0xff6b6b) : 0xffe066;
          const r = Math.max(4, 7 * scale);
          for (const x of [leftX, rightX]) {
            gateGraphics.circle(x, sy, r).fill({ color, alpha: 0.9 });
          }
        }

        // カヤック(常に画面中央に固定。横速度に応じてわずかに傾ける)
        const tilt = Math.max(-0.5, Math.min(0.5, world.lateralVelocity / 400));
        const isBlinking =
          world.invulnerableSeconds > 0 && Math.floor(world.invulnerableSeconds * 10) % 2 === 0;
        kayakGraphics.clear();
        if (!isBlinking) {
          const r = KAYAK_RADIUS * scale;
          kayakGraphics
            .moveTo(screenCenterX, screenKayakY - r * 1.6)
            .lineTo(screenCenterX + r * 0.8, screenKayakY + r * 1.1)
            .lineTo(screenCenterX - r * 0.8, screenKayakY + r * 1.1)
            .closePath()
            .fill({ color: 0xff9f43 })
            .stroke({ width: 2, color: 0xfff3e0, alpha: 0.9 });
        }
        kayakGraphics.rotation = tilt;
        kayakGraphics.pivot.set(screenCenterX, screenKayakY);
        kayakGraphics.position.set(screenCenterX, screenKayakY);

        // 衝突時の赤いフラッシュ
        hitFlashAge += deltaSeconds;
        flashGraphics.clear();
        if (hitFlashAge < HIT_FLASH_LIFETIME) {
          const alpha = 0.35 * (1 - hitFlashAge / HIT_FLASH_LIFETIME);
          flashGraphics.rect(0, 0, screenWidth, screenHeight).fill({ color: 0xff3b3b, alpha });
        }

        // ゲート結果のポップアップ
        for (let i = floatingPopups.length - 1; i >= 0; i--) {
          const entry = floatingPopups[i];
          if (entry.age === 0) {
            entry.text.position.set(screenCenterX, screenKayakY - KAYAK_RADIUS * scale - 10);
          }
          entry.age += deltaSeconds;
          entry.text.position.y -= deltaSeconds * 30;
          entry.text.alpha = Math.max(0, 1 - entry.age / POPUP_LIFETIME);
          if (entry.age >= POPUP_LIFETIME) {
            popupHost.removeChild(entry.text);
            entry.text.destroy();
            floatingPopups.splice(i, 1);
          }
        }
      }, 0.1);

      input.addListener({
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
          } else if (key === "r") {
            world.reset();
            setIsOver(false);
            setCombo(0);
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

  return (
    <GameShell
      title="Rapids Weave"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="rapids-weave-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="rapids-weave-canvas" />
        <div className={styles.hud}>
          <span className={styles.lives} data-testid="rapids-weave-lives">
            {heartsLabel(lives)}
          </span>
          <span className={styles.distance} data-testid="rapids-weave-distance">
            {distanceMeters}m
          </span>
          {combo > 1 && (
            <span className={styles.combo} data-testid="rapids-weave-combo">
              COMBO x{combo}
            </span>
          )}
        </div>
        <div className={styles.hint}>
          ドラッグ/長押しした位置(または矢印キー/A・D長押し)でカヤックを左右に傾けて操舵。
          ブイの間を通るとコンボ得点、岩や岸に当たるとライフが減る。Space: 一時停止 / R: リセット。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="rapids-weave-gameover">
            <div className={styles.gameOverTitle}>難破…</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <div className={styles.gameOverSub}>DISTANCE {distanceMeters}m</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="rapids-weave-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
