"use client";

import { Application, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import styles from "./EmberLoftGame.module.scss";
import {
  EmberLoftWorld,
  LOGICAL_HEIGHT,
  type OrbCollectedEvent,
  WIND_BAND_COUNT,
} from "./engine/world";

const BURNER_KEYS = new Set(["arrowup", "w"]);
const BAND_HEIGHT = LOGICAL_HEIGHT / WIND_BAND_COUNT;
const BAND_COLORS = [0x3a2a18, 0x14324a, 0x0c1f36];
const POPUP_LIFETIME = 0.8;
const HIT_FLASH_DURATION = 0.35;

interface FloatingScore {
  text: Text;
  age: number;
}

function formatBandLabel(multiplier: number): string {
  if (multiplier < 0.4) return "強い向かい風";
  if (multiplier < 0.85) return "向かい風";
  if (multiplier < 1.15) return "凪";
  if (multiplier < 1.6) return "追い風";
  return "強い追い風";
}

export function EmberLoftGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [distance, setDistance] = useState(0);
  const [integrity, setIntegrity] = useState(100);
  const [heatPercent, setHeatPercent] = useState(0);
  const [orbsCollected, setOrbsCollected] = useState(0);
  const [bandLabel, setBandLabel] = useState("凪");
  const [bandPercent, setBandPercent] = useState(100);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);
  const [crashReason, setCrashReason] = useState<"ground" | "integrity" | null>(null);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<EmberLoftWorld | null>(null);
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
    setCrashReason(null);
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
    const world = new EmberLoftWorld(1, 1);
    worldRef.current = world;

    const bandGraphics = new Graphics();
    const windGraphics = new Graphics();
    const obstacleGraphics = new Graphics();
    const orbGraphics = new Graphics();
    const balloonGraphics = new Graphics();
    const flashGraphics = new Graphics();
    const popupHost = new Graphics();

    let elapsedTime = 0;
    let lastBandLayoutHeight = -1;
    let lastBandLayoutScale = -1;
    let hitFlashAge = HIT_FLASH_DURATION;
    const floatingScores: FloatingScore[] = [];

    world.onOrbCollected = ({ points }: OrbCollectedEvent) => {
      const text = new Text({
        text: `+${points}`,
        style: { fill: 0xffe066, fontSize: 18, fontWeight: "700" },
      });
      text.anchor.set(0.5, 1);
      popupHost.addChild(text);
      floatingScores.push({ text, age: 0 });
    };

    world.onObstacleHit = () => {
      hitFlashAge = 0;
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x05070c,
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
      app.stage.addChild(
        bandGraphics,
        windGraphics,
        obstacleGraphics,
        orbGraphics,
        balloonGraphics,
        popupHost,
        flashGraphics,
      );
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const altitudeToScreenY = (altitude: number) => world.height - altitude * world.scale;

      const loop = new GameLoop((deltaSeconds) => {
        world.step(deltaSeconds);
        elapsedTime += deltaSeconds;
        hitFlashAge = Math.min(HIT_FLASH_DURATION, hitFlashAge + deltaSeconds);

        setScore(world.score);
        setDistance(Math.max(0, Math.floor(world.distance)));
        setIntegrity(world.integrity);
        setHeatPercent(Math.round(world.heat * 100));
        setOrbsCollected(world.orbsCollected);
        setBandLabel(formatBandLabel(world.currentBandMultiplier));
        setBandPercent(Math.round(world.currentBandMultiplier * 100));
        if (world.isOver) {
          setIsOver(true);
          setCrashReason(world.crashReason);
        }

        const scale = world.scale;
        const cameraX = world.cameraX;

        // 帯の背景は高度(=画面の縦位置)だけで決まるので、スケールが変わったときだけ描き直せば十分。
        if (scale !== lastBandLayoutScale || world.height !== lastBandLayoutHeight) {
          lastBandLayoutScale = scale;
          lastBandLayoutHeight = world.height;

          bandGraphics.clear();
          for (let band = 0; band < WIND_BAND_COUNT; band++) {
            const topY = altitudeToScreenY((band + 1) * BAND_HEIGHT);
            const bottomY = altitudeToScreenY(band * BAND_HEIGHT);
            bandGraphics
              .rect(0, topY, world.width, bottomY - topY)
              .fill({ color: BAND_COLORS[band] ?? BAND_COLORS[0], alpha: 0.55 });
          }
          bandGraphics
            .rect(0, world.height - 6 * scale, world.width, 6 * scale)
            .fill({ color: 0xff6b6b, alpha: 0.5 });
          bandGraphics.rect(0, 0, world.width, 3 * scale).fill({ color: 0x9adfff, alpha: 0.45 });
        }

        // 帯ごとの風向インジケータ(倍率が大きいほど濃く・速く流れる)
        windGraphics.clear();
        for (let band = 0; band < WIND_BAND_COUNT; band++) {
          const multiplier = world.getBandMultiplier(band);
          const midY = altitudeToScreenY(band * BAND_HEIGHT + BAND_HEIGHT * 0.5);
          const alpha = Math.max(0.15, Math.min(0.9, multiplier / 1.9));
          const spacing = 120 * scale;
          const speed = 60 * scale * Math.max(0.2, multiplier);
          const offset = (elapsedTime * speed) % spacing;
          for (let x = world.width + spacing - offset; x > -spacing; x -= spacing) {
            const len = 18 * scale * Math.max(0.4, Math.min(1.4, multiplier));
            windGraphics
              .moveTo(x, midY)
              .lineTo(x - len, midY)
              .stroke({ width: 2, color: 0xf2f3f5, alpha });
            windGraphics
              .moveTo(x - len, midY)
              .lineTo(x - len + 6 * scale, midY - 5 * scale)
              .lineTo(x - len + 6 * scale, midY + 5 * scale)
              .closePath()
              .fill({ color: 0xf2f3f5, alpha });
          }
        }

        // 障害物(雲/鳥)
        obstacleGraphics.clear();
        for (const obstacle of world.obstacles) {
          const screenX = (obstacle.x - cameraX) * scale;
          if (screenX < -60 * scale || screenX > world.width + 60 * scale) continue;
          const screenY = altitudeToScreenY(obstacle.altitude);
          if (obstacle.kind === "cloud") {
            const r = 20 * scale;
            obstacleGraphics
              .circle(screenX - r * 0.6, screenY, r * 0.7)
              .circle(screenX, screenY - r * 0.3, r)
              .circle(screenX + r * 0.7, screenY, r * 0.65)
              .fill({ color: 0xd7dbe2, alpha: 0.85 });
          } else {
            const w = 22 * scale;
            obstacleGraphics
              .moveTo(screenX - w, screenY)
              .lineTo(screenX, screenY - w * 0.45)
              .lineTo(screenX + w, screenY)
              .stroke({ width: 3 * scale, color: 0x2b2f3a, alpha: 0.9 });
          }
        }

        // 上昇気流のオーブ
        orbGraphics.clear();
        const pulse = 0.85 + Math.sin(elapsedTime * 5) * 0.15;
        for (const orb of world.orbs) {
          const screenX = (orb.x - cameraX) * scale;
          if (screenX < -30 * scale || screenX > world.width + 30 * scale) continue;
          const screenY = altitudeToScreenY(orb.altitude);
          const r = 12 * scale * pulse;
          orbGraphics
            .circle(screenX, screenY, r * 1.8)
            .fill({ color: 0xffb454, alpha: 0.2 })
            .circle(screenX, screenY, r)
            .fill({ color: 0xffe066, alpha: 0.95 })
            .stroke({ width: 1.5, color: 0xfff3d0, alpha: 0.8 });
        }

        // 気球本体(熱いほど明るいオレンジ、バーナー点火中は炎を描く)
        balloonGraphics.clear();
        const playerScreenX = (world.distance - cameraX) * scale;
        const playerScreenY = altitudeToScreenY(world.altitude);
        const envelopeColor = world.heat > 0.6 ? 0xff8a3d : world.heat > 0.35 ? 0xffb454 : 0x6ee7ff;
        const rx = 26 * scale;
        const ry = 34 * scale;
        balloonGraphics
          .ellipse(playerScreenX, playerScreenY - ry, rx, ry)
          .fill({ color: envelopeColor, alpha: 0.9 })
          .stroke({ width: 2 * scale, color: 0xf2f3f5, alpha: 0.8 });
        balloonGraphics
          .rect(playerScreenX - 10 * scale, playerScreenY - 4 * scale, 20 * scale, 12 * scale)
          .fill({ color: 0x5c4326 })
          .stroke({ width: 1.5 * scale, color: 0xf2f3f5, alpha: 0.7 });
        if (world.burnerOn) {
          const flicker = 0.7 + Math.sin(elapsedTime * 24) * 0.3;
          balloonGraphics
            .moveTo(playerScreenX - 6 * scale, playerScreenY - 4 * scale)
            .lineTo(playerScreenX, playerScreenY - 16 * scale * flicker)
            .lineTo(playerScreenX + 6 * scale, playerScreenY - 4 * scale)
            .closePath()
            .fill({ color: 0xffe066, alpha: 0.9 });
        }

        // 衝突時の画面フラッシュ
        flashGraphics.clear();
        if (hitFlashAge < HIT_FLASH_DURATION) {
          const alpha = 0.35 * (1 - hitFlashAge / HIT_FLASH_DURATION);
          flashGraphics.rect(0, 0, world.width, world.height).fill({ color: 0xff3b3b, alpha });
        }

        // 加点ポップアップ
        for (let i = floatingScores.length - 1; i >= 0; i--) {
          const entry = floatingScores[i];
          entry.age += deltaSeconds;
          if (entry.age === deltaSeconds) {
            entry.text.position.set(playerScreenX, playerScreenY - 2 * ry - 6 * scale);
          }
          entry.text.position.y -= deltaSeconds * 30;
          entry.text.alpha = Math.max(0, 1 - entry.age / POPUP_LIFETIME);
          if (entry.age >= POPUP_LIFETIME) {
            popupHost.removeChild(entry.text);
            entry.text.destroy();
            floatingScores.splice(i, 1);
          }
        }
      }, 0.1);

      const handleBurnerStart = () => world.setBurner(true);
      const handleBurnerEnd = () => world.setBurner(false);

      input.addListener({
        onPointerDown: handleBurnerStart,
        onPointerUp: handleBurnerEnd,
        onKeyDown: (key) => {
          if (BURNER_KEYS.has(key)) {
            handleBurnerStart();
          } else if (key === " ") {
            setIsPaused(loop.togglePause());
          } else if (key === "r") {
            world.reset();
            setIsOver(false);
            setCrashReason(null);
          }
        },
        onKeyUp: (key) => {
          if (BURNER_KEYS.has(key)) handleBurnerEnd();
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

  const crashTitle = crashReason === "ground" ? "地面に激突…" : "気球が壊れた…";

  return (
    <GameShell
      title="Ember Loft"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="ember-loft-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="ember-loft-canvas" />
        <div className={styles.hud}>
          <span className={styles.distance} data-testid="ember-loft-distance">
            {distance}m
          </span>
          <span className={styles.orbs} data-testid="ember-loft-orbs">
            ORB {orbsCollected}
          </span>
          <span className={styles.wind} data-testid="ember-loft-wind">
            {bandLabel} {bandPercent}%
          </span>
          <div className={styles.integrityBar} data-testid="ember-loft-integrity">
            <div className={styles.integrityFill} style={{ width: `${integrity}%` }} />
          </div>
          <div className={styles.heatBar} data-testid="ember-loft-heat">
            <div className={styles.heatFill} style={{ width: `${heatPercent}%` }} />
          </div>
        </div>
        <div className={styles.hint}>
          画面を長押し(または↑/W長押し)でバーナー点火→上昇、離すと冷えて下降。3層の風の帯は時間で強さが変わるので、
          追い風の層へ移って進もう。雲や鳥に当たると気球が傷み、地面に落ちると即墜落。Space:
          一時停止 / R: リセット
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="ember-loft-gameover">
            <div className={styles.gameOverTitle}>{crashTitle}</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <div className={styles.gameOverSub}>
              DISTANCE {distance}m / ORB {orbsCollected}
            </div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="ember-loft-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
