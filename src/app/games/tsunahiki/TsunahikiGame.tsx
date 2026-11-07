"use client";

import { Application, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import {
  APPROACH_SECONDS,
  GOOD_WINDOW_SECONDS,
  type PullMissedEvent,
  type PullResultEvent,
  ROPE_MAX,
  ROPE_START,
  TsunahikiWorld,
} from "./engine/world.ts";
import styles from "./TsunahikiGame.module.scss";

const RIVAL_COLOR = 0xff6b6b;
const PLAYER_COLOR = 0x6ee7ff;
const ROPE_COLOR = 0xc9a66b;
const KNOT_COLOR = 0xffd166;
const JUDGE_RING_COLOR = 0x9aa0ac;
const JUDGE_READY_COLOR = 0xffd166;
const LANE_COLOR = 0x2b2f3a;
const PERFECT_COLOR = 0x7cf5c4;
const GOOD_COLOR = 0xffd166;
const MISS_COLOR = 0xff6b6b;
const CLEAR_COLOR = 0x7cf5c4;

const ANCHOR_PADDING_RATIO = 0.14;
const ROPE_Y_RATIO = 0.32;
const LANE_Y_RATIO = 0.64;
const JUDGE_X_RATIO = 0.5;
const SPAWN_X_RATIO = 0.95;
const BEAT_SIZE_RATIO = 0.03;

const POPUP_LIFETIME = 0.9;
const PULSE_LIFETIME = 0.35;

interface FloatingPopup {
  text: Text;
  age: number;
}

function beatX(progress: number, width: number): number {
  const spawnX = width * SPAWN_X_RATIO;
  const judgeX = width * JUDGE_X_RATIO;
  return spawnX - progress * (spawnX - judgeX);
}

export function TsunahikiGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [round, setRound] = useState(1);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [ropePosition, setRopePosition] = useState(ROPE_START);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);
  const [isReady, setIsReady] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<TsunahikiWorld | null>(null);
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

  const handlePull = useCallback(() => {
    if (!worldRef.current || loopRef.current?.isPaused) return;
    worldRef.current.pull();
  }, []);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    let disposed = false;

    const app = new Application();
    const world = new TsunahikiWorld();
    worldRef.current = world;

    const sceneGraphics = new Graphics();
    const laneGraphics = new Graphics();
    const beatGraphics = new Graphics();
    const floatingPopups: FloatingPopup[] = [];

    let pulse: { color: number; age: number } | null = null;
    let shake: { age: number } | null = null;

    const spawnPopup = (label: string, color: number, fontSize: number, yOffset = 0): void => {
      const { width, height } = sizeRef.current;
      const text = new Text({ text: label, style: { fill: color, fontSize, fontWeight: "700" } });
      text.anchor.set(0.5, 0.5);
      text.position.set(width * 0.5, height * LANE_Y_RATIO - 56 + yOffset);
      app.stage.addChild(text);
      floatingPopups.push({ text, age: 0 });
    };

    world.onPullResolved = ({
      judgement,
      scoreGained,
      combo: comboCount,
      roundWon,
    }: PullResultEvent) => {
      const color = judgement === "perfect" ? PERFECT_COLOR : GOOD_COLOR;
      const label =
        comboCount > 1
          ? `${judgement.toUpperCase()} +${scoreGained} x${comboCount}`
          : `${judgement.toUpperCase()} +${scoreGained}`;
      spawnPopup(label, color, 18);
      pulse = { color, age: 0 };
      if (roundWon) {
        spawnPopup("引き切った! ラウンドクリア", CLEAR_COLOR, 20, -32);
      }
    };
    world.onPullMissed = ({ reason }: PullMissedEvent) => {
      const label = reason === "timeout" ? "MISS (見逃し)" : "MISS (タイミング)";
      spawnPopup(label, MISS_COLOR, 16);
      shake = { age: 0 };
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x121a12,
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
      app.stage.addChild(sceneGraphics, laneGraphics, beatGraphics);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        world.step(deltaSeconds);

        setScore(world.score);
        setRound(world.round);
        setCombo(world.combo);
        setMaxCombo(world.maxCombo);
        setRopePosition(world.ropePosition);
        if (world.isOver) setIsOver(true);

        if (pulse) {
          pulse.age += deltaSeconds;
          if (pulse.age >= PULSE_LIFETIME) pulse = null;
        }
        if (shake) {
          shake.age += deltaSeconds;
          if (shake.age >= PULSE_LIFETIME) shake = null;
        }

        const { width, height } = sizeRef.current;
        if (width > 0 && height > 0) {
          const shakeOffset = shake
            ? Math.sin(shake.age * 70) * 6 * (1 - shake.age / PULSE_LIFETIME)
            : 0;

          const leftX = width * ANCHOR_PADDING_RATIO;
          const rightX = width * (1 - ANCHOR_PADDING_RATIO);
          const ropeY = height * ROPE_Y_RATIO;
          const ratio = world.ropePosition / ROPE_MAX;
          const knotX = leftX + (rightX - leftX) * ratio + shakeOffset;

          sceneGraphics.clear();

          // --- 綱 ---
          sceneGraphics
            .moveTo(leftX, ropeY)
            .lineTo(knotX, ropeY)
            .stroke({ width: 8, color: ROPE_COLOR, alpha: 0.95 });
          sceneGraphics
            .moveTo(knotX, ropeY)
            .lineTo(rightX, ropeY)
            .stroke({ width: 8, color: ROPE_COLOR, alpha: 0.6 });

          // --- 両陣営の旗とチーム ---
          const flagSize = Math.max(16, Math.min(width, height) * 0.045);
          sceneGraphics
            .moveTo(leftX, ropeY)
            .lineTo(leftX, ropeY - flagSize * 2.2)
            .stroke({ width: 3, color: 0xcccccc });
          sceneGraphics
            .poly([
              leftX,
              ropeY - flagSize * 2.2,
              leftX - flagSize,
              ropeY - flagSize * 1.8,
              leftX,
              ropeY - flagSize * 1.4,
            ])
            .fill({ color: RIVAL_COLOR });

          sceneGraphics
            .moveTo(rightX, ropeY)
            .lineTo(rightX, ropeY - flagSize * 2.2)
            .stroke({ width: 3, color: 0xcccccc });
          sceneGraphics
            .poly([
              rightX,
              ropeY - flagSize * 2.2,
              rightX + flagSize,
              ropeY - flagSize * 1.8,
              rightX,
              ropeY - flagSize * 1.4,
            ])
            .fill({ color: PLAYER_COLOR });

          const teamRadius = Math.max(8, flagSize * 0.4);
          const pulseBoost = pulse ? (1 - pulse.age / PULSE_LIFETIME) * teamRadius * 0.4 : 0;
          for (let i = 0; i < 3; i++) {
            const offset = (i - 1) * teamRadius * 1.6;
            sceneGraphics
              .circle(leftX - flagSize * 1.4 - offset * 0.2, ropeY + teamRadius * 0.6, teamRadius)
              .fill({ color: RIVAL_COLOR, alpha: 0.85 });
            sceneGraphics
              .circle(
                rightX + flagSize * 1.4 + offset * 0.2,
                ropeY + teamRadius * 0.6,
                teamRadius + (pulse && pulse.color === PERFECT_COLOR ? pulseBoost : 0),
              )
              .fill({ color: PLAYER_COLOR, alpha: 0.85 });
          }

          // --- 結び目 ---
          sceneGraphics
            .circle(knotX, ropeY, flagSize * 0.5 + (pulse ? pulseBoost : 0))
            .fill({ color: KNOT_COLOR })
            .stroke({ width: 2, color: 0x7a5a1e, alpha: 0.8 });

          // --- 判定レーン ---
          laneGraphics.clear();
          const judgeX = width * JUDGE_X_RATIO;
          const laneY = height * LANE_Y_RATIO;
          laneGraphics
            .moveTo(0, laneY)
            .lineTo(width, laneY)
            .stroke({ width: 3, color: LANE_COLOR, alpha: 0.8 });

          const nearest = world.currentBeat;
          const isNear =
            nearest !== null && Math.abs(nearest.time - world.elapsed) <= GOOD_WINDOW_SECONDS;
          setIsReady(isNear);
          const beatSize = Math.max(14, Math.min(width, height) * BEAT_SIZE_RATIO);
          laneGraphics.circle(judgeX, laneY, beatSize + 10).stroke({
            width: 4,
            color: isNear ? JUDGE_READY_COLOR : JUDGE_RING_COLOR,
            alpha: isNear ? 1 : 0.6,
          });
          laneGraphics
            .circle(judgeX, laneY, beatSize + 10)
            .fill({ color: 0xffffff, alpha: isNear ? 0.1 : 0 });

          beatGraphics.clear();
          for (const beat of world.getVisibleBeats()) {
            const progress = 1 - beat.secondsUntilHit / APPROACH_SECONDS;
            const x = beatX(progress, width);
            beatGraphics
              .circle(x, laneY, beatSize)
              .fill({ color: 0xffd166, alpha: 0.9 })
              .stroke({ width: 2, color: 0x7a5a1e, alpha: 0.6 });
          }
        }

        for (let i = floatingPopups.length - 1; i >= 0; i--) {
          const entry = floatingPopups[i];
          entry.age += deltaSeconds;
          entry.text.position.y -= deltaSeconds * 26;
          entry.text.alpha = Math.max(0, 1 - entry.age / POPUP_LIFETIME);
          if (entry.age >= POPUP_LIFETIME) {
            app.stage.removeChild(entry.text);
            entry.text.destroy();
            floatingPopups.splice(i, 1);
          }
        }
      }, 0.1);

      input.addListener({
        onPointerDown: () => {
          handlePull();
        },
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
            return;
          }
          if (key === "r") {
            world.reset();
            setIsOver(false);
            return;
          }
          if (loop.isPaused) return;
          if (key === "enter") handlePull();
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
  }, [handlePull]);

  useEffect(() => {
    sizeRef.current = { width: size.width, height: size.height };
  }, [size.width, size.height]);

  return (
    <GameShell
      title="Tsunahiki"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="tsunahiki-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="tsunahiki-canvas" />
        <div className={styles.hud}>
          <div className={styles.ropeGauge} data-testid="tsunahiki-rope">
            綱 {Math.round(ropePosition)} / {ROPE_MAX}
            <div className={styles.ropeBarTrack}>
              <div
                className={styles.ropeBarFill}
                style={{ width: `${(ropePosition / ROPE_MAX) * 100}%` }}
              />
            </div>
          </div>
          <span className={styles.badge} data-testid="tsunahiki-round">
            ROUND {round}
          </span>
          {combo >= 2 && (
            <span className={styles.combo} data-testid="tsunahiki-combo">
              COMBO {combo}
            </span>
          )}
        </div>
        <div className={styles.readyHint} data-testid="tsunahiki-ready" data-in-zone={isReady}>
          {isReady ? "ヨイショ! 今だ!" : "掛け声を待とう…"}
        </div>
        <div className={styles.hint}>
          判定リングに掛け声の玉が重なった瞬間にPULL!を押そう。綱が右端(自陣)まで進むとラウンドクリア、左端(相手陣)まで戻るとゲームオーバー。Enter
          キーまたはキャンバスのタップでもPULLできる。Space: 一時停止 / R: リセット。
        </div>
        <button
          type="button"
          className={styles.pullButton}
          data-testid="tsunahiki-pull"
          onPointerDown={handlePull}
        >
          PULL!
        </button>
        {isOver && (
          <div className={styles.gameOver} data-testid="tsunahiki-gameover">
            <div className={styles.gameOverTitle}>綱引きに敗れた…</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <div className={styles.gameOverSub}>
              最大コンボ {maxCombo} / 到達ラウンド {round}
            </div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="tsunahiki-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
