"use client";

import { Application, Graphics } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import {
  DEPTH_MAX,
  DEPTH_MIN,
  LIGHT_X_RATIO,
  LIGHT_Y_RATIO,
  SESSION_SECONDS,
  ShadowCastWorld,
  WALL_Y_RATIO,
} from "./engine/world";
import styles from "./ShadowCastGame.module.scss";

const LANTERN_COLOR = 0xffd68a;
const CONE_COLOR = 0x6ee7ff;
const SCREEN_COLOR = 0xe9e4f2;
const SHADOW_COLOR = 0x120e1c;
const MATCHED_COLOR = 0x7cf5c4;
const TARGET_COLOR = 0x6ee7ff;
const PUPPET_COLOR = 0xffd68a;

const BASE_SHADOW_RADIUS_RATIO = 0.045;
const PUPPET_RADIUS_RATIO = 0.022;

const KEY_MOVE_X_PER_SEC = 0.5;
const KEY_MOVE_DEPTH_PER_SEC = 0.42;

/** ウサギの影絵シルエット(頭+耳)のパスを組み立てる。fill/strokeは呼び出し側で行う。 */
function pathRabbit(g: Graphics, cx: number, cy: number, size: number): Graphics {
  const earSpread = size * 0.34;
  const earHeight = size * 1.15;
  g.circle(cx, cy, size * 0.62);
  g.poly([
    cx - earSpread,
    cy - size * 0.3,
    cx - earSpread * 0.35,
    cy - size * 0.55,
    cx - earSpread * 0.55,
    cy - earHeight,
    cx - earSpread * 1.05,
    cy - size * 0.5,
  ]);
  g.poly([
    cx + earSpread,
    cy - size * 0.3,
    cx + earSpread * 0.35,
    cy - size * 0.55,
    cx + earSpread * 0.55,
    cy - earHeight,
    cx + earSpread * 1.05,
    cy - size * 0.5,
  ]);
  return g;
}

export function ShadowCastGame() {
  const { ref: stageRef } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [holdPercent, setHoldPercent] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(SESSION_SECONDS);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<ShadowCastWorld | null>(null);
  const appRef = useRef<Application | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const targetMarkerRef = useRef<HTMLSpanElement | null>(null);

  const handleTogglePause = useCallback(() => {
    if (!loopRef.current) return;
    setIsPaused(loopRef.current.togglePause());
  }, []);

  const handleRestart = useCallback(() => {
    worldRef.current?.reset();
    setIsOver(false);
    setCombo(0);
    setHoldPercent(0);
    setTimeRemaining(SESSION_SECONDS);
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
    const world = new ShadowCastWorld();
    worldRef.current = world;

    const coneGraphics = new Graphics();
    const screenGraphics = new Graphics();
    const targetGraphics = new Graphics();
    const shadowGraphics = new Graphics();
    const lanternGraphics = new Graphics();
    const puppetGraphics = new Graphics();

    let activePointerId: number | null = null;
    let isPointerDown = false;
    let pointerXRatio = LIGHT_X_RATIO;
    let pointerYRatio =
      LIGHT_Y_RATIO + (DEPTH_MIN + DEPTH_MAX) * 0.5 * (WALL_Y_RATIO - LIGHT_Y_RATIO);

    world.onMatchCompleted = () => {
      setCombo(world.combo);
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x08060c,
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
        screenGraphics,
        coneGraphics,
        targetGraphics,
        shadowGraphics,
        lanternGraphics,
        puppetGraphics,
      );
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds, elapsedSeconds) => {
        if (input.isKeyDown("arrowleft") || input.isKeyDown("a")) {
          world.moveBy(-KEY_MOVE_X_PER_SEC * deltaSeconds, 0);
        }
        if (input.isKeyDown("arrowright") || input.isKeyDown("d")) {
          world.moveBy(KEY_MOVE_X_PER_SEC * deltaSeconds, 0);
        }
        if (input.isKeyDown("arrowup") || input.isKeyDown("w")) {
          world.moveBy(0, -KEY_MOVE_DEPTH_PER_SEC * deltaSeconds);
        }
        if (input.isKeyDown("arrowdown") || input.isKeyDown("s")) {
          world.moveBy(0, KEY_MOVE_DEPTH_PER_SEC * deltaSeconds);
        }
        if (isPointerDown) {
          world.setPointer(pointerXRatio, pointerYRatio);
        }

        world.step(deltaSeconds);

        setScore(world.score);
        setCombo(world.combo);
        setHoldPercent(Math.round(world.holdProgress * 100));
        setTimeRemaining(Math.ceil(world.timeRemaining));
        if (world.isOver) setIsOver(true);

        const width = app.screen.width;
        const height = app.screen.height;
        const lightPx = { x: LIGHT_X_RATIO * width, y: LIGHT_Y_RATIO * height };
        const wallY = WALL_Y_RATIO * height;
        const baseRadius = Math.min(width, height) * BASE_SHADOW_RADIUS_RATIO;
        const puppetRadius = Math.min(width, height) * PUPPET_RADIUS_RATIO;

        // 無操作でも画面が生きて見えるよう、ランタンの炎を常時揺らめかせる。
        const flicker =
          0.75 + Math.sin(elapsedSeconds * 6.1) * 0.15 + Math.sin(elapsedSeconds * 13) * 0.06;
        lanternGraphics
          .clear()
          .circle(lightPx.x, lightPx.y, 14 * flicker)
          .fill({ color: LANTERN_COLOR, alpha: 0.95 })
          .circle(lightPx.x, lightPx.y, 30 * flicker)
          .fill({ color: LANTERN_COLOR, alpha: 0.22 });

        screenGraphics
          .clear()
          .rect(0, wallY - height * 0.02, width, height - (wallY - height * 0.02))
          .fill({ color: SCREEN_COLOR, alpha: 0.08 })
          .rect(0, wallY - height * 0.02, width, 2)
          .fill({ color: SCREEN_COLOR, alpha: 0.35 });

        coneGraphics.clear();
        coneGraphics.moveTo(lightPx.x, lightPx.y);
        coneGraphics.lineTo(0.08 * width, wallY);
        coneGraphics.moveTo(lightPx.x, lightPx.y);
        coneGraphics.lineTo(0.92 * width, wallY);
        coneGraphics.stroke({ width: 1, color: CONE_COLOR, alpha: 0.12 });

        // お題の輪郭(脈動させて静止画にならないようにする)
        const pulse = 0.5 + Math.sin(elapsedSeconds * 3) * 0.5;
        const targetRadius = baseRadius * world.target.scale * (0.97 + pulse * 0.06);
        targetGraphics.clear();
        pathRabbit(targetGraphics, world.target.shadowXRatio * width, wallY, targetRadius).stroke({
          width: 2,
          color: TARGET_COLOR,
          alpha: 0.4 + pulse * 0.3,
        });

        const projected = world.projected;
        const shadowRadius = baseRadius * projected.scale;
        const matched = world.isMatched;
        shadowGraphics.clear();
        pathRabbit(shadowGraphics, projected.shadowXRatio * width, wallY, shadowRadius * 1.12).fill(
          { color: matched ? MATCHED_COLOR : SHADOW_COLOR, alpha: matched ? 0.18 : 0.12 },
        );
        pathRabbit(shadowGraphics, projected.shadowXRatio * width, wallY, shadowRadius).fill({
          color: matched ? MATCHED_COLOR : SHADOW_COLOR,
          alpha: matched ? 0.85 : 0.92,
        });

        const puppetPx = {
          x: world.puppetXRatio * width,
          y: lightPx.y + world.depthRatio * (wallY - lightPx.y),
        };
        puppetGraphics.clear();
        puppetGraphics
          .moveTo(puppetPx.x, puppetPx.y)
          .lineTo(puppetPx.x, height)
          .stroke({ width: 1, color: PUPPET_COLOR, alpha: 0.18 });
        pathRabbit(puppetGraphics, puppetPx.x, puppetPx.y, puppetRadius)
          .fill({ color: PUPPET_COLOR, alpha: 0.95 })
          .stroke({ width: 1.5, color: 0x2a2014, alpha: 0.6 });

        if (targetMarkerRef.current) {
          const requiredDepthRatio = 1 / world.target.scale;
          const requiredXRatio =
            LIGHT_X_RATIO + (world.target.shadowXRatio - LIGHT_X_RATIO) * requiredDepthRatio;
          const requiredYRatio =
            LIGHT_Y_RATIO + requiredDepthRatio * (WALL_Y_RATIO - LIGHT_Y_RATIO);
          targetMarkerRef.current.dataset.xRatio = String(requiredXRatio);
          targetMarkerRef.current.dataset.yRatio = String(requiredYRatio);
          targetMarkerRef.current.dataset.scale = String(world.target.scale);
        }
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => {
          if (activePointerId !== null) return;
          activePointerId = pointer.id;
          isPointerDown = true;
          pointerXRatio = pointer.x / app.screen.width;
          pointerYRatio = pointer.y / app.screen.height;
        },
        onPointerMove: (pointer) => {
          if (pointer.id !== activePointerId) return;
          pointerXRatio = pointer.x / app.screen.width;
          pointerYRatio = pointer.y / app.screen.height;
        },
        onPointerUp: (pointer) => {
          if (pointer.id !== activePointerId) return;
          activePointerId = null;
          isPointerDown = false;
        },
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
          } else if (key === "r") {
            world.reset();
            setIsOver(false);
            setCombo(0);
            setHoldPercent(0);
            setTimeRemaining(SESSION_SECONDS);
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
      title="Shadow Cast"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="shadow-cast-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="shadow-cast-canvas" />
        <div className={styles.hud}>
          <span className={styles.stat} data-testid="shadow-cast-combo">
            重ねた影 {combo}回
          </span>
          <span className={styles.stat} data-testid="shadow-cast-timer">
            残り {timeRemaining}秒
          </span>
          <div className={styles.holdTrack} data-testid="shadow-cast-hold">
            <div className={styles.holdFill} style={{ width: `${holdPercent}%` }} />
          </div>
        </div>
        {/* 画面には描かないが、現在のお題にぴったり重なる人形位置(比率座標)を保持する。
            キャンバス上の描画位置そのものはピクセル情報として読み取れないため、
            ストーリーテストが実際の画面操作(ポインタ移動)で追従できるようにするための座標データ。 */}
        <span
          ref={targetMarkerRef}
          className={styles.visuallyHidden}
          aria-hidden="true"
          data-testid="shadow-cast-target"
        />
        <div className={styles.hint}>
          ドラッグで人形を移動(上下で光源からの距離、左右で位置)して、壁に映る影をお題の輪郭に重ね続けよう。
          矢印キー/WASDでも操作できる。 Space: 一時停止 / R: リセット。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="shadow-cast-gameover">
            <div className={styles.gameOverTitle}>灯が消えた</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <div className={styles.gameOverSub}>重ねた影 {combo}回</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="shadow-cast-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
