"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import styles from "./DohyoDuelGame.module.scss";
import {
  type BoutEndEvent,
  DOHYO_DUEL_START_LIVES,
  DohyoDuelWorld,
  type OpponentShoveEvent,
  type PlayerShoveEvent,
} from "./engine/world";

const RING_VISUAL_SCALE = 1.4; // 判定に使う半径より少し広く土俵を見せる
const WRESTLER_GAP = 34; // せめぎ合いの中心から両者の中心までの距離
const WRESTLER_RADIUS = 30;
const BAR_WIDTH_RATIO = 0.34;

const PLAYER_COLOR = 0x6ee7ff;
const OPPONENT_COLOR = 0xff6b6b;
const READY_COLOR = 0xffd166;
const DANGER_COLOR = 0xff6b6b;
const SAFE_COLOR = 0x7cf5c4;

const POPUP_LIFETIME = 0.9;

interface FloatingPopup {
  text: Text;
  age: number;
}

export function DohyoDuelGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [round, setRound] = useState(1);
  const [winStreak, setWinStreak] = useState(0);
  const [lives, setLives] = useState(DOHYO_DUEL_START_LIVES);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<DohyoDuelWorld | null>(null);
  const appRef = useRef<Application | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const sizeRef = useRef({ width: 0, height: 0 });

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

  const handleChargeStart = useCallback(() => {
    if (!worldRef.current || loopRef.current?.isPaused) return;
    worldRef.current.startCharging();
  }, []);

  const handleChargeRelease = useCallback(() => {
    if (!worldRef.current || loopRef.current?.isPaused) return;
    worldRef.current.releaseCharge();
  }, []);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    let disposed = false;

    const app = new Application();
    const world = new DohyoDuelWorld(1, 1);
    worldRef.current = world;

    const ringGraphics = new Graphics();
    const wrestlerGraphics = new Graphics();
    const gaugeGraphics = new Graphics();
    const popupHost = new Container();
    const floatingPopups: FloatingPopup[] = [];
    // 土俵と俵の模様はリサイズ時以外変化しないため、毎フレーム再描画せずキャッシュする
    // (低スペック環境でフレーム供給が遅れると経過時間の取りこぼしが増えるため)。
    let lastDrawnRingKey = "";

    const spawnPopup = (label: string, color: number, x: number, y: number, fontSize = 18) => {
      const text = new Text({ text: label, style: { fill: color, fontSize, fontWeight: "800" } });
      text.anchor.set(0.5, 0.5);
      text.position.set(x, y);
      popupHost.addChild(text);
      floatingPopups.push({ text, age: 0 });
    };

    world.onPlayerShove = ({ isPoke, isCounterBonus }: PlayerShoveEvent) => {
      const { width, height } = sizeRef.current;
      const label = isCounterBonus ? "会心の反撃!" : isPoke ? "突き" : "押し!";
      spawnPopup(label, isCounterBonus ? READY_COLOR : PLAYER_COLOR, width / 2, height * 0.4);
    };
    world.onOpponentShove = ({ caughtPlayerCharging }: OpponentShoveEvent) => {
      const { width, height } = sizeRef.current;
      spawnPopup(
        caughtPlayerCharging ? "崩された!" : "押された",
        OPPONENT_COLOR,
        width / 2,
        height * 0.4,
      );
    };
    world.onBoutEnd = ({ didPlayerWin, round: finishedRound }: BoutEndEvent) => {
      const { width, height } = sizeRef.current;
      spawnPopup(
        didPlayerWin ? `${finishedRound}番勝負 勝ち!` : "土俵を割った…",
        didPlayerWin ? SAFE_COLOR : DANGER_COLOR,
        width / 2,
        height * 0.3,
        24,
      );
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x0c0a08,
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
      app.stage.addChild(ringGraphics, wrestlerGraphics, gaugeGraphics, popupHost);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        world.step(deltaSeconds);

        setScore(world.score);
        setRound(world.round);
        setWinStreak(world.winStreak);
        setLives(world.lives);
        if (world.isOver) setIsOver(true);

        const { width, height } = sizeRef.current;
        if (width > 0 && height > 0) {
          const centerX = width / 2;
          const centerY = height * 0.56;
          const visualRadius = world.ringRadius * RING_VISUAL_SCALE;
          const clampedDisplacement = Math.max(
            -world.ringRadius,
            Math.min(world.ringRadius, world.displacement),
          );
          const pairCenterX = centerX + clampedDisplacement;

          const ringKey = `${centerX}|${centerY}|${visualRadius}|${world.ringRadius}`;
          if (ringKey !== lastDrawnRingKey) {
            lastDrawnRingKey = ringKey;
            ringGraphics.clear();
            ringGraphics
              .circle(centerX, centerY, visualRadius)
              .fill({ color: 0x2a1d12, alpha: 0.9 })
              .circle(centerX, centerY, visualRadius)
              .stroke({ width: 4, color: 0xd9a35c, alpha: 0.8 });
            const tawaraCount = 20;
            for (let i = 0; i < tawaraCount; i++) {
              const angle = (i / tawaraCount) * Math.PI * 2;
              ringGraphics
                .circle(
                  centerX + Math.cos(angle) * visualRadius,
                  centerY + Math.sin(angle) * visualRadius,
                  4,
                )
                .fill({ color: 0xd9a35c, alpha: 0.9 });
            }
            ringGraphics
              .circle(centerX - world.ringRadius, centerY, 5)
              .fill({ color: SAFE_COLOR, alpha: 0.5 })
              .circle(centerX + world.ringRadius, centerY, 5)
              .fill({ color: DANGER_COLOR, alpha: 0.5 });
          }

          const opponentX = pairCenterX - WRESTLER_GAP;
          const playerX = pairCenterX + WRESTLER_GAP;
          wrestlerGraphics.clear();
          wrestlerGraphics
            .moveTo(opponentX, centerY)
            .lineTo(playerX, centerY)
            .stroke({ width: 6, color: 0xffffff, alpha: 0.25 });
          wrestlerGraphics
            .circle(opponentX, centerY, WRESTLER_RADIUS)
            .fill({ color: OPPONENT_COLOR, alpha: 0.9 })
            .circle(playerX, centerY, WRESTLER_RADIUS)
            .fill({ color: PLAYER_COLOR, alpha: 0.9 });

          const barWidth = Math.min(width * BAR_WIDTH_RATIO, 260);
          const barHeight = 10;
          const chargeBarX = centerX + width * 0.02;
          const chargeBarY = height * 0.82;
          gaugeGraphics.clear();
          gaugeGraphics
            .roundRect(chargeBarX, chargeBarY, barWidth, barHeight, 5)
            .fill({ color: 0x161b26, alpha: 0.85 });
          gaugeGraphics
            .roundRect(chargeBarX, chargeBarY, barWidth * world.chargeRatio, barHeight, 5)
            .fill({
              color: world.chargeRatio >= 1 ? READY_COLOR : PLAYER_COLOR,
              alpha: 0.95,
            });

          const tensionBarX = centerX - width * 0.02 - barWidth;
          const tensionBarY = height * 0.82;
          gaugeGraphics
            .roundRect(tensionBarX, tensionBarY, barWidth, barHeight, 5)
            .fill({ color: 0x161b26, alpha: 0.85 });
          gaugeGraphics
            .roundRect(
              tensionBarX,
              tensionBarY,
              barWidth * world.opponentTensionRatio,
              barHeight,
              5,
            )
            .fill({
              color: world.opponentTensionRatio >= 0.85 ? DANGER_COLOR : OPPONENT_COLOR,
              alpha: 0.95,
            });
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
        onPointerDown: () => {
          handleChargeStart();
        },
        onPointerUp: () => {
          handleChargeRelease();
        },
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
          } else if (key === "r") {
            world.reset();
            setIsOver(false);
          } else if (key === "enter") {
            handleChargeStart();
          }
        },
        onKeyUp: (key) => {
          if (key === "enter") {
            handleChargeRelease();
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
  }, [handleChargeStart, handleChargeRelease]);

  useEffect(() => {
    sizeRef.current = { width: size.width, height: size.height };
    if (size.width === 0 || size.height === 0) return;
    worldRef.current?.resize(size.width, size.height);
  }, [size.width, size.height]);

  return (
    <GameShell
      title="Dohyo Duel"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="dohyo-duel-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="dohyo-duel-canvas" />
        <div className={styles.hud}>
          <span className={styles.round} data-testid="dohyo-duel-round">
            ROUND {round}
          </span>
          <span className={styles.streak} data-testid="dohyo-duel-streak">
            連勝 {winStreak}
          </span>
          <span className={styles.lives} data-testid="dohyo-duel-lives">
            {"♥".repeat(Math.max(0, lives))}
            {"♡".repeat(Math.max(0, DOHYO_DUEL_START_LIVES - lives))}
          </span>
        </div>
        <div className={styles.hint}>
          長押しでためて離すと押し込める。相手の突き(左のゲージ)が来た直後に押し返すと会心の反撃になる。ため中に突かれると大きく押し込まれるので注意。土俵の外(左右の点)まで押し切れば勝ち。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="dohyo-duel-gameover">
            <div className={styles.gameOverTitle}>行司軍配、相手に上がる</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <div className={styles.gameOverSub}>到達ラウンド {round}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="dohyo-duel-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
