"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import {
  APPROACH_SECONDS,
  type CueJudgedEvent,
  type CueMissedEvent,
  GOOD_WINDOW_SECONDS,
  type ScratchDirection,
  START_HYPE,
  VinylScratchWorld,
} from "./engine/world";
import styles from "./VinylScratchGame.module.scss";

const FORWARD_COLOR = 0x6ee7ff;
const BACK_COLOR = 0xff6bcb;
const JUDGE_RING_COLOR = 0x9aa0ac;
const JUDGE_READY_COLOR = 0xffd166;
const LANE_COLOR = 0x2b2f3a;
const PERFECT_COLOR = 0x7cf5c4;
const GOOD_COLOR = 0xffd166;
const MISS_COLOR = 0xff6b6b;

const JUDGE_X_RATIO = 0.22;
const SPAWN_X_RATIO = 0.95;
const LANE_Y_RATIO = 0.72;
const CUE_SIZE_RATIO = 0.045;

const VINYL_CENTER_X_RATIO = 0.22;
const VINYL_CENTER_Y_RATIO = 0.34;
const VINYL_RADIUS_RATIO = 0.16;
const VINYL_BASE_SPIN_PER_SECOND = Math.PI * 0.6;
const VINYL_COMBO_SPIN_BONUS = Math.PI * 0.03;

/** 1フレームあたりのポインタ移動量が、この割合(ステージ幅基準)を超えたらスクラッチ判定を発火する。 */
const DRAG_SCRATCH_THRESHOLD_RATIO = 0.035;

const POPUP_LIFETIME = 0.9;

interface FloatingPopup {
  text: Text;
  age: number;
}

function cueX(progress: number, width: number): number {
  const spawnX = width * SPAWN_X_RATIO;
  const judgeX = width * JUDGE_X_RATIO;
  return spawnX - progress * (spawnX - judgeX);
}

export function VinylScratchGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [hype, setHype] = useState(START_HYPE);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);
  const [readyDirection, setReadyDirection] = useState<ScratchDirection | null>(null);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<VinylScratchWorld | null>(null);
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

  const handleScratch = useCallback((direction: ScratchDirection) => {
    if (!worldRef.current || loopRef.current?.isPaused) return;
    worldRef.current.scratch(direction);
  }, []);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    let disposed = false;

    const app = new Application();
    const world = new VinylScratchWorld();
    worldRef.current = world;

    const vinylContainer = new Container();
    const vinylGraphics = new Graphics();
    const laneGraphics = new Graphics();
    const cueGraphics = new Graphics();
    const popupHost = new Container();
    const floatingPopups: FloatingPopup[] = [];

    let dragPointerId: number | null = null;
    let lastDragX = 0;
    let dragAccumulated = 0;

    const spawnPopup = (label: string, color: number, fontSize: number): void => {
      const { width, height } = sizeRef.current;
      const text = new Text({ text: label, style: { fill: color, fontSize, fontWeight: "700" } });
      text.anchor.set(0.5, 0.5);
      text.position.set(width * JUDGE_X_RATIO, height * LANE_Y_RATIO - 48);
      popupHost.addChild(text);
      floatingPopups.push({ text, age: 0 });
    };

    world.onCueJudged = ({ judgement, points, combo: comboCount }: CueJudgedEvent) => {
      const color = judgement === "perfect" ? PERFECT_COLOR : GOOD_COLOR;
      const label =
        comboCount > 1
          ? `${judgement.toUpperCase()} +${points} x${comboCount}`
          : `${judgement.toUpperCase()} +${points}`;
      spawnPopup(label, color, 18);
    };
    world.onCueMissed = ({ reason }: CueMissedEvent) => {
      const label =
        reason === "wrong"
          ? "MISS (方向違い)"
          : reason === "timeout"
            ? "MISS (見逃し)"
            : "MISS (タイミング)";
      spawnPopup(label, MISS_COLOR, 16);
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
      vinylContainer.addChild(vinylGraphics);
      app.stage.addChild(vinylContainer, laneGraphics, cueGraphics, popupHost);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        world.step(deltaSeconds);

        setScore(world.score);
        setHype(world.hype);
        setCombo(world.combo);
        setMaxCombo(world.maxCombo);
        if (world.isOver) setIsOver(true);

        const { width, height } = sizeRef.current;
        if (width > 0 && height > 0) {
          const vinylCenterX = width * VINYL_CENTER_X_RATIO;
          const vinylCenterY = height * VINYL_CENTER_Y_RATIO;
          const vinylRadius = Math.max(40, Math.min(width, height) * VINYL_RADIUS_RATIO);

          // ビニールは常に回転させる。遊んでいなくても画面が動き続けることが
          // 「ゲームループが生きている」ことの最も分かりやすい手がかりになる。
          vinylContainer.position.set(vinylCenterX, vinylCenterY);
          const spinSpeed =
            VINYL_BASE_SPIN_PER_SECOND + Math.min(world.combo, 20) * VINYL_COMBO_SPIN_BONUS;
          vinylContainer.rotation += spinSpeed * deltaSeconds;

          vinylGraphics.clear();
          vinylGraphics.circle(0, 0, vinylRadius).fill({ color: 0x14161d, alpha: 1 });
          for (let ring = 1; ring <= 4; ring++) {
            vinylGraphics
              .circle(0, 0, (vinylRadius * ring) / 5)
              .stroke({ width: 1, color: 0x2b2f3a, alpha: 0.8 });
          }
          vinylGraphics
            .circle(0, 0, vinylRadius * 0.16)
            .fill({ color: 0x6ee7ff, alpha: 0.9 })
            .stroke({ width: 2, color: 0xffffff, alpha: 0.5 });
          vinylGraphics
            .moveTo(0, -vinylRadius * 0.9)
            .lineTo(0, -vinylRadius * 0.2)
            .stroke({ width: 3, color: 0xffffff, alpha: 0.5 });

          const judgeX = width * JUDGE_X_RATIO;
          const laneY = height * LANE_Y_RATIO;
          const cueSize = Math.max(14, Math.min(width, height) * CUE_SIZE_RATIO);

          laneGraphics.clear();
          laneGraphics
            .moveTo(0, laneY)
            .lineTo(width, laneY)
            .stroke({ width: 3, color: LANE_COLOR, alpha: 0.8 });

          const nearest = world.currentCue;
          const isNear =
            nearest !== null && Math.abs(nearest.time - world.elapsed) <= GOOD_WINDOW_SECONDS;
          setReadyDirection(isNear && nearest ? nearest.direction : null);
          const ringColor =
            isNear && nearest
              ? nearest.direction === "forward"
                ? FORWARD_COLOR
                : BACK_COLOR
              : JUDGE_RING_COLOR;
          laneGraphics.circle(judgeX, laneY, cueSize + 10).stroke({
            width: 4,
            color: isNear ? JUDGE_READY_COLOR : ringColor,
            alpha: isNear ? 1 : 0.6,
          });
          laneGraphics
            .circle(judgeX, laneY, cueSize + 10)
            .fill({ color: 0xffffff, alpha: isNear ? 0.08 : 0 });

          cueGraphics.clear();
          for (const cue of world.getVisibleCues()) {
            const progress = 1 - cue.secondsUntilHit / APPROACH_SECONDS;
            const x = cueX(progress, width);
            const color = cue.direction === "forward" ? FORWARD_COLOR : BACK_COLOR;
            const direction = cue.direction === "forward" ? 1 : -1;
            cueGraphics
              .moveTo(x - direction * cueSize, laneY - cueSize)
              .lineTo(x + direction * cueSize, laneY)
              .lineTo(x - direction * cueSize, laneY + cueSize)
              .closePath()
              .fill({ color, alpha: 0.95 });
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
        onPointerDown: (pointer) => {
          if (dragPointerId !== null) return;
          dragPointerId = pointer.id;
          lastDragX = pointer.x;
          dragAccumulated = 0;
        },
        onPointerMove: (pointer) => {
          if (pointer.id !== dragPointerId || loop.isPaused) return;
          const deltaX = pointer.x - lastDragX;
          lastDragX = pointer.x;
          dragAccumulated += deltaX;

          const { width } = sizeRef.current;
          if (width <= 0) return;
          const threshold = width * DRAG_SCRATCH_THRESHOLD_RATIO;
          if (Math.abs(dragAccumulated) >= threshold) {
            handleScratch(dragAccumulated > 0 ? "forward" : "back");
            dragAccumulated = 0;
          }
        },
        onPointerUp: (pointer) => {
          if (pointer.id !== dragPointerId) return;
          dragPointerId = null;
          dragAccumulated = 0;
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
          if (key === "arrowright" || key === "d") handleScratch("forward");
          else if (key === "arrowleft" || key === "a") handleScratch("back");
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
  }, [handleScratch]);

  useEffect(() => {
    sizeRef.current = { width: size.width, height: size.height };
  }, [size.width, size.height]);

  return (
    <GameShell
      title="Vinyl Scratch"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="vinyl-scratch-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="vinyl-scratch-canvas" />
        <div className={styles.hud}>
          <div className={styles.hypeGauge} data-testid="vinyl-scratch-hype">
            HYPE {hype}
            <div className={styles.hypeBarTrack}>
              <div className={styles.hypeBarFill} style={{ width: `${hype}%` }} />
            </div>
          </div>
          {combo >= 2 && (
            <span className={styles.combo} data-testid="vinyl-scratch-combo">
              COMBO {combo}
            </span>
          )}
        </div>
        <div
          className={styles.readyHint}
          data-testid="vinyl-scratch-ready"
          data-ready-direction={readyDirection ?? ""}
        >
          {readyDirection
            ? `HIT CHANCE: ${readyDirection === "forward" ? "FORWARD" : "BACK"}`
            : "待機中"}
        </div>
        <div className={styles.hint}>
          判定リングにキュー(△)が重なった瞬間、矢印が指す方向へスクラッチしよう。右向き(水色)は
          FORWARD、左向き(桃色)は
          BACK。キャンバスを左右にドラッグするか、下のパッドをタップ/クリック。 キーボードは ←/A:
          BACK・→/D: FORWARD。方向違い・タイミングずれ・見逃しはハイプが減り、 0になると終了。Space:
          一時停止 / R: リセット。
        </div>
        <div className={styles.padRow}>
          <button
            type="button"
            className={styles.backButton}
            data-testid="vinyl-scratch-back"
            onPointerDown={() => handleScratch("back")}
          >
            ◀ BACK
          </button>
          <button
            type="button"
            className={styles.forwardButton}
            data-testid="vinyl-scratch-forward"
            onPointerDown={() => handleScratch("forward")}
          >
            FORWARD ▶
          </button>
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="vinyl-scratch-gameover">
            <div className={styles.gameOverTitle}>フロアが静まり返った…</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <div className={styles.gameOverSub}>最大コンボ {maxCombo}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="vinyl-scratch-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
