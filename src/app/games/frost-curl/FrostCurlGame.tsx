"use client";

import { Application, Graphics } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import { FrostCurlWorld, type Stone } from "./engine/world";
import styles from "./FrostCurlGame.module.scss";

const MIN_LAUNCH_DRAG = 14;
const KEY_ROTATE_SPEED = 1.6; // ラジアン/秒
const KEY_POWER_SPEED = 0.9; // /秒
const DEFAULT_AIM_ANGLE = -Math.PI / 2; // ハックからハウスへ向かう「まっすぐ上」
const DEFAULT_AIM_POWER = 0.62;
const BANNER_LIFETIME_MS = 1600;

const HOUSE_OUTER_COLOR = 0x3f7ce0;
const HOUSE_MID_COLOR = 0xf4f7ff;
const HOUSE_INNER_COLOR = 0xef4444;
const HOUSE_BUTTON_COLOR = 0xffd166;
const GUARD_COLOR = 0x8a94a6;
const PLAYER_COLOR = 0xe8f7ff;
const SWEEP_GLOW_COLOR = 0x9be8ff;

function spinLabel(spin: 1 | -1): string {
  return spin === 1 ? "カール: 右 ↻" : "カール: 左 ↺";
}

export function FrostCurlGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const canvasHostRef = useRef<HTMLDivElement | null>(null);

  const worldRef = useRef<FrostCurlWorld | null>(null);
  const appRef = useRef<Application | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const spinRef = useRef<1 | -1>(1);

  const [score, setScore] = useState(0);
  const [endNumber, setEndNumber] = useState(1);
  const [totalEnds, setTotalEnds] = useState(1);
  const [stonesLeft, setStonesLeft] = useState(0);
  const [spin, setSpin] = useState<1 | -1>(1);
  const [isSweepingActive, setIsSweepingActive] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);
  const [endBanner, setEndBanner] = useState<{ endNumber: number; points: number } | null>(null);
  const [burnMessage, setBurnMessage] = useState<string | null>(null);

  const applySpin = useCallback((next: 1 | -1) => {
    spinRef.current = next;
    setSpin(next);
  }, []);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    let disposed = false;
    let endBannerTimer: ReturnType<typeof setTimeout> | null = null;
    let burnMessageTimer: ReturnType<typeof setTimeout> | null = null;

    const app = new Application();
    const world = new FrostCurlWorld(1, 1);
    worldRef.current = world;

    const sheetGraphics = new Graphics();
    const stoneGraphics = new Graphics();
    const aimGraphics = new Graphics();

    let aimAngle = DEFAULT_AIM_ANGLE;
    let aimPower = DEFAULT_AIM_POWER;
    let pointerAimId: number | null = null;
    let pointerAnchor = { x: 0, y: 0 };
    let isPointerHeld = false;

    world.onEndComplete = ({ endIndex, points }) => {
      setEndBanner({ endNumber: endIndex + 1, points });
      if (endBannerTimer) clearTimeout(endBannerTimer);
      endBannerTimer = setTimeout(() => setEndBanner(null), BANNER_LIFETIME_MS);
    };
    world.onStoneBurned = ({ reason }) => {
      setBurnMessage(reason === "hogline" ? "ホグライン未達でバーン…" : "場外でバーン…");
      if (burnMessageTimer) clearTimeout(burnMessageTimer);
      burnMessageTimer = setTimeout(() => setBurnMessage(null), BANNER_LIFETIME_MS);
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x081018,
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
      app.stage.addChild(sheetGraphics, aimGraphics, stoneGraphics);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const computeAimVelocity = () => ({
        vx: Math.cos(aimAngle) * aimPower * world.maxSpeed,
        vy: Math.sin(aimAngle) * aimPower * world.maxSpeed,
      });

      const loop = new GameLoop((deltaSeconds, elapsedSeconds) => {
        const anyMoving = world.stones.some((stone) => stone.isMoving);
        const sweepActive = anyMoving && (isPointerHeld || input.isKeyDown("s"));
        world.setSweeping(sweepActive);

        if (world.isReadyToThrow && pointerAimId === null) {
          if (input.isKeyDown("arrowleft")) aimAngle -= KEY_ROTATE_SPEED * deltaSeconds;
          if (input.isKeyDown("arrowright")) aimAngle += KEY_ROTATE_SPEED * deltaSeconds;
          if (input.isKeyDown("arrowup")) {
            aimPower = Math.min(1, aimPower + KEY_POWER_SPEED * deltaSeconds);
          }
          if (input.isKeyDown("arrowdown")) {
            aimPower = Math.max(0.1, aimPower - KEY_POWER_SPEED * deltaSeconds);
          }
        }

        world.step(deltaSeconds);

        setScore(world.score);
        setEndNumber(world.endIndex + 1);
        setTotalEnds(world.totalEnds);
        setStonesLeft(world.stonesPerEnd - world.stonesThrownThisEnd);
        setIsSweepingActive(sweepActive);
        if (world.isOver) setIsOver(true);

        // 氷面: ハウス、ホグライン、サイドライン、ハックを描く
        sheetGraphics.clear();
        sheetGraphics
          .moveTo(world.sidelineLeft, world.topBoundaryY)
          .lineTo(world.sidelineLeft, world.hackY + world.stoneRadius * 4)
          .stroke({ width: 2, color: 0x2a3a4a, alpha: 0.6 });
        sheetGraphics
          .moveTo(world.sidelineRight, world.topBoundaryY)
          .lineTo(world.sidelineRight, world.hackY + world.stoneRadius * 4)
          .stroke({ width: 2, color: 0x2a3a4a, alpha: 0.6 });
        sheetGraphics
          .moveTo(world.sidelineLeft, world.hogLineY)
          .lineTo(world.sidelineRight, world.hogLineY)
          .stroke({ width: 3, color: 0xffb454, alpha: 0.55 });

        sheetGraphics
          .circle(world.houseX, world.houseY, world.houseOuterRadius)
          .fill({ color: HOUSE_OUTER_COLOR, alpha: 0.22 });
        sheetGraphics
          .circle(world.houseX, world.houseY, world.houseMidRadius)
          .fill({ color: HOUSE_MID_COLOR, alpha: 0.16 });
        sheetGraphics
          .circle(world.houseX, world.houseY, world.houseInnerRadius)
          .fill({ color: HOUSE_INNER_COLOR, alpha: 0.32 });
        sheetGraphics
          .circle(world.houseX, world.houseY, world.houseButtonRadius)
          .fill({ color: HOUSE_BUTTON_COLOR, alpha: 0.85 });
        sheetGraphics
          .circle(world.houseX, world.houseY, world.houseOuterRadius)
          .stroke({ width: 2, color: HOUSE_OUTER_COLOR, alpha: 0.7 });

        // ハックの目印は常にゆっくり明滅させ、待機中でも氷面が生きていると分かるようにする
        const hackPulse = 0.55 + Math.sin(elapsedSeconds * 2.4) * 0.35;
        sheetGraphics.circle(world.hackX, world.hackY, world.stoneRadius * 0.6).stroke({
          width: 2,
          color: 0x6ee7ff,
          alpha: world.isReadyToThrow ? hackPulse : 0.25,
        });

        // 狙いのプレビュー(投球準備中のみ)。破線を流して「狙い中」であることを示す。
        aimGraphics.clear();
        if (world.isReadyToThrow) {
          const { vx, vy } = computeAimVelocity();
          const preview = world.previewTrajectory(vx, vy, spinRef.current);
          const dashOffset = Math.floor(elapsedSeconds * 24);
          let prev = { x: world.hackX, y: world.hackY };
          for (let i = 0; i < preview.length; i++) {
            const point = preview[i];
            if ((i + dashOffset) % 2 === 0) {
              aimGraphics
                .moveTo(prev.x, prev.y)
                .lineTo(point.x, point.y)
                .stroke({ width: 2, color: 0xffe066, alpha: Math.max(0.12, 0.75 - i * 0.006) });
            }
            prev = point;
          }
        }

        // 石を描く
        stoneGraphics.clear();
        for (const stone of world.stones) {
          drawStone(stoneGraphics, stone, world.stoneRadius, sweepActive);
        }
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => {
          if (world.isReadyToThrow && pointerAimId === null) {
            pointerAimId = pointer.id;
            pointerAnchor = { x: pointer.x, y: pointer.y };
            return;
          }
          isPointerHeld = true;
        },
        onPointerMove: (pointer) => {
          if (pointer.id !== pointerAimId) return;
          const dx = pointer.x - pointerAnchor.x;
          const dy = pointer.y - pointerAnchor.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 2) return;
          aimAngle = Math.atan2(-dy, -dx);
          aimPower = Math.min(1, dist / world.maxDrag);
        },
        onPointerUp: (pointer) => {
          if (pointer.id === pointerAimId) {
            pointerAimId = null;
            const dist = Math.hypot(pointer.x - pointerAnchor.x, pointer.y - pointerAnchor.y);
            if (dist >= MIN_LAUNCH_DRAG && !loop.isPaused) {
              const { vx, vy } = computeAimVelocity();
              world.launch(vx, vy, spinRef.current);
            }
            return;
          }
          isPointerHeld = false;
        },
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
          } else if (key === "enter") {
            if (world.isReadyToThrow && !loop.isPaused) {
              const { vx, vy } = computeAimVelocity();
              world.launch(vx, vy, spinRef.current);
            }
          } else if (key === "r") {
            world.reset();
            setIsOver(false);
            setEndBanner(null);
            setBurnMessage(null);
          } else if (key === "1") {
            applySpin(-1);
          } else if (key === "2") {
            applySpin(1);
          }
        },
      });

      loopRef.current = loop;
      loop.start();
    })();

    return () => {
      disposed = true;
      if (endBannerTimer) clearTimeout(endBannerTimer);
      if (burnMessageTimer) clearTimeout(burnMessageTimer);
      loopRef.current?.stop();
      loopRef.current = null;
      inputRef.current?.dispose();
      inputRef.current = null;
      if (appRef.current) {
        appRef.current.destroy(true, { children: true });
        appRef.current = null;
      }
    };
  }, [applySpin]);

  useEffect(() => {
    if (size.width === 0 || size.height === 0) return;
    worldRef.current?.resize(size.width, size.height);
  }, [size.width, size.height]);

  const handleTogglePause = () => {
    if (!loopRef.current) return;
    setIsPaused(loopRef.current.togglePause());
  };

  const handleRestart = () => {
    worldRef.current?.reset();
    setIsOver(false);
    setEndBanner(null);
    setBurnMessage(null);
    if (loopRef.current?.isPaused) {
      loopRef.current.resume();
      setIsPaused(false);
    }
  };

  const handleToggleSpin = () => {
    applySpin(spin === 1 ? -1 : 1);
  };

  return (
    <GameShell
      title="Frost Curl"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="frost-curl-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} />
        <div className={styles.hud}>
          <span className={styles.end} data-testid="frost-curl-end">
            END {endNumber} / {totalEnds}
          </span>
          <span className={styles.stonesLeft} data-testid="frost-curl-stones-left">
            残り石 {stonesLeft}
          </span>
          <span
            className={`${styles.sweepBadge} ${isSweepingActive ? styles.sweepBadgeActive : ""}`}
            data-testid="frost-curl-sweep-indicator"
          >
            {isSweepingActive ? "スイープ中" : "スイープ待機"}
          </span>
        </div>
        <button
          type="button"
          className={styles.spinToggle}
          onClick={handleToggleSpin}
          data-testid="frost-curl-spin-toggle"
        >
          {spinLabel(spin)}
        </button>
        <div className={styles.hint}>
          ドラッグして引っ張り、離すとストーンを逆方向へ投球(矢印キー+Enterでも可)。
          飛行中は画面を長押し/Sキー長押しでスイープして摩擦とカールを抑えられる。
          ハウス中心に近いほど高得点。ホグライン(オレンジの線)を越えないとバーンされ無効になる。
        </div>
        {endBanner && (
          <div className={styles.endBanner} data-testid="frost-curl-end-banner">
            END {endBanner.endNumber} 終了 +{endBanner.points}
          </div>
        )}
        {burnMessage && (
          <div className={styles.burnBanner} data-testid="frost-curl-burn-banner">
            {burnMessage}
          </div>
        )}
        {isOver && (
          <div className={styles.gameOver} data-testid="frost-curl-game-over">
            <div className={styles.gameOverTitle}>全エンド終了</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="frost-curl-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}

function drawStone(
  graphics: Graphics,
  stone: Stone,
  radius: number,
  isSweepingActive: boolean,
): void {
  if (isSweepingActive && stone.isMoving) {
    graphics.circle(stone.x, stone.y, radius * 1.8).fill({ color: SWEEP_GLOW_COLOR, alpha: 0.18 });
  }
  const color = stone.owner === "player" ? PLAYER_COLOR : GUARD_COLOR;
  graphics.circle(stone.x, stone.y, radius).fill({ color, alpha: 0.96 });
  graphics
    .circle(stone.x, stone.y, radius)
    .stroke({ width: 2, color: stone.owner === "player" ? 0x2f6fed : 0x3a3f4d, alpha: 0.85 });
  graphics.circle(stone.x, stone.y, radius * 0.32).fill({ color: 0x1b2138, alpha: 0.85 });
}
