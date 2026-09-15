"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import styles from "./BellowsForgeGame.module.scss";
import {
  BELLOWS_FORGE_START_QUALITY,
  BellowsForgeWorld,
  type PieceCompleteEvent,
  type ScorchEvent,
  type StrikeEvent,
} from "./engine/world";

const EMBER_RADIUS = 44;
const GAUGE_WIDTH_RATIO = 0.7;
const MAX_GAUGE_WIDTH = 420;
const GAUGE_HEIGHT = 22;
const POPUP_LIFETIME = 0.9;

const SUCCESS_COLOR = 0x7cf5c4;
const COLD_COLOR = 0x6ee7ff;
const HOT_COLOR = 0xff6b6b;
const GOLD_COLOR = 0xffd166;

interface FloatingPopup {
  text: Text;
  age: number;
}

/** 温度(0〜1)を「冷たい青→赤→橙→黄→白熱」へ滑らかに補間する。 */
function temperatureToColor(ratio: number): number {
  const stops: Array<{ at: number; color: [number, number, number] }> = [
    { at: 0, color: [0x22, 0x33, 0xff] },
    { at: 0.3, color: [0xff, 0x22, 0x22] },
    { at: 0.55, color: [0xff, 0x88, 0x00] },
    { at: 0.8, color: [0xff, 0xe0, 0x66] },
    { at: 1, color: [0xff, 0xff, 0xff] },
  ];
  const clamped = Math.min(1, Math.max(0, ratio));
  let lower = stops[0];
  let upper = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (clamped >= stops[i].at && clamped <= stops[i + 1].at) {
      lower = stops[i];
      upper = stops[i + 1];
      break;
    }
  }
  const span = upper.at - lower.at;
  const localT = span > 0 ? (clamped - lower.at) / span : 0;
  const r = Math.round(lower.color[0] + (upper.color[0] - lower.color[0]) * localT);
  const g = Math.round(lower.color[1] + (upper.color[1] - lower.color[1]) * localT);
  const b = Math.round(lower.color[2] + (upper.color[2] - lower.color[2]) * localT);
  return (r << 16) | (g << 8) | b;
}

export function BellowsForgeGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [round, setRound] = useState(1);
  const [quality, setQuality] = useState(BELLOWS_FORGE_START_QUALITY);
  const [hitsLanded, setHitsLanded] = useState(0);
  const [hitsRequired, setHitsRequired] = useState(0);
  const [temperature, setTemperature] = useState(0);
  const [targetMin, setTargetMin] = useState(0);
  const [targetMax, setTargetMax] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<BellowsForgeWorld | null>(null);
  const appRef = useRef<Application | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  const pumpSourcesRef = useRef<Set<string>>(new Set());

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

  const addPumpSource = useCallback((source: string) => {
    if (!worldRef.current || loopRef.current?.isPaused) return;
    const sources = pumpSourcesRef.current;
    const wasEmpty = sources.size === 0;
    sources.add(source);
    if (wasEmpty) worldRef.current.startPumping();
  }, []);

  const removePumpSource = useCallback((source: string) => {
    if (!worldRef.current) return;
    const sources = pumpSourcesRef.current;
    sources.delete(source);
    if (sources.size === 0) worldRef.current.stopPumping();
  }, []);

  const handleStrike = useCallback(() => {
    if (!worldRef.current || loopRef.current?.isPaused) return;
    worldRef.current.strike();
  }, []);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    let disposed = false;

    const app = new Application();
    const world = new BellowsForgeWorld();
    worldRef.current = world;

    const gaugeGraphics = new Graphics();
    const sceneGraphics = new Graphics();
    const popupHost = new Container();
    const floatingPopups: FloatingPopup[] = [];

    const spawnPopup = (label: string, color: number, x: number, y: number, fontSize = 20) => {
      const text = new Text({ text: label, style: { fill: color, fontSize, fontWeight: "800" } });
      text.anchor.set(0.5, 0.5);
      text.position.set(x, y);
      popupHost.addChild(text);
      floatingPopups.push({ text, age: 0 });
    };

    world.onStrike = ({ isSuccess, isTooCold, scoreGained }: StrikeEvent) => {
      const { width, height } = sizeRef.current;
      const emberX = width / 2;
      const emberY = height * 0.62;
      if (isSuccess) {
        spawnPopup(`成功! +${scoreGained}`, SUCCESS_COLOR, emberX, emberY - EMBER_RADIUS - 12);
      } else if (isTooCold) {
        spawnPopup("冷たすぎる…", COLD_COLOR, emberX, emberY - EMBER_RADIUS - 12);
      } else {
        spawnPopup("熱すぎる!", HOT_COLOR, emberX, emberY - EMBER_RADIUS - 12);
      }
    };
    world.onScorch = (_event: ScorchEvent) => {
      const { width, height } = sizeRef.current;
      spawnPopup("焦げついた!", HOT_COLOR, width / 2, height * 0.62, 24);
    };
    world.onPieceComplete = ({ round: finishedRound }: PieceCompleteEvent) => {
      const { width, height } = sizeRef.current;
      spawnPopup(`${finishedRound}作目 完成!`, GOLD_COLOR, width / 2, height * 0.3, 24);
    };
    world.onGameOver = () => setIsOver(true);

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
      app.stage.addChild(sceneGraphics, gaugeGraphics, popupHost);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        world.step(deltaSeconds);

        setScore(world.score);
        setRound(world.round);
        setQuality(world.quality);
        setHitsLanded(world.hitsLanded);
        setHitsRequired(world.hitsRequired);
        setTemperature(world.temperature);
        setTargetMin(world.targetMin);
        setTargetMax(world.targetMax);
        if (world.isOver) setIsOver(true);

        const { width, height } = sizeRef.current;
        if (width > 0 && height > 0) {
          const centerX = width / 2;
          const emberY = height * 0.62;
          const emberColor = temperatureToColor(world.temperatureRatio);

          sceneGraphics.clear();
          sceneGraphics
            .moveTo(centerX, 0)
            .lineTo(centerX, height)
            .stroke({ width: 1, color: 0xffffff, alpha: 0.08 });

          // 左半分: ふいご(長押しで送風)
          const bellowsX = width * 0.24;
          const bellowsY = height * 0.78;
          const bellowsScale = world.isPumping ? 1.25 : 1;
          sceneGraphics
            .roundRect(
              bellowsX - 34 * bellowsScale,
              bellowsY - 22 * bellowsScale,
              68 * bellowsScale,
              44 * bellowsScale,
              10,
            )
            .fill({ color: world.isPumping ? 0xffb454 : 0x3a3226, alpha: 0.9 })
            .roundRect(
              bellowsX - 34 * bellowsScale,
              bellowsY - 22 * bellowsScale,
              68 * bellowsScale,
              44 * bellowsScale,
              10,
            )
            .stroke({ width: 2, color: 0x9aa0ac, alpha: 0.6 });

          // 右半分: 金づち(タップで打つ)
          const hammerX = width * 0.76;
          const hammerY = height * 0.78;
          sceneGraphics
            .roundRect(hammerX - 6, hammerY - 30, 12, 44, 4)
            .fill({ color: 0x6b4a2f, alpha: 0.95 })
            .roundRect(hammerX - 22, hammerY - 44, 44, 20, 5)
            .fill({ color: 0x9aa0ac, alpha: 0.95 });

          // 中央: 熱している金属(温度で発光色が変わる)
          sceneGraphics
            .circle(centerX, emberY, EMBER_RADIUS)
            .fill({ color: emberColor, alpha: 0.95 })
            .circle(centerX, emberY, EMBER_RADIUS)
            .stroke({ width: 3, color: 0x000000, alpha: 0.5 });

          // 温度ゲージ(目標帯 + 現在温度の針)
          const gaugeWidth = Math.min(width * GAUGE_WIDTH_RATIO, MAX_GAUGE_WIDTH);
          const gaugeX = centerX - gaugeWidth / 2;
          const gaugeY = height * 0.16;
          gaugeGraphics.clear();
          gaugeGraphics
            .roundRect(gaugeX, gaugeY, gaugeWidth, GAUGE_HEIGHT, 6)
            .fill({ color: 0x161b26, alpha: 0.9 });
          const bandX = gaugeX + gaugeWidth * world.bandMinRatio;
          const bandWidth = gaugeWidth * (world.bandMaxRatio - world.bandMinRatio);
          gaugeGraphics
            .roundRect(bandX, gaugeY, Math.max(2, bandWidth), GAUGE_HEIGHT, 4)
            .fill({ color: SUCCESS_COLOR, alpha: 0.45 });
          const needleX = gaugeX + gaugeWidth * world.temperatureRatio;
          gaugeGraphics
            .moveTo(needleX, gaugeY - 6)
            .lineTo(needleX, gaugeY + GAUGE_HEIGHT + 6)
            .stroke({ width: 3, color: emberColor });
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
          const { width } = sizeRef.current;
          if (width <= 0) return;
          if (pointer.x < width / 2) {
            addPumpSource(`pointer:${pointer.id}`);
          } else {
            handleStrike();
          }
        },
        onPointerUp: (pointer) => {
          removePumpSource(`pointer:${pointer.id}`);
        },
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
          } else if (key === "r") {
            world.reset();
            setIsOver(false);
          } else if (key === "w" || key === "arrowup") {
            addPumpSource("keyboard");
          } else if (key === "s" || key === "arrowdown" || key === "enter") {
            handleStrike();
          }
        },
        onKeyUp: (key) => {
          if (key === "w" || key === "arrowup") {
            removePumpSource("keyboard");
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
      pumpSourcesRef.current.clear();
      if (appRef.current) {
        appRef.current.destroy(true, { children: true });
        appRef.current = null;
      }
    };
  }, [addPumpSource, removePumpSource, handleStrike]);

  useEffect(() => {
    sizeRef.current = { width: size.width, height: size.height };
  }, [size.width, size.height]);

  return (
    <GameShell
      title="Bellows Forge"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="bellows-forge-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="bellows-forge-canvas" />
        <div className={styles.hud}>
          <span className={styles.round} data-testid="bellows-forge-round">
            {round}作目
          </span>
          <span className={styles.progress} data-testid="bellows-forge-progress">
            打撃 {hitsLanded}/{hitsRequired}
          </span>
          <span className={styles.temperature} data-testid="bellows-forge-temperature">
            温度 {Math.round(temperature)}° (目標 {Math.round(targetMin)}〜{Math.round(targetMax)}°)
          </span>
          <span className={styles.quality} data-testid="bellows-forge-quality">
            {"♥".repeat(Math.max(0, quality))}
            {"♡".repeat(Math.max(0, BELLOWS_FORGE_START_QUALITY - quality))}
          </span>
        </div>
        <div className={styles.hint}>
          左側を長押しでふいごを送風して温度を上げ、ゲージの緑帯(目標温度)に入ったら右側をタップして打つ。
          帯を外れて打つと品質が減り、送風しすぎて振り切ると焦げついて品質が減る。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="bellows-forge-gameover">
            <div className={styles.gameOverTitle}>金属が使い物にならなくなった…</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <div className={styles.gameOverSub}>到達 {round}作目</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="bellows-forge-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
