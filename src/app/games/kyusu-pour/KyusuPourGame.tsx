"use client";

import { Application } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import {
  BELT_Y,
  CUP_GRADE,
  type CupGrade,
  KyusuPourWorld,
  LIFE_LOST_REASON,
  MAX_LIVES,
  SPILL_MAX,
  SPOUT_X,
} from "./engine/world";
import styles from "./KyusuPourGame.module.scss";
import { GRADE_COLORS, SceneRenderer } from "./sceneRenderer";

// Enter はフォーカス中のボタン(一時停止など)を押してしまうため注ぐキーにしない。
const POUR_KEYS = ["arrowdown", "s"] as const;

const GRADE_LABELS: Readonly<Record<CupGrade, string>> = {
  [CUP_GRADE.perfect]: "ぴったり!",
  [CUP_GRADE.good]: "いい感じ",
  [CUP_GRADE.short]: "少ない…",
  [CUP_GRADE.over]: "入れすぎ!",
};

export function KyusuPourGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(MAX_LIVES);
  const [spillPercent, setSpillPercent] = useState(0);
  const [combo, setCombo] = useState(0);
  const [servedCount, setServedCount] = useState(0);
  const [lastGrade, setLastGrade] = useState<CupGrade | null>(null);
  const [hasNextCup, setHasNextCup] = useState(false);
  const [isCupUnderSpout, setIsCupUnderSpout] = useState(false);
  const [gaugeFill, setGaugeFill] = useState(0);
  const [gaugePending, setGaugePending] = useState(0);
  const [gaugeTarget, setGaugeTarget] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<KyusuPourWorld | null>(null);
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
    const world = new KyusuPourWorld();
    worldRef.current = world;
    const scene = new SceneRenderer();

    world.onCupServed = ({ grade, points, x }) => {
      const label = points > 0 ? `${GRADE_LABELS[grade]} +${points}` : GRADE_LABELS[grade];
      scene.showPopup(
        label,
        GRADE_COLORS[grade],
        x * app.screen.width,
        BELT_Y * app.screen.height * 0.62,
      );
    };
    world.onLifeLost = (reason) => {
      if (reason !== LIFE_LOST_REASON.spilled) return;
      scene.showPopup("こぼしすぎ!", 0xff6b6b, app.screen.width / 2, app.screen.height * 0.2);
    };
    world.onSpill = (y) => scene.addSplash(SPOUT_X * app.screen.width, y * app.screen.height);

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x0b0c10,
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
      app.stage.addChild(scene.root);
      appRef.current = app;
      world.resize(app.screen.width, app.screen.height);

      const input = new InputManager(app.canvas);
      inputRef.current = input;
      // InputManager はボタンを押していないホバー中の移動でもポインタを保持するため、
      // getPointers() ではなく down〜up の間だけを「押している」とみなす。
      const pressedPointerIds = new Set<number>();

      const loop = new GameLoop((deltaSeconds) => {
        const isKeyPouring = POUR_KEYS.some((key) => input.isKeyDown(key));
        world.setPouring(pressedPointerIds.size > 0 || isKeyPouring);
        world.step(deltaSeconds);
        scene.render(world, app.screen.width, app.screen.height, deltaSeconds);

        setScore(world.score);
        setLives(world.lives);
        setSpillPercent(Math.round((world.spilled / SPILL_MAX) * 100));
        setCombo(world.combo);
        setServedCount(world.servedCount);
        setLastGrade(world.lastGrade);
        const cup = world.nextCup;
        setHasNextCup(cup !== null);
        if (cup) {
          setIsCupUnderSpout(world.isUnderSpout(cup));
          setGaugeFill(Math.round((cup.filled / cup.capacity) * 100));
          setGaugePending(Math.round((world.pendingVolume / cup.capacity) * 100));
          setGaugeTarget(Math.round(cup.targetRatio * 100));
        }
        if (world.isOver) setIsOver(true);
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => pressedPointerIds.add(pointer.id),
        onPointerUp: (pointer) => pressedPointerIds.delete(pointer.id),
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
          } else if (key === "r") {
            world.reset();
            setIsOver(false);
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
      title="Kyusu Pour"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="kyusu-pour-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="kyusu-pour-canvas" />
        <div className={styles.hud}>
          <span className={styles.readout} data-testid="kyusu-pour-lives">
            ライフ {lives}/{MAX_LIVES}
          </span>
          <div className={styles.spillBar}>
            <span className={styles.spillLabel}>こぼれ</span>
            <div className={styles.spillTrack}>
              <div className={styles.spillFill} style={{ width: `${spillPercent}%` }} />
            </div>
            <span className={styles.spillValue} data-testid="kyusu-pour-spill">
              {spillPercent}%
            </span>
          </div>
          <span className={styles.readout} data-testid="kyusu-pour-served">
            提供 {servedCount}杯{combo > 0 ? ` / コンボ ×${combo}` : ""}
          </span>
          {hasNextCup && (
            <span
              className={styles.gauge}
              data-testid="kyusu-pour-gauge"
              data-under-spout={isCupUnderSpout}
            >
              {isCupUnderSpout ? "受け中" : "次の湯呑み"} {gaugeFill}%（+{gaugePending}%）／目標{" "}
              {gaugeTarget}%
            </span>
          )}
          {lastGrade && (
            <span
              className={styles.grade}
              data-testid="kyusu-pour-last-grade"
              data-grade={lastGrade}
            >
              {GRADE_LABELS[lastGrade]}
            </span>
          )}
        </div>
        <div className={styles.hint}>
          長押しで急須を傾けて注ぐ（↓/S キー長押しでも可）。お茶は落ちるのに時間がかかるので、
          湯呑みの到着を先読みし、空中の分（+%）も見越して白い線で止めよう。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="kyusu-pour-gameover">
            <div className={styles.gameOverTitle}>閉店</div>
            <div className={styles.gameOverScore}>
              SCORE {score.toLocaleString("ja-JP")} / {servedCount}杯
            </div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="kyusu-pour-restart"
            >
              もう一度淹れる
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
