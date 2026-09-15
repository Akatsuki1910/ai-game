"use client";

import { Application, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import { FireflyWorld, TAP_ENERGY_COST } from "./engine/world";
import styles from "./FireflySyncGame.module.scss";

const COLOR_BG = 0x060912;
const COLOR_BOUNDARY = 0x1c2a3a;
const COLOR_DIM = 0x2c3a26;
const COLOR_BRIGHT = 0xe4ffab;
const COLOR_CORE_PEAK = 0xffffff;
const COLOR_RIPPLE_OK = 0xbdf2ff;
const COLOR_RIPPLE_DENIED = 0xff6b6b;

const RIPPLE_LIFETIME = 0.55;
const RIPPLE_MAX_RADIUS_FRAC = 0.16;

interface Ripple {
  x: number;
  y: number;
  age: number;
  accepted: boolean;
}

interface FloatingLabel {
  text: Text;
  age: number;
}

const LABEL_LIFETIME = 1.1;

function mixColor(colorA: number, colorB: number, t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  const ar = (colorA >> 16) & 0xff;
  const ag = (colorA >> 8) & 0xff;
  const ab = colorA & 0xff;
  const br = (colorB >> 16) & 0xff;
  const bg = (colorB >> 8) & 0xff;
  const bb = colorB & 0xff;
  const r = Math.round(ar + (br - ar) * clamped);
  const g = Math.round(ag + (bg - ag) * clamped);
  const b = Math.round(ab + (bb - ab) * clamped);
  return (r << 16) | (g << 8) | b;
}

function flashBrightness(phase: number): number {
  return Math.max(0, Math.cos(phase * Math.PI * 2)) ** 6;
}

export function FireflySyncGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [night, setNight] = useState(1);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [chorusPercent, setChorusPercent] = useState(0);
  const [syncPercent, setSyncPercent] = useState(0);
  const [energyPercent, setEnergyPercent] = useState(100);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<FireflyWorld | null>(null);
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
    const world = new FireflyWorld(1, 1);
    worldRef.current = world;

    const boundaryGraphics = new Graphics();
    // GPUのBlurFilterは重いため使わず、半径の異なる半透明の円を加算合成で
    // 重ねるだけの軽量なグロー表現にする(モバイル相当のCPUでもコマ落ちしないように)。
    const glowGraphics = new Graphics();
    glowGraphics.blendMode = "add";
    const coreGraphics = new Graphics();
    const rippleGraphics = new Graphics();

    const ripples: Ripple[] = [];
    const floatingLabels: FloatingLabel[] = [];

    const spawnLabel = (label: string): void => {
      const text = new Text({
        text: label,
        style: { fill: COLOR_BRIGHT, fontSize: 20, fontWeight: "700" },
      });
      text.anchor.set(0.5, 0.5);
      text.position.set(
        world.offsetX + world.arenaSize / 2,
        world.offsetY + world.arenaSize * 0.28,
      );
      app.stage.addChild(text);
      floatingLabels.push({ text, age: 0 });
    };

    world.onNightCleared = ({ night: clearedNight, scoreGained }) => {
      spawnLabel(`夜${clearedNight} クリア！ +${scoreGained}`);
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: COLOR_BG,
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
      app.stage.addChild(boundaryGraphics, glowGraphics, coreGraphics, rippleGraphics);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const attemptPulse = (x: number, y: number): void => {
        const accepted = world.applyPulseAtStagePoint(x, y);
        ripples.push({ x, y, age: 0, accepted });
      };

      let hudUpdateTimer = 0;

      const loop = new GameLoop((deltaSeconds) => {
        world.step(deltaSeconds);

        // HUDの数値更新は毎フレーム(60Hz)である必要はないため間引く。
        // 見た目の滑らかさが要る描画(pixiのGraphics)は毎フレーム続ける。
        hudUpdateTimer += deltaSeconds;
        if (hudUpdateTimer >= 0.1 || world.isOver) {
          hudUpdateTimer = 0;
          setScore(world.score);
          setNight(world.night);
          setTimeRemaining(world.timeRemaining);
          setChorusPercent(Math.round(world.chorusMeter * 100));
          setSyncPercent(Math.round(world.orderParameter * 100));
          setEnergyPercent(Math.round(world.energy * 100));
          if (world.isOver) setIsOver(true);
        }

        boundaryGraphics.clear();
        boundaryGraphics
          .roundRect(world.offsetX, world.offsetY, world.arenaSize, world.arenaSize, 24)
          .stroke({ width: 1.5, color: COLOR_BOUNDARY, alpha: 0.6 });

        glowGraphics.clear();
        coreGraphics.clear();
        const baseRadius = Math.max(2, world.arenaSize * 0.012);
        for (const firefly of world.fireflies) {
          const brightness = flashBrightness(firefly.phase);
          const x = world.offsetX + firefly.x;
          const y = world.offsetY + firefly.y;
          const color = mixColor(COLOR_DIM, COLOR_BRIGHT, brightness);

          glowGraphics
            .circle(x, y, baseRadius * (5 + brightness * 4))
            .fill({ color, alpha: 0.04 + brightness * 0.12 })
            .circle(x, y, baseRadius * (2.2 + brightness * 3.5))
            .fill({ color, alpha: 0.12 + brightness * 0.35 });

          const coreColor = mixColor(color, COLOR_CORE_PEAK, brightness * 0.6);
          coreGraphics
            .circle(x, y, baseRadius * (0.7 + brightness * 0.6))
            .fill({ color: coreColor, alpha: 0.55 + brightness * 0.45 });
        }

        rippleGraphics.clear();
        const rippleMaxRadius = world.arenaSize * RIPPLE_MAX_RADIUS_FRAC;
        for (let i = ripples.length - 1; i >= 0; i--) {
          const ripple = ripples[i];
          ripple.age += deltaSeconds;
          if (ripple.age >= RIPPLE_LIFETIME) {
            ripples.splice(i, 1);
            continue;
          }
          const progress = ripple.age / RIPPLE_LIFETIME;
          const radius = ripple.accepted ? progress * rippleMaxRadius : progress * baseRadius * 6;
          const alpha = (1 - progress) * (ripple.accepted ? 0.8 : 0.6);
          rippleGraphics.circle(ripple.x, ripple.y, radius).stroke({
            width: 2,
            color: ripple.accepted ? COLOR_RIPPLE_OK : COLOR_RIPPLE_DENIED,
            alpha,
          });
        }

        for (let i = floatingLabels.length - 1; i >= 0; i--) {
          const entry = floatingLabels[i];
          entry.age += deltaSeconds;
          entry.text.position.y -= deltaSeconds * 22;
          entry.text.alpha = Math.max(0, 1 - entry.age / LABEL_LIFETIME);
          if (entry.age >= LABEL_LIFETIME) {
            app.stage.removeChild(entry.text);
            entry.text.destroy();
            floatingLabels.splice(i, 1);
          }
        }
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => {
          if (loop.isPaused || world.isOver) return;
          attemptPulse(pointer.x, pointer.y);
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
          if (key === "enter") {
            if (loop.isPaused || world.isOver) return;
            attemptPulse(world.offsetX + world.arenaSize / 2, world.offsetY + world.arenaSize / 2);
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

  const isEnergyReady = energyPercent >= Math.round(TAP_ENERGY_COST * 100);

  return (
    <GameShell
      title="Firefly Sync"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="firefly-sync-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="firefly-sync-canvas" />
        <div className={styles.hud}>
          <span className={styles.night} data-testid="firefly-sync-night" data-night={night}>
            夜 {night}
          </span>
          <span
            className={styles.timer}
            data-testid="firefly-sync-timer"
            data-remaining={Math.ceil(timeRemaining)}
          >
            残り {Math.ceil(timeRemaining)}秒
          </span>
        </div>
        <div className={styles.meters}>
          <div className={styles.meterRow}>
            <span className={styles.meterLabel}>合唱</span>
            <div
              className={styles.meterTrack}
              data-testid="firefly-sync-chorus"
              data-chorus={chorusPercent}
            >
              <div className={styles.meterFillChorus} style={{ width: `${chorusPercent}%` }} />
            </div>
          </div>
          <div className={styles.meterRow}>
            <span className={styles.meterLabel}>同調</span>
            <div
              className={styles.meterTrack}
              data-testid="firefly-sync-sync"
              data-sync={syncPercent}
            >
              <div className={styles.meterFillSync} style={{ width: `${syncPercent}%` }} />
            </div>
          </div>
          <div className={styles.meterRow}>
            <span className={styles.meterLabel}>光</span>
            <div
              className={styles.meterTrack}
              data-testid="firefly-sync-energy"
              data-energy={energyPercent}
              data-ready={isEnergyReady}
            >
              <div className={styles.meterFillEnergy} style={{ width: `${energyPercent}%` }} />
            </div>
          </div>
        </div>
        <div className={styles.hint}>
          タップ/クリックで光のパルスを送り、ホタルの明滅を仲間の合唱へ引き寄せよう。パルスにはエネルギーが必要で少しずつ回復する。合唱計が満ちる前に日が沈むと夜が終わる。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="firefly-sync-gameover">
            <div className={styles.gameOverTitle}>夜が明けきらず、日が沈んだ…</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <div className={styles.gameOverSub}>{night}夜目で終了</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="firefly-sync-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
