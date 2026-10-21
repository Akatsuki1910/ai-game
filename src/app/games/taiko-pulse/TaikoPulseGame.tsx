"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import {
  APPROACH_SECONDS,
  GOOD_WINDOW_SECONDS,
  type NoteJudgedEvent,
  type NoteMissedEvent,
  type NoteType,
  START_LIVES,
  type StageClearedEvent,
  TaikoPulseWorld,
} from "./engine/world";
import styles from "./TaikoPulseGame.module.scss";

const DON_COLOR = 0xff6b6b;
const KATSU_COLOR = 0x6ee7ff;
const JUDGE_RING_COLOR = 0x9aa0ac;
const JUDGE_READY_COLOR = 0xffd166;
const LANE_COLOR = 0x2b2f3a;
const PERFECT_COLOR = 0x7cf5c4;
const GOOD_COLOR = 0xffd166;
const MISS_COLOR = 0xff6b6b;
const CLEAR_COLOR = 0x7cf5c4;

const JUDGE_X_RATIO = 0.18;
const SPAWN_X_RATIO = 0.95;
const LANE_Y_RATIO = 0.38;
const NOTE_RADIUS_RATIO = 0.045;

const POPUP_LIFETIME = 0.9;

interface FloatingPopup {
  text: Text;
  age: number;
}

const NOTE_COLOR: Record<NoteType, number> = { don: DON_COLOR, katsu: KATSU_COLOR };

function noteX(progress: number, width: number): number {
  const spawnX = width * SPAWN_X_RATIO;
  const judgeX = width * JUDGE_X_RATIO;
  return spawnX - progress * (spawnX - judgeX);
}

export function TaikoPulseGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(START_LIVES);
  const [stage, setStage] = useState(1);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);
  const [readyNoteType, setReadyNoteType] = useState<NoteType | null>(null);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<TaikoPulseWorld | null>(null);
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

  const handleHit = useCallback((type: NoteType) => {
    if (!worldRef.current || loopRef.current?.isPaused) return;
    worldRef.current.hit(type);
  }, []);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    let disposed = false;

    const app = new Application();
    const world = new TaikoPulseWorld();
    worldRef.current = world;

    const laneGraphics = new Graphics();
    const noteGraphics = new Graphics();
    const popupHost = new Container();
    const floatingPopups: FloatingPopup[] = [];

    const spawnPopup = (label: string, color: number, fontSize: number): void => {
      const { width, height } = sizeRef.current;
      const text = new Text({ text: label, style: { fill: color, fontSize, fontWeight: "700" } });
      text.anchor.set(0.5, 0.5);
      text.position.set(width * JUDGE_X_RATIO, height * LANE_Y_RATIO - 48);
      popupHost.addChild(text);
      floatingPopups.push({ text, age: 0 });
    };

    world.onNoteJudged = ({ judgement, points, combo: comboCount }: NoteJudgedEvent) => {
      const color = judgement === "perfect" ? PERFECT_COLOR : GOOD_COLOR;
      const label =
        comboCount > 1
          ? `${judgement.toUpperCase()} +${points} x${comboCount}`
          : `${judgement.toUpperCase()} +${points}`;
      spawnPopup(label, color, 18);
    };
    world.onNoteMissed = ({ reason }: NoteMissedEvent) => {
      const label =
        reason === "wrong"
          ? "MISS (違うボタン)"
          : reason === "timeout"
            ? "MISS (見逃し)"
            : "MISS (タイミング)";
      spawnPopup(label, MISS_COLOR, 16);
    };
    world.onStageCleared = ({ stage: clearedStage, bonus }: StageClearedEvent) => {
      spawnPopup(`STAGE ${clearedStage} CLEAR! +${bonus}`, CLEAR_COLOR, 22);
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x0a0b12,
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
      app.stage.addChild(laneGraphics, noteGraphics, popupHost);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        world.step(deltaSeconds);

        setScore(world.score);
        setLives(world.lives);
        setStage(world.stage);
        setCombo(world.combo);
        setMaxCombo(world.maxCombo);
        if (world.isOver) setIsOver(true);

        const { width, height } = sizeRef.current;
        if (width > 0 && height > 0) {
          const judgeX = width * JUDGE_X_RATIO;
          const laneY = height * LANE_Y_RATIO;
          const noteRadius = Math.max(16, Math.min(width, height) * NOTE_RADIUS_RATIO);

          laneGraphics.clear();
          laneGraphics
            .moveTo(0, laneY)
            .lineTo(width, laneY)
            .stroke({ width: 3, color: LANE_COLOR, alpha: 0.8 });

          const nearest = world.currentNote;
          const isNear =
            nearest !== null && Math.abs(nearest.time - world.elapsed) <= GOOD_WINDOW_SECONDS;
          setReadyNoteType(isNear && nearest ? nearest.type : null);
          const ringColor = isNear && nearest ? NOTE_COLOR[nearest.type] : JUDGE_RING_COLOR;
          laneGraphics.circle(judgeX, laneY, noteRadius + 10).stroke({
            width: 4,
            color: isNear ? JUDGE_READY_COLOR : ringColor,
            alpha: isNear ? 1 : 0.6,
          });
          laneGraphics
            .circle(judgeX, laneY, noteRadius + 10)
            .fill({ color: 0xffffff, alpha: isNear ? 0.08 : 0 });

          noteGraphics.clear();
          for (const note of world.getVisibleNotes()) {
            const progress = 1 - note.secondsUntilHit / APPROACH_SECONDS;
            const x = noteX(progress, width);
            const color = NOTE_COLOR[note.type];
            if (note.type === "don") {
              noteGraphics.circle(x, laneY, noteRadius).fill({ color, alpha: 0.95 });
            } else {
              noteGraphics
                .circle(x, laneY, noteRadius)
                .fill({ color: 0x0a0b12, alpha: 0.9 })
                .stroke({ width: 5, color, alpha: 0.95 });
            }
          }
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
          if (key === "f") handleHit("don");
          else if (key === "j") handleHit("katsu");
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
  }, [handleHit]);

  useEffect(() => {
    sizeRef.current = { width: size.width, height: size.height };
  }, [size.width, size.height]);

  return (
    <GameShell
      title="Taiko Pulse"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="taiko-pulse-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="taiko-pulse-canvas" />
        <div className={styles.hud}>
          <span className={styles.stageLabel} data-testid="taiko-pulse-stage-label">
            STAGE {stage}
          </span>
          <span className={styles.lives} data-testid="taiko-pulse-lives">
            ライフ {lives}
          </span>
          {combo >= 2 && (
            <span className={styles.combo} data-testid="taiko-pulse-combo">
              COMBO {combo}
            </span>
          )}
        </div>
        <div
          className={styles.readyHint}
          data-testid="taiko-pulse-ready"
          data-ready-type={readyNoteType ?? ""}
        >
          {readyNoteType ? `HIT CHANCE: ${readyNoteType === "don" ? "ドン" : "カツ"}` : "待機中"}
        </div>
        <div className={styles.hint}>
          音符が左の判定リングに重なった瞬間にドン(赤・塗りつぶし)はDON、カツ(青・縁取り)はKATSUを叩こう。ボタンが違う・タイミングがずれすぎる・見逃すとミスになる。キーボードはF:ドン/J:カツ。Space:
          一時停止 / R: リセット。
        </div>
        <div className={styles.padRow}>
          <button
            type="button"
            className={styles.donButton}
            data-testid="taiko-pulse-don"
            onPointerDown={() => handleHit("don")}
          >
            DON
          </button>
          <button
            type="button"
            className={styles.katsuButton}
            data-testid="taiko-pulse-katsu"
            onPointerDown={() => handleHit("katsu")}
          >
            KATSU
          </button>
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="taiko-pulse-gameover">
            <div className={styles.gameOverTitle}>演奏終了</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <div className={styles.gameOverSub}>
              到達ステージ {stage} / 最大コンボ {maxCombo}
            </div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="taiko-pulse-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
