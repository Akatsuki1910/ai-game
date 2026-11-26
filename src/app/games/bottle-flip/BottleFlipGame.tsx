"use client";

import { Application, Container, Graphics } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import styles from "./BottleFlipGame.module.scss";
import { BottleFlipWorld, type FlipOutcome, type FlipResultEvent } from "./engine/world.ts";

const OUTCOME_LABEL: Record<FlipOutcome, string> = {
  perfect: "PERFECT!",
  good: "OK",
  fail: "FAIL",
};

const BODY_COLOR = 0x2e9bd6;
const CAP_COLOR = 0xffe066;
const RESULT_DISPLAY_SECONDS = 1.1;
const CHARGE_RAMP_PER_SECOND = 1.1;

export function BottleFlipGame() {
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [combo, setCombo] = useState(0);
  const [bestCombo, setBestCombo] = useState(0);
  const [chargeRatio, setChargeRatio] = useState(0);
  const [resultLabel, setResultLabel] = useState<string | null>(null);
  const [resultOutcome, setResultOutcome] = useState<FlipOutcome | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<BottleFlipWorld | null>(null);
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
    setResultLabel(null);
    setResultOutcome(null);
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
    const world = new BottleFlipWorld();
    worldRef.current = world;

    const tableGraphics = new Graphics();
    const bottleGraphics = new Graphics();
    const bottleContainer = new Container();
    bottleContainer.addChild(bottleGraphics);

    let charge = 0;
    let isCharging = false;
    let maxDragDistance = 160;
    let drawnBottleWidth = -1;
    let drawnBottleHeight = -1;
    let flightAnim: { event: FlipResultEvent; age: number } | null = null;
    let resultAge: number | null = null;

    const releaseFlip = () => {
      if (!isCharging) return;
      isCharging = false;
      if (loopRef.current?.isPaused) {
        charge = 0;
        return;
      }
      const event = world.attemptFlip(charge);
      charge = 0;
      flightAnim = { event, age: 0 };
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
      app.stage.addChild(tableGraphics, bottleContainer);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds, elapsedSeconds) => {
        if (input.isKeyDown("arrowup") || input.isKeyDown("w")) {
          isCharging = true;
          charge = Math.min(1, charge + deltaSeconds * CHARGE_RAMP_PER_SECOND);
        } else if (input.isKeyDown("arrowdown") || input.isKeyDown("s")) {
          charge = Math.max(0, charge - deltaSeconds * CHARGE_RAMP_PER_SECOND);
        }

        setScore(world.score);
        setLives(world.lives);
        setCombo(world.combo);
        setBestCombo(world.bestCombo);
        setChargeRatio(isCharging ? charge : 0);
        if (world.isOver) setIsOver(true);

        const screenWidth = app.screen.width;
        const screenHeight = app.screen.height;
        maxDragDistance = Math.max(80, Math.min(260, Math.min(screenWidth, screenHeight) * 0.4));

        const tableY = screenHeight * 0.8;
        const centerX = screenWidth / 2;
        const maxHopHeight = screenHeight * 0.52;
        const bottleWidth = Math.max(18, Math.min(screenWidth, screenHeight) * 0.09);
        const bottleHeight = bottleWidth * 2.6;

        if (drawnBottleWidth !== bottleWidth || drawnBottleHeight !== bottleHeight) {
          drawnBottleWidth = bottleWidth;
          drawnBottleHeight = bottleHeight;
          bottleGraphics.clear();
          const bodyTop = -bottleHeight / 2 + bottleHeight * 0.16;
          const bodyHeight = bottleHeight * 0.84;
          bottleGraphics
            .roundRect(-bottleWidth / 2, bodyTop, bottleWidth, bodyHeight, bottleWidth * 0.22)
            .fill({ color: BODY_COLOR, alpha: 0.9 })
            .stroke({ width: 2, color: 0xffffff, alpha: 0.35 });
          bottleGraphics
            .rect(
              -bottleWidth * 0.22,
              -bottleHeight / 2 + bottleHeight * 0.03,
              bottleWidth * 0.44,
              bottleHeight * 0.14,
            )
            .fill({ color: BODY_COLOR, alpha: 0.9 });
          bottleGraphics
            .rect(-bottleWidth * 0.26, -bottleHeight / 2, bottleWidth * 0.52, bottleHeight * 0.05)
            .fill({ color: CAP_COLOR });
        }

        let bottleAngle = 0;
        // 待機中もわずかに呼吸するように揺らし、操作していない間も画面が動いて見えるようにする。
        const idleBob = Math.sin(elapsedSeconds * 1.8) * bottleHeight * 0.025;
        let bottleCenterY = tableY - bottleHeight / 2 + idleBob;

        if (flightAnim) {
          flightAnim.age += deltaSeconds;
          const duration = Math.max(0.0001, flightAnim.event.flightDuration);
          const t = Math.min(1, flightAnim.age / duration);
          const heightRatio = 4 * t * (1 - t);
          bottleCenterY = tableY - bottleHeight / 2 - heightRatio * maxHopHeight;
          bottleAngle = flightAnim.event.rotations * 2 * Math.PI * t;
          if (t >= 1) {
            resultAge = 0;
            const outcome = flightAnim.event.outcome;
            const label = `${OUTCOME_LABEL[outcome]} ${flightAnim.event.rotations.toFixed(2)}回転`;
            setResultLabel(label);
            setResultOutcome(outcome);
            flightAnim = null;
          }
        } else if (isCharging) {
          bottleAngle = Math.sin(elapsedSeconds * 9) * charge * 0.1;
        } else {
          bottleAngle = Math.sin(elapsedSeconds * 1.8) * 0.035;
        }

        if (resultAge !== null) {
          resultAge += deltaSeconds;
          if (resultAge >= RESULT_DISPLAY_SECONDS) {
            resultAge = null;
            setResultLabel(null);
            setResultOutcome(null);
          }
        }

        bottleContainer.position.set(centerX, bottleCenterY);
        bottleContainer.rotation = bottleAngle;

        tableGraphics.clear();
        tableGraphics.rect(0, tableY, screenWidth, Math.max(4, screenHeight - tableY)).fill({
          color: 0x0b0c10,
          alpha: 0.92,
        });
        tableGraphics.rect(0, tableY - 3, screenWidth, 3).fill({ color: 0x2b2f3a });
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
          releaseFlip();
        },
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
          } else if (key === "r") {
            world.reset();
            setIsOver(false);
            setResultLabel(null);
            setResultOutcome(null);
          } else if (key === "enter") {
            releaseFlip();
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
      title="Bottle Flip"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
      pauseHint="タップ / Space キーで再開"
    >
      <div className={styles.stageInner} data-testid="bottle-flip-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="bottle-flip-canvas" />
        <div className={styles.hud}>
          <span className={styles.badge} data-testid="bottle-flip-lives">
            {"♥".repeat(Math.max(0, lives)) || "-"}
          </span>
          <span className={styles.badge} data-testid="bottle-flip-combo">
            COMBO {combo}
          </span>
          <span className={styles.badge} data-testid="bottle-flip-best-combo">
            BEST {bestCombo}
          </span>
        </div>
        <div className={styles.chargeRow}>
          <span className={styles.meterLabel}>チャージ</span>
          <div className={styles.meterTrack} data-testid="bottle-flip-charge">
            <div className={styles.meterFillCharge} style={{ width: `${chargeRatio * 100}%` }} />
          </div>
        </div>
        {resultLabel && (
          <div
            className={`${styles.resultBanner} ${resultOutcome ? styles[resultOutcome] : ""}`}
            data-testid="bottle-flip-result"
          >
            {resultLabel}
          </div>
        )}
        <div className={styles.hint}>
          ドラッグ/長押しでチャージし、離すとボトルを投げ上げる。ちょうど整数回転(1,2,3…回)で着地すると立って成功、外れるとライフが減る。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="bottle-flip-gameover">
            <div className={styles.gameOverTitle}>ライフが尽きた</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="bottle-flip-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
