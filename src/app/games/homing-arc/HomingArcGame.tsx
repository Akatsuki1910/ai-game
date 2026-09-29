"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import {
  cubicBezierPoint,
  HomingArcWorld,
  MAX_LIVES,
  type ThrowResolvedEvent,
} from "./engine/world";
import styles from "./HomingArcGame.module.scss";

const ANCHOR_COLOR = 0x6ee7ff;
const CATCH_READY_COLOR = 0xffe066;
const OBSTACLE_FILL_COLOR = 0x8a6b4a;
const OBSTACLE_STROKE_COLOR = 0x5c4630;
const BOOMERANG_COLOR = 0x7cf5c4;
const AIM_LINE_COLOR = 0x6ee7ff;
const PATH_PREVIEW_COLOR = 0xffffff;

const ANGLE_RATE_PER_SECOND = Math.PI * 0.7;
const POWER_RATE_PER_SECOND = 1.1;
const MIN_DRAG_TO_THROW = 8;
const BOOMERANG_SPIN_RATE = 14; // rad/秒。見た目の回転だけで軌道計算には使わない。
const PATH_PREVIEW_SAMPLES = 20;
const POPUP_LIFETIME = 0.9;

interface FloatingPopup {
  text: Text;
  age: number;
}

const OUTCOME_LABEL: Record<ThrowResolvedEvent["outcome"], string> = {
  caught: "CATCH!",
  missed: "ミス…",
  obstacle: "岩にぶつかった!",
};

const OUTCOME_COLOR: Record<ThrowResolvedEvent["outcome"], number> = {
  caught: CATCH_READY_COLOR,
  missed: 0xff6b6b,
  obstacle: 0xff8a5c,
};

export function HomingArcGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(MAX_LIVES);
  const [combo, setCombo] = useState(0);
  const [bestCombo, setBestCombo] = useState(0);
  const [statusLabel, setStatusLabel] = useState("ねらう");
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<HomingArcWorld | null>(null);
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
    const world = new HomingArcWorld(1, 1);
    worldRef.current = world;

    const fieldGraphics = new Graphics();
    const boomerangGraphics = new Graphics();
    const popupHost = new Container();
    const floatingPopups: FloatingPopup[] = [];

    let pointerAimId: number | null = null;

    world.onThrowResolved = (event: ThrowResolvedEvent) => {
      const anchor = world.anchor;
      const label =
        event.outcome === "caught" && event.combo > 1
          ? `+${event.points} COMBO x${event.combo}`
          : OUTCOME_LABEL[event.outcome];
      const text = new Text({
        text: label,
        style: { fill: OUTCOME_COLOR[event.outcome], fontSize: 18, fontWeight: "800" },
      });
      text.anchor.set(0.5, 1);
      text.position.set(anchor.x, anchor.y - 46);
      popupHost.addChild(text);
      floatingPopups.push({ text, age: 0 });
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x0a1420,
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
      app.stage.addChild(fieldGraphics, boomerangGraphics, popupHost);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds, elapsedSeconds) => {
        world.step(deltaSeconds);

        if (input.isKeyDown("arrowleft") || input.isKeyDown("a")) {
          world.rotateAim(-ANGLE_RATE_PER_SECOND * deltaSeconds);
        }
        if (input.isKeyDown("arrowright") || input.isKeyDown("d")) {
          world.rotateAim(ANGLE_RATE_PER_SECOND * deltaSeconds);
        }
        if (input.isKeyDown("arrowup") || input.isKeyDown("w")) {
          world.adjustPower(POWER_RATE_PER_SECOND * deltaSeconds);
        }
        if (input.isKeyDown("arrowdown") || input.isKeyDown("s")) {
          world.adjustPower(-POWER_RATE_PER_SECOND * deltaSeconds);
        }

        setScore(world.score);
        setLives(world.lives);
        setCombo(world.combo);
        setBestCombo(world.bestCombo);
        if (world.isOver) setIsOver(true);
        setStatusLabel(
          world.phase === "aiming" ? "ねらう" : world.isInCatchWindow ? "キャッチ!" : "飛行中",
        );

        const anchor = world.anchor;

        fieldGraphics.clear();

        for (const obstacle of world.obstacles) {
          fieldGraphics
            .circle(obstacle.x, obstacle.y, obstacle.radius)
            .fill({ color: OBSTACLE_FILL_COLOR, alpha: 0.9 })
            .stroke({ width: 2, color: OBSTACLE_STROKE_COLOR, alpha: 0.9 });
        }

        if (world.phase === "aiming") {
          const dir = { x: Math.cos(world.aimAngle), y: Math.sin(world.aimAngle) };
          const previewLength = 60 + world.aimPower * 140;
          fieldGraphics
            .moveTo(anchor.x, anchor.y)
            .lineTo(anchor.x + dir.x * previewLength, anchor.y + dir.y * previewLength)
            .stroke({ width: 3, color: AIM_LINE_COLOR, alpha: 0.55 });
          fieldGraphics
            .circle(anchor.x + dir.x * previewLength, anchor.y + dir.y * previewLength, 5)
            .fill({ color: AIM_LINE_COLOR, alpha: 0.8 });
        } else {
          const activeThrow = world.activeThrow;
          if (activeThrow) {
            fieldGraphics.moveTo(activeThrow.p0.x, activeThrow.p0.y);
            for (let i = 1; i <= PATH_PREVIEW_SAMPLES; i++) {
              const t = i / PATH_PREVIEW_SAMPLES;
              const point = cubicBezierPoint(
                activeThrow.p0,
                activeThrow.p1,
                activeThrow.p2,
                activeThrow.p3,
                t,
              );
              fieldGraphics.lineTo(point.x, point.y);
            }
            fieldGraphics.stroke({ width: 2, color: PATH_PREVIEW_COLOR, alpha: 0.15 });
          }
        }

        // 待機中も画面が完全な静止画にならないよう、アンカーを常にゆっくり脈動させる。
        const anchorPulse = 1 + Math.sin(elapsedSeconds * 4) * 0.18;
        const anchorRadius = (world.isInCatchWindow ? 22 : 16) * anchorPulse;
        fieldGraphics
          .circle(anchor.x, anchor.y, anchorRadius)
          .fill({ color: world.isInCatchWindow ? CATCH_READY_COLOR : ANCHOR_COLOR, alpha: 0.9 });

        boomerangGraphics.clear();
        const boomerangPosition = world.currentBoomerangPosition;
        if (boomerangPosition) {
          const spin = performance.now() * 0.001 * BOOMERANG_SPIN_RATE;
          boomerangGraphics.position.set(boomerangPosition.x, boomerangPosition.y);
          boomerangGraphics.rotation = spin;
          boomerangGraphics
            .moveTo(-12, 0)
            .lineTo(10, -6)
            .lineTo(4, 0)
            .lineTo(10, 6)
            .lineTo(-12, 0)
            .fill({ color: BOOMERANG_COLOR, alpha: 0.95 });
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
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => {
          if (world.phase === "flying") {
            world.attemptCatch();
            return;
          }
          pointerAimId = pointer.id;
        },
        onPointerMove: (pointer) => {
          if (pointer.id !== pointerAimId || world.phase !== "aiming") return;
          world.setAimFromDrag(pointer.x - pointer.startX, pointer.y - pointer.startY);
        },
        onPointerUp: (pointer) => {
          if (pointer.id !== pointerAimId) return;
          pointerAimId = null;
          const dragDistance = Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY);
          if (world.phase === "aiming" && dragDistance >= MIN_DRAG_TO_THROW) {
            world.releaseThrow();
          }
        },
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
          } else if (key === "r") {
            world.reset();
            setIsOver(false);
          } else if (key === "enter") {
            if (world.phase === "aiming") world.releaseThrow();
            else world.attemptCatch();
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
      title="Homing Arc"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="homing-arc-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="homing-arc-canvas" />
        <div className={styles.hud}>
          <span className={styles.status} data-testid="homing-arc-status">
            {statusLabel}
          </span>
          <span className={styles.combo} data-testid="homing-arc-combo">
            COMBO {combo} (BEST {bestCombo})
          </span>
          <span className={styles.lives} data-testid="homing-arc-lives">
            {"♥".repeat(Math.max(0, lives))}
            {"♡".repeat(Math.max(0, MAX_LIVES - lives))}
          </span>
        </div>
        <div className={styles.hint}>
          ドラッグして引っ張り、離すとブーメランを投げる。戻ってきて「キャッチ!」の表示中にタップで受け止めよう。岩に当たるかキャッチし損ねるとライフが減る。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="homing-arc-gameover">
            <div className={styles.gameOverTitle}>ブーメランを見失った…</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <div className={styles.gameOverSub}>ベストコンボ {bestCombo}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="homing-arc-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
