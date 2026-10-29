"use client";

import { Application, Graphics } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import styles from "./DarumaDropGame.module.scss";
import { DarumaDropWorld, STABILITY_MAX, type SwingOutcome } from "./engine/world.ts";

const BLOCK_COLORS = [0xe8b84b, 0x6ee7ff, 0x7cf5c4, 0xff8a65, 0xb79cff] as const;
const HEAD_COLOR = 0xe84c4c;
const HEAD_FACE_COLOR = 0xf5ead8;
const FLASH_COLORS: Record<SwingOutcome, number> = {
  "too-weak": 0x6ee7ff,
  perfect: 0x7cf5c4,
  overpower: 0xff6b6b,
};
const FLASH_LIFETIME = 0.35;
const SWING_DURATION = 0.22;
const CHARGE_RAMP_PER_SECOND = 1.4;

export function DarumaDropGame() {
  const [score, setScore] = useState(0);
  const [round, setRound] = useState(1);
  const [combo, setCombo] = useState(0);
  const [stabilityRatio, setStabilityRatio] = useState(1);
  const [swingTimerRatio, setSwingTimerRatio] = useState(1);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<DarumaDropWorld | null>(null);
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
    const world = new DarumaDropWorld();
    worldRef.current = world;

    const towerGraphics = new Graphics();
    const malletGraphics = new Graphics();
    const gaugeGraphics = new Graphics();

    let charge = 0;
    let isCharging = false;
    let swingAnimAge: number | null = null;
    let flash: { outcome: SwingOutcome; age: number } | null = null;
    let maxDragDistance = 160;

    const releaseSwing = () => {
      if (!isCharging) return;
      isCharging = false;
      if (loopRef.current?.isPaused) {
        charge = 0;
        return;
      }
      const event = world.attemptSwing(charge);
      flash = { outcome: event.outcome, age: 0 };
      swingAnimAge = 0;
      charge = 0;
    };

    world.onTimeout = () => {
      flash = { outcome: "too-weak", age: 0 };
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x14161d,
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
      app.stage.addChild(towerGraphics, malletGraphics, gaugeGraphics);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds, elapsedSeconds) => {
        world.step(deltaSeconds);

        if (input.isKeyDown("arrowup") || input.isKeyDown("w")) {
          isCharging = true;
          charge = Math.min(1, charge + deltaSeconds * CHARGE_RAMP_PER_SECOND);
        } else if (input.isKeyDown("arrowdown") || input.isKeyDown("s")) {
          charge = Math.max(0, charge - deltaSeconds * CHARGE_RAMP_PER_SECOND);
        }

        setScore(Math.floor(world.score));
        setRound(world.round);
        setCombo(world.combo);
        setStabilityRatio(world.stability / STABILITY_MAX);
        setSwingTimerRatio(Math.max(0, world.swingTimer / world.swingTimeLimit));
        if (world.isOver) setIsOver(true);

        const screenWidth = app.screen.width;
        const screenHeight = app.screen.height;
        maxDragDistance = Math.max(80, Math.min(260, Math.min(screenWidth, screenHeight) * 0.4));

        if (swingAnimAge !== null) {
          swingAnimAge += deltaSeconds;
          if (swingAnimAge >= SWING_DURATION) swingAnimAge = null;
        }
        if (flash) {
          flash.age += deltaSeconds;
          if (flash.age >= FLASH_LIFETIME) flash = null;
        }

        // --- タワー描画 ---
        towerGraphics.clear();
        const centerX = screenWidth / 2;
        const baseY = screenHeight * 0.86;
        const maxTowerHeight = screenHeight * 0.58;
        const blockHeight = Math.max(8, maxTowerHeight / Math.max(1, world.totalBlocksInRound));
        const blockWidth = Math.min(screenWidth * 0.3, 170);
        const bob = Math.sin(elapsedSeconds * 1.6) * 2.5;

        for (let i = 0; i < world.blocksRemaining; i++) {
          const y = baseY - (i + 1) * blockHeight + bob;
          const isBottom = i === 0;
          const color = BLOCK_COLORS[i % BLOCK_COLORS.length];
          towerGraphics
            .roundRect(centerX - blockWidth / 2, y, blockWidth, blockHeight - 2, 4)
            .fill({ color, alpha: isBottom && swingAnimAge !== null ? 0.6 : 1 })
            .stroke({ width: 2, color: 0x0b0c10, alpha: 0.5 });
          if (isBottom && flash) {
            const alpha = Math.max(0, 1 - flash.age / FLASH_LIFETIME) * 0.7;
            towerGraphics
              .roundRect(centerX - blockWidth / 2, y, blockWidth, blockHeight - 2, 4)
              .fill({ color: FLASH_COLORS[flash.outcome], alpha });
          }
        }

        const headY = baseY - world.blocksRemaining * blockHeight + bob;
        const headRadius = blockWidth * 0.32;
        towerGraphics
          .circle(centerX, headY - headRadius * 0.6, headRadius)
          .fill({ color: HEAD_COLOR });
        towerGraphics
          .circle(centerX, headY - headRadius * 0.6, headRadius * 0.62)
          .fill({ color: HEAD_FACE_COLOR });

        // --- 木槌描画（右側から振る） ---
        malletGraphics.clear();
        const malletPivotX = centerX + blockWidth * 0.5 + 60;
        const malletPivotY = baseY - blockHeight * 0.5 + bob;
        const restAngle = Math.PI * 0.62;
        let angle: number;
        if (swingAnimAge !== null) {
          const t = Math.min(1, swingAnimAge / SWING_DURATION);
          const windup = restAngle + charge * 0.7;
          angle = windup + (restAngle - 1.4 - windup) * Math.sin(t * Math.PI);
        } else {
          angle = restAngle + charge * 0.7;
        }
        const handleLength = 70;
        const headLength = 26;
        const dirX = Math.cos(angle);
        const dirY = Math.sin(angle);
        malletGraphics
          .moveTo(malletPivotX, malletPivotY)
          .lineTo(malletPivotX + dirX * handleLength, malletPivotY + dirY * handleLength)
          .stroke({ width: 6, color: 0x9aa0ac });
        malletGraphics
          .circle(
            malletPivotX + dirX * handleLength,
            malletPivotY + dirY * handleLength,
            headLength * 0.5,
          )
          .fill({ color: 0x6b4f3a });

        // --- チャージゲージ + ウィンドウ表示 ---
        gaugeGraphics.clear();
        const gaugeX = screenWidth * 0.08;
        const gaugeY = screenHeight * 0.12;
        const gaugeWidth = 22;
        const gaugeHeight = screenHeight * 0.6;
        gaugeGraphics
          .roundRect(gaugeX, gaugeY, gaugeWidth, gaugeHeight, 6)
          .fill({ color: 0x0b0c10, alpha: 0.6 })
          .stroke({ width: 2, color: 0x2b2f3a });

        const windowTop = gaugeY + gaugeHeight * (1 - world.currentWindow.max);
        const windowBottom = gaugeY + gaugeHeight * (1 - world.currentWindow.min);
        gaugeGraphics
          .rect(gaugeX, windowTop, gaugeWidth, windowBottom - windowTop)
          .fill({ color: 0x7cf5c4, alpha: 0.45 });

        const chargeY = gaugeY + gaugeHeight * (1 - charge);
        gaugeGraphics
          .rect(gaugeX, chargeY, gaugeWidth, gaugeY + gaugeHeight - chargeY)
          .fill({ color: isCharging ? 0xffe066 : 0x6ee7ff, alpha: 0.85 });
      }, 0.1);

      input.addListener({
        onPointerDown: () => {
          isCharging = true;
          charge = 0;
        },
        onPointerMove: (pointer) => {
          if (!isCharging) return;
          const dragDistance = Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY);
          charge = Math.min(1, dragDistance / maxDragDistance);
        },
        onPointerUp: () => {
          releaseSwing();
        },
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
          } else if (key === "r") {
            world.reset();
            setIsOver(false);
          } else if (key === "enter") {
            releaseSwing();
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
      title="Daruma Drop"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
      pauseHint="タップ / Space キーで再開"
    >
      <div className={styles.stageInner} data-testid="daruma-drop-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="daruma-drop-canvas" />
        <div className={styles.hud}>
          <span className={styles.badge} data-testid="daruma-drop-round">
            ROUND {round}
          </span>
          <span className={styles.badge} data-testid="daruma-drop-combo">
            COMBO {combo}
          </span>
        </div>
        <div className={styles.meters}>
          <div className={styles.meterRow}>
            <span className={styles.meterLabel}>安定度</span>
            <div className={styles.meterTrack} data-testid="daruma-drop-stability">
              <div
                className={styles.meterFillStability}
                style={{ width: `${Math.max(0, stabilityRatio) * 100}%` }}
              />
            </div>
          </div>
          <div className={styles.meterRow}>
            <span className={styles.meterLabel}>残り時間</span>
            <div className={styles.meterTrack} data-testid="daruma-drop-swing-timer">
              <div
                className={styles.meterFillTimer}
                style={{ width: `${Math.max(0, swingTimerRatio) * 100}%` }}
              />
            </div>
          </div>
        </div>
        <div className={styles.hint}>
          ドラッグ/長押しで木槌を引いて離すと振り下ろす。緑のウィンドウにパワーを合わせて最下段を抜こう。弱すぎても強すぎても安定度が減る。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="daruma-drop-gameover">
            <div className={styles.gameOverTitle}>タワーが崩れた</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="daruma-drop-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
