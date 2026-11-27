"use client";

import { Application, Graphics } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import { LANE_RATIOS, PeriscopeStrikeWorld } from "./engine/world.ts";
import styles from "./PeriscopeStrikeGame.module.scss";

const SHIP_COLOR = 0xffb454;
const TORPEDO_COLOR = 0xf2f3f5;
const AIM_COLOR = 0x6ee7ff;
const SPOTTED_DISPLAY_SECONDS = 1.0;
const AIM_MOVE_PER_SECOND = 420; // 矢印キーで照準を動かす速さ(px/秒)

export function PeriscopeStrikeGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [combo, setCombo] = useState(0);
  const [detectionRatio, setDetectionRatio] = useState(0);
  const [isSpotted, setIsSpotted] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<PeriscopeStrikeWorld | null>(null);
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
    setIsSpotted(false);
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
    const world = new PeriscopeStrikeWorld(1, 1);
    worldRef.current = world;

    const seaGraphics = new Graphics();
    const shipGraphics = new Graphics();
    const torpedoGraphics = new Graphics();
    const aimGraphics = new Graphics();

    let isAimKeyHeld = false;
    let spottedAge: number | null = null;

    world.onSpotted = () => {
      spottedAge = 0;
      setIsSpotted(true);
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x040a10,
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
      app.stage.addChild(seaGraphics, shipGraphics, torpedoGraphics, aimGraphics);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        if (isAimKeyHeld && world.isAiming) {
          const direction = input.isKeyDown("arrowleft") || input.isKeyDown("a") ? -1 : 1;
          world.updateAim(world.aimX + direction * AIM_MOVE_PER_SECOND * deltaSeconds);
        }

        world.step(deltaSeconds);
        setScore(world.score);
        setLives(world.lives);
        setCombo(world.combo);
        setDetectionRatio(world.detection / 100);
        if (world.isOver) setIsOver(true);

        if (spottedAge !== null) {
          spottedAge += deltaSeconds;
          if (spottedAge >= SPOTTED_DISPLAY_SECONDS) {
            spottedAge = null;
            setIsSpotted(false);
          }
        }

        const width = app.screen.width;
        const height = app.screen.height;

        seaGraphics.clear();
        seaGraphics.rect(0, 0, width, height).fill({ color: 0x06141c });
        for (const ratio of LANE_RATIOS) {
          const y = height * ratio;
          seaGraphics
            .moveTo(0, y)
            .lineTo(width, y)
            .stroke({ width: 1, color: 0x2b2f3a, alpha: 0.6 });
        }

        shipGraphics.clear();
        for (const ship of world.ships) {
          const facing = ship.vx >= 0 ? 1 : -1;
          const hullWidth = ship.radius * 1.9;
          const hullHeight = ship.radius * 0.9;
          shipGraphics
            .moveTo(ship.x - (hullWidth / 2) * facing, ship.y)
            .lineTo(ship.x + (hullWidth / 2) * facing, ship.y)
            .lineTo(ship.x + (hullWidth / 2 - hullHeight) * facing, ship.y - hullHeight)
            .lineTo(ship.x - (hullWidth / 2) * facing, ship.y - hullHeight)
            .closePath()
            .fill({ color: SHIP_COLOR, alpha: 0.92 })
            .stroke({ width: 2, color: 0xffffff, alpha: 0.3 });
        }

        torpedoGraphics.clear();
        for (const torpedo of world.torpedoes) {
          torpedoGraphics
            .moveTo(torpedo.x, torpedo.y)
            .lineTo(torpedo.x, Math.min(height, torpedo.y + 36))
            .stroke({ width: 3, color: TORPEDO_COLOR, alpha: 0.4 });
          torpedoGraphics.circle(torpedo.x, torpedo.y, 5).fill({ color: TORPEDO_COLOR });
        }

        aimGraphics.clear();
        if (world.isAiming) {
          aimGraphics
            .moveTo(world.aimX, height)
            .lineTo(world.aimX, 0)
            .stroke({ width: 2, color: AIM_COLOR, alpha: 0.35 });
          aimGraphics
            .circle(world.aimX, height * 0.12, 14)
            .stroke({ width: 2, color: AIM_COLOR, alpha: 0.9 });
          aimGraphics
            .moveTo(world.aimX - 20, height * 0.12)
            .lineTo(world.aimX + 20, height * 0.12)
            .stroke({ width: 1, color: AIM_COLOR, alpha: 0.6 });
        }
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => {
          world.startAiming(pointer.x);
        },
        onPointerMove: (pointer) => {
          world.updateAim(pointer.x);
        },
        onPointerUp: () => {
          world.releaseAndFire();
        },
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
          } else if (key === "r") {
            world.reset();
            setIsOver(false);
            setIsSpotted(false);
          } else if (key === "enter" && !world.isAiming) {
            world.startAiming(world.aimX);
          } else if (key === "arrowleft" || key === "arrowright" || key === "a" || key === "d") {
            isAimKeyHeld = true;
          }
        },
        onKeyUp: (key) => {
          if (key === "enter") {
            world.releaseAndFire();
          } else if (key === "arrowleft" || key === "arrowright" || key === "a" || key === "d") {
            isAimKeyHeld = false;
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
      title="Periscope Strike"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="periscope-strike-stage">
        <div
          ref={canvasHostRef}
          className={styles.canvasHost}
          data-testid="periscope-strike-canvas"
        />
        <div className={styles.hud}>
          <span className={styles.badge} data-testid="periscope-strike-lives">
            {"♥".repeat(Math.max(0, lives)) || "-"}
          </span>
          <span className={styles.badge} data-testid="periscope-strike-combo">
            COMBO {combo}
          </span>
        </div>
        <div className={styles.detectionRow}>
          <span className={styles.meterLabel}>発見度</span>
          <div className={styles.meterTrack} data-testid="periscope-strike-detection">
            <div
              className={styles.meterFillDetection}
              style={{ width: `${detectionRatio * 100}%` }}
            />
          </div>
        </div>
        {isSpotted && (
          <div className={styles.spottedBanner} data-testid="periscope-strike-spotted">
            発見された!
          </div>
        )}
        <div className={styles.hint}>
          押し続けてペリスコープを上げ、ドラッグで照準を左右に動かす。離すと魚雷発射。動く船は未来位置を見越して狙おう。構えっぱなしだと発見度が満ちてライフが減る。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="periscope-strike-gameover">
            <div className={styles.gameOverTitle}>撃沈された</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="periscope-strike-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
