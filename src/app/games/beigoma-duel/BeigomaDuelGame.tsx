"use client";

import { Application, Graphics } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import styles from "./BeigomaDuelGame.module.scss";
import { BeigomaDuelWorld, MAX_SPIN, STARTING_LIVES } from "./engine/world";

const PLAYER_COLOR = 0x6ee7ff;
const OPPONENT_COLOR = 0xff6b6b;
const AIM_STEP = Math.PI / 24;
const POWER_STEP = 0.08;

export function BeigomaDuelGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [round, setRound] = useState(1);
  const [lives, setLives] = useState(STARTING_LIVES);
  const [playerSpinPercent, setPlayerSpinPercent] = useState(100);
  const [opponentSpinPercent, setOpponentSpinPercent] = useState(100);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);
  const [roundMessage, setRoundMessage] = useState<string | null>(null);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<BeigomaDuelWorld | null>(null);
  const appRef = useRef<Application | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const roundMessageTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    const world = new BeigomaDuelWorld(1, 1);
    worldRef.current = world;

    const bowlGraphics = new Graphics();
    const topsGraphics = new Graphics();
    let drawnBowlRadius = -1;

    world.onRoundResult = (result) => {
      if (roundMessageTimeoutRef.current) clearTimeout(roundMessageTimeoutRef.current);
      setRoundMessage(result === "win" ? "勝利! 次の相手へ" : "ライフを1失った");
      roundMessageTimeoutRef.current = setTimeout(() => setRoundMessage(null), 1200);
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x05060a,
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
      app.stage.addChild(bowlGraphics, topsGraphics);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        world.step(deltaSeconds);
        setScore(Math.floor(world.score));
        setRound(world.round);
        setLives(world.lives);
        setPlayerSpinPercent(Math.round(world.player.spin));
        setOpponentSpinPercent(Math.round(world.opponent.spin));
        if (world.isOver) setIsOver(true);

        if (drawnBowlRadius !== world.bowlRadius) {
          drawnBowlRadius = world.bowlRadius;
          bowlGraphics
            .clear()
            .circle(world.bowlX, world.bowlY, world.bowlRadius)
            .fill({ color: 0x11141c })
            .circle(world.bowlX, world.bowlY, world.bowlRadius)
            .stroke({ width: 4, color: 0x3a3f4d });
        }

        topsGraphics.clear();

        if (world.playerIsCharging && world.playerChargePower > 0) {
          const length = 36 + world.playerChargePower * 90;
          topsGraphics
            .moveTo(world.player.x, world.player.y)
            .lineTo(
              world.player.x + Math.cos(world.playerAimAngle) * length,
              world.player.y + Math.sin(world.playerAimAngle) * length,
            )
            .stroke({ width: 3, color: PLAYER_COLOR, alpha: 0.75 });
        }

        for (const [top, color] of [
          [world.opponent, OPPONENT_COLOR],
          [world.player, PLAYER_COLOR],
        ] as const) {
          const spinRatio = Math.max(0, top.spin) / MAX_SPIN;
          const startAngle = -Math.PI / 2;
          topsGraphics
            .arc(top.x, top.y, top.radius + 7, startAngle, startAngle + spinRatio * Math.PI * 2)
            .stroke({ width: 4, color });
          topsGraphics
            .circle(top.x, top.y, top.radius)
            .fill({ color, alpha: 0.85 })
            .stroke({ width: 2, color: 0xffffff, alpha: 0.6 });
        }
      }, 0.1);

      input.addListener({
        onPointerDown: () => {
          world.beginCharge();
        },
        onPointerMove: (pointer) => {
          if (!world.playerIsCharging) return;
          world.setAimFromDrag(pointer.x - pointer.startX, pointer.y - pointer.startY);
        },
        onPointerUp: () => {
          if (!world.playerIsCharging) return;
          world.endCharge();
          world.launchThrust();
        },
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
          } else if (key === "r") {
            world.reset();
            setIsOver(false);
          } else if (key === "arrowleft" || key === "a") {
            world.adjustAim(-AIM_STEP);
          } else if (key === "arrowright" || key === "d") {
            world.adjustAim(AIM_STEP);
          } else if (key === "arrowup" || key === "w") {
            world.adjustPower(POWER_STEP);
          } else if (key === "arrowdown" || key === "s") {
            world.adjustPower(-POWER_STEP);
          } else if (key === "enter") {
            world.launchThrust();
          }
        },
      });

      loopRef.current = loop;
      loop.start();
    })();

    return () => {
      disposed = true;
      if (roundMessageTimeoutRef.current) clearTimeout(roundMessageTimeoutRef.current);
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
      title="Beigoma Duel"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="beigoma-duel-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="beigoma-duel-canvas" />
        <div className={styles.hud}>
          <span className={styles.badge} data-testid="beigoma-duel-round">
            ROUND {round}
          </span>
          <span className={styles.badge} data-testid="beigoma-duel-lives">
            {"❤".repeat(Math.max(0, lives))}
            {"♡".repeat(Math.max(0, STARTING_LIVES - lives))}
          </span>
        </div>
        <div className={styles.duelBar}>
          <span
            className={styles.spinGauge}
            data-testid="beigoma-duel-player-spin"
            style={{ borderColor: "#6ee7ff" }}
          >
            YOU {playerSpinPercent}%
          </span>
          <span
            className={styles.spinGauge}
            data-testid="beigoma-duel-opponent-spin"
            style={{ borderColor: "#ff6b6b" }}
          >
            敵 {opponentSpinPercent}%
          </span>
        </div>
        {roundMessage && (
          <div className={styles.roundMessage} data-testid="beigoma-duel-round-message">
            {roundMessage}
          </div>
        )}
        <div className={styles.hint}>
          ドラッグして引っ張り、離すと逆方向へ発射(自分のベーゴマを加速)。相手のスピンを0にすれば勝ち、自分のスピンが0になるとライフが1減る。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="beigoma-duel-gameover">
            <div className={styles.gameOverTitle}>力尽きた…</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="beigoma-duel-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
