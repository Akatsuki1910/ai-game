"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import { type FishCaughtEvent, TAUT_LINE_START_LIVES, TautLineWorld } from "./engine/world";
import styles from "./TautLineGame.module.scss";

const BOAT_X_RATIO = 0.16;
const FISH_MAX_X_RATIO = 0.88;
const LINE_Y_RATIO = 0.55;
const WAVE_ROWS = [0.68, 0.78, 0.88];

const POPUP_LIFETIME = 1.1;

const TENSION_SAFE_COLOR = 0x6ee7ff;
const TENSION_WARN_COLOR = 0xffb454;
const TENSION_DANGER_COLOR = 0xff6b6b;

interface FloatingPopup {
  text: Text;
  age: number;
}

function tensionColorHex(ratio: number): number {
  if (ratio >= 0.85) return TENSION_DANGER_COLOR;
  if (ratio >= 0.6) return TENSION_WARN_COLOR;
  return TENSION_SAFE_COLOR;
}

export function TautLineGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [round, setRound] = useState(1);
  const [lives, setLives] = useState(TAUT_LINE_START_LIVES);
  const [progressPercent, setProgressPercent] = useState(0);
  const [tensionPercent, setTensionPercent] = useState(0);
  const [isFishRunning, setIsFishRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<TautLineWorld | null>(null);
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

  const handleReelStart = useCallback(() => {
    if (!worldRef.current || loopRef.current?.isPaused) return;
    worldRef.current.startReeling();
  }, []);

  const handleReelStop = useCallback(() => {
    if (!worldRef.current || loopRef.current?.isPaused) return;
    worldRef.current.stopReeling();
  }, []);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    let disposed = false;

    const app = new Application();
    const world = new TautLineWorld(1, 1);
    worldRef.current = world;

    const waterGraphics = new Graphics();
    const lineGraphics = new Graphics();
    const boatGraphics = new Graphics();
    const fishGraphics = new Graphics();
    const popupHost = new Container();
    const floatingPopups: FloatingPopup[] = [];

    const spawnPopup = (label: string, color: number, fontSize = 20) => {
      const { width, height } = sizeRef.current;
      const text = new Text({ text: label, style: { fill: color, fontSize, fontWeight: "800" } });
      text.anchor.set(0.5, 0.5);
      text.position.set(width / 2, height * 0.32);
      popupHost.addChild(text);
      floatingPopups.push({ text, age: 0 });
    };

    world.onCatch = ({ points }: FishCaughtEvent) => {
      spawnPopup(`+${points} 水揚げ!`, TENSION_SAFE_COLOR);
    };
    world.onSnap = () => {
      spawnPopup("ラインブレイク…", TENSION_DANGER_COLOR);
    };
    world.onEscape = () => {
      spawnPopup("逃げられた…", TENSION_WARN_COLOR);
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x04141c,
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
      app.stage.addChild(waterGraphics, lineGraphics, boatGraphics, fishGraphics, popupHost);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds, elapsedSeconds) => {
        world.step(deltaSeconds);

        setScore(world.score);
        setRound(world.round);
        setLives(world.lives);
        setProgressPercent(Math.round(world.progressRatio * 100));
        setTensionPercent(Math.round(world.tensionRatio * 100));
        setIsFishRunning(world.isRunning);
        if (world.isOver) setIsOver(true);

        const { width, height } = sizeRef.current;
        if (width > 0 && height > 0) {
          const boatX = width * BOAT_X_RATIO;
          const maxFishX = width * FISH_MAX_X_RATIO;
          const lineY = height * LINE_Y_RATIO;
          const fishX = boatX + world.distanceRatio * (maxFishX - boatX);
          const fishY = lineY + Math.sin(elapsedSeconds * 2.4) * 6;

          waterGraphics.clear();
          for (let row = 0; row < WAVE_ROWS.length; row++) {
            const y = height * WAVE_ROWS[row];
            const amplitude = 5 + row * 2;
            const speed = 1.1 + row * 0.3;
            waterGraphics.moveTo(0, y);
            const segments = 24;
            for (let i = 1; i <= segments; i++) {
              const x = (width * i) / segments;
              const wy = y + Math.sin(elapsedSeconds * speed + i * 0.5 + row) * amplitude;
              waterGraphics.lineTo(x, wy);
            }
            waterGraphics.stroke({ width: 2, color: 0x1a4a5c, alpha: 0.5 - row * 0.1 });
          }

          const tensionColor = tensionColorHex(world.tensionRatio);
          lineGraphics.clear();
          lineGraphics
            .moveTo(boatX, lineY)
            .lineTo(fishX, fishY)
            .stroke({ width: 2 + world.tensionRatio * 2.5, color: tensionColor, alpha: 0.9 });

          boatGraphics.clear();
          boatGraphics
            .poly([
              boatX - 22,
              lineY + 16,
              boatX + 22,
              lineY + 16,
              boatX + 12,
              lineY - 6,
              boatX - 12,
              lineY - 6,
            ])
            .fill({ color: 0xd9a35c, alpha: 0.95 });
          boatGraphics
            .moveTo(boatX, lineY - 6)
            .lineTo(boatX, lineY - 30)
            .stroke({ width: 3, color: 0xd9a35c, alpha: 0.9 });

          const fishScale = world.isRunning ? 1.35 : 1;
          const fishColor = world.isRunning ? TENSION_DANGER_COLOR : 0x7cf5c4;
          fishGraphics.clear();
          fishGraphics
            .ellipse(fishX, fishY, 16 * fishScale, 9 * fishScale)
            .fill({ color: fishColor, alpha: 0.95 });
          fishGraphics
            .poly([
              fishX + 16 * fishScale,
              fishY,
              fishX + 28 * fishScale,
              fishY - 8 * fishScale,
              fishX + 28 * fishScale,
              fishY + 8 * fishScale,
            ])
            .fill({ color: fishColor, alpha: 0.95 });
        }

        for (let i = floatingPopups.length - 1; i >= 0; i--) {
          const entry = floatingPopups[i];
          entry.age += deltaSeconds;
          entry.text.position.y -= deltaSeconds * 24;
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
          handleReelStart();
        },
        onPointerUp: () => {
          handleReelStop();
        },
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
          } else if (key === "r") {
            world.reset();
            setIsOver(false);
          } else if (key === "enter") {
            handleReelStart();
          }
        },
        onKeyUp: (key) => {
          if (key === "enter") {
            handleReelStop();
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
  }, [handleReelStart, handleReelStop]);

  useEffect(() => {
    sizeRef.current = { width: size.width, height: size.height };
    if (size.width === 0 || size.height === 0) return;
    worldRef.current?.resize(size.width, size.height);
  }, [size.width, size.height]);

  return (
    <GameShell
      title="Taut Line"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner}>
        <div ref={canvasHostRef} className={styles.canvasHost} />
        <div className={styles.hud}>
          <span className={styles.round} data-testid="taut-line-round">
            ROUND {round}
          </span>
          <span className={styles.lives} data-testid="taut-line-lives">
            {"♥".repeat(Math.max(0, lives))}
            {"♡".repeat(Math.max(0, TAUT_LINE_START_LIVES - lives))}
          </span>
        </div>
        {isFishRunning && (
          <div className={styles.runWarning} data-testid="taut-line-run-warning">
            魚が走っている!離せ!
          </div>
        )}
        <div className={styles.gauges}>
          <div className={styles.gaugeRow}>
            <span className={styles.gaugeLabel}>巻き具合</span>
            <div className={styles.gaugeTrack}>
              <div
                className={styles.gaugeFill}
                style={{ width: `${progressPercent}%`, backgroundColor: "#7cf5c4" }}
              />
            </div>
            <span data-testid="taut-line-progress">{progressPercent}%</span>
          </div>
          <div className={styles.gaugeRow}>
            <span className={styles.gaugeLabel}>テンション</span>
            <div className={styles.gaugeTrack}>
              <div
                className={styles.gaugeFill}
                style={{
                  width: `${tensionPercent}%`,
                  backgroundColor: tensionPercent >= 85 ? "#ff6b6b" : "#ffb454",
                }}
              />
            </div>
            <span data-testid="taut-line-tension">{tensionPercent}%</span>
          </div>
        </div>
        <div className={styles.hint}>
          長押し(マウス/タッチ/Enterキー長押し)でリールを巻く。魚が走っている間も巻き続けるとラインが切れるので、警告が出たら一度離そう。テンションが上限に達する前に巻き切れば釣れる。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="taut-line-gameover">
            <div className={styles.gameOverTitle}>今日の釣りは終了</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <div className={styles.gameOverSub}>釣った数 {Math.max(0, round - 1)}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="taut-line-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
