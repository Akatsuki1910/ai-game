"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import { type GemCollectedEvent, HighWireWorld, WIRE_Y } from "./engine/world";
import styles from "./HighWireGame.module.scss";

interface FloatingScore {
  text: Text;
  age: number;
}

const POPUP_LIFETIME = 0.8;

function formatWind(windTorque: number, windMax: number): string {
  if (windMax <= 0) return "無風";
  const ratio = Math.round((Math.abs(windTorque) / windMax) * 100);
  if (ratio < 5) return "無風";
  const arrow = windTorque > 0 ? "→" : "←";
  return `${arrow} ${ratio}%`;
}

export function HighWireGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [distance, setDistance] = useState(0);
  const [gemsCollected, setGemsCollected] = useState(0);
  const [windLabel, setWindLabel] = useState("無風");
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<HighWireWorld | null>(null);
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
    const world = new HighWireWorld(1, 1);
    worldRef.current = world;

    const skyGraphics = new Graphics();
    const gridGraphics = new Graphics();
    const abyssGraphics = new Graphics();
    const wireGraphics = new Graphics();
    const gemGraphics = new Graphics();
    const windGraphics = new Graphics();
    const playerContainer = new Container();
    const playerGraphics = new Graphics();
    playerContainer.addChild(playerGraphics);
    // ピボット(綱との接点)を原点として、そこから上に伸びる体とバランス棒を描く。
    // theta による回転はコンテナ全体にかけるだけでよいので、形状は起動時に一度だけ描画する。
    playerGraphics
      .moveTo(-26, 0)
      .lineTo(26, 0)
      .stroke({ width: 3, color: 0xf2f3f5, alpha: 0.9 })
      .moveTo(0, 0)
      .lineTo(0, -30)
      .stroke({ width: 4, color: 0x6ee7ff })
      .circle(0, -38, 9)
      .fill({ color: 0x6ee7ff })
      .stroke({ width: 2, color: 0xf2f3f5, alpha: 0.9 });

    const popupHost = new Container();
    const floatingScores: FloatingScore[] = [];
    let elapsedTime = 0;
    let lastSkyWireScreenY = -1;

    world.onGemCollected = ({ points }: GemCollectedEvent) => {
      const text = new Text({
        text: `+${points}`,
        style: { fill: 0xffe066, fontSize: 18, fontWeight: "700" },
      });
      text.anchor.set(0.5, 1);
      popupHost.addChild(text);
      floatingScores.push({ text, age: 0 });
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x0b0e16,
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
        skyGraphics,
        gridGraphics,
        abyssGraphics,
        wireGraphics,
        gemGraphics,
        playerContainer,
        windGraphics,
        popupHost,
      );
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        const pointer = input.getPrimaryPointer();
        if (pointer) {
          world.setLean(pointer.x < world.width / 2 ? -1 : 1);
        } else if (input.isKeyDown("arrowleft") || input.isKeyDown("a")) {
          world.setLean(-1);
        } else if (input.isKeyDown("arrowright") || input.isKeyDown("d")) {
          world.setLean(1);
        } else {
          world.setLean(0);
        }

        world.step(deltaSeconds);
        elapsedTime += deltaSeconds;

        setScore(world.score);
        setDistance(Math.max(0, Math.floor(world.distance)));
        setGemsCollected(world.gemsCollected);
        setWindLabel(formatWind(world.windTorqueValue, world.windMax));
        if (world.isOver) setIsOver(true);

        const scale = world.scale;
        const cameraX = world.cameraX;
        const wireScreenY = WIRE_Y * scale;

        // 空・谷底は画面サイズが変わったとき(≒ wireScreenY が変わったとき)だけ描き直せば十分。
        if (wireScreenY !== lastSkyWireScreenY) {
          lastSkyWireScreenY = wireScreenY;

          skyGraphics.clear();
          skyGraphics
            .rect(0, 0, world.width, wireScreenY)
            .fill({ color: 0x141c2e })
            .rect(0, 0, world.width, wireScreenY * 0.5)
            .fill({ color: 0x1d2740, alpha: 0.6 });

          abyssGraphics.clear();
          abyssGraphics
            .rect(0, wireScreenY, world.width, Math.max(0, world.height - wireScreenY))
            .fill({ color: 0x1a0d10, alpha: 0.9 })
            .rect(0, wireScreenY, world.width, 40 * scale)
            .fill({ color: 0xff6b6b, alpha: 0.08 });
        }

        // 奥行き感を出す背景グリッド(カメラの動きに合わせてスクロールする)
        gridGraphics.clear();
        const gridSpacing = 140;
        const gridStartX = Math.floor(cameraX / gridSpacing) * gridSpacing;
        for (
          let x = gridStartX;
          x < cameraX + world.logicalViewWidth + gridSpacing;
          x += gridSpacing
        ) {
          const screenX = (x - cameraX) * scale;
          gridGraphics
            .moveTo(screenX, 0)
            .lineTo(screenX, wireScreenY)
            .stroke({ width: 1, color: 0x2b3348, alpha: 0.4 });
        }

        // ワイヤー本体(縦位置は固定なので横幅だけ更新すればよい)
        wireGraphics.clear();
        wireGraphics
          .moveTo(0, wireScreenY)
          .lineTo(world.width, wireScreenY)
          .stroke({ width: 3, color: 0x9aa0ac, alpha: 0.8 });

        // ジェム(脈動させて見つけやすくする)
        gemGraphics.clear();
        const pulse = 0.85 + Math.sin(elapsedTime * 5) * 0.15;
        for (const gem of world.gems) {
          const screenX = (gem.x - cameraX) * scale;
          if (screenX < -30 || screenX > world.width + 30) continue;
          const r = 10 * scale * pulse;
          gemGraphics
            .moveTo(screenX, wireScreenY - r * 2)
            .lineTo(screenX + r, wireScreenY - r)
            .lineTo(screenX, wireScreenY)
            .lineTo(screenX - r, wireScreenY - r)
            .closePath()
            .fill({ color: 0x7cf5c4, alpha: 0.9 })
            .stroke({ width: 1.5, color: 0xf2f3f5, alpha: 0.7 });
        }

        // プレイヤー(位置は綱の上で固定、傾きだけコンテナごと回転させる)
        const playerScreenX = (world.distance - cameraX) * scale;
        playerContainer.position.set(playerScreenX, wireScreenY);
        playerContainer.rotation = world.theta;
        playerContainer.scale.set(scale);

        // 風向きインジケータ(プレイヤーの少し上に、現在の風の強さ・向きを矢印で表示)
        windGraphics.clear();
        const windRatio = world.windMax > 0 ? world.windTorqueValue / world.windMax : 0;
        if (Math.abs(windRatio) > 0.05) {
          const windY = wireScreenY - 70 * scale;
          const len = 28 * scale * Math.abs(windRatio);
          const dir = Math.sign(windRatio);
          windGraphics
            .moveTo(playerScreenX - dir * len, windY)
            .lineTo(playerScreenX + dir * len, windY)
            .stroke({ width: 3, color: 0xffb454, alpha: 0.8 });
          windGraphics
            .moveTo(playerScreenX + dir * len, windY)
            .lineTo(playerScreenX + dir * (len - 8 * scale), windY - 6 * scale)
            .lineTo(playerScreenX + dir * (len - 8 * scale), windY + 6 * scale)
            .closePath()
            .fill({ color: 0xffb454, alpha: 0.8 });
        }

        // 加点ポップアップ
        for (let i = floatingScores.length - 1; i >= 0; i--) {
          const entry = floatingScores[i];
          entry.age += deltaSeconds;
          if (entry.age === deltaSeconds) {
            entry.text.position.set(playerScreenX, wireScreenY - 60 * scale);
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

      input.addListener({
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
      title="High Wire"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="high-wire-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="high-wire-canvas" />
        <div className={styles.leanZones} aria-hidden="true">
          <div className={styles.leanZone}>← 左に体重</div>
          <div className={styles.leanZone}>右に体重 →</div>
        </div>
        <div className={styles.hud}>
          <span className={styles.distance} data-testid="high-wire-distance">
            {distance}m
          </span>
          <span className={styles.gems} data-testid="high-wire-gems">
            GEM {gemsCollected}
          </span>
          <span className={styles.wind} data-testid="high-wire-wind">
            風 {windLabel}
          </span>
        </div>
        <div className={styles.hint}>
          画面の左右どちらかを長押し(または矢印キー/A・D長押し)して体重をかけ、風に負けず綱の上を進み続けろ。
          傾いた方向と逆に踏ん張れば立て直せる。Space: 一時停止 / R: リセット。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="high-wire-gameover">
            <div className={styles.gameOverTitle}>転落…</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <div className={styles.gameOverSub}>
              DISTANCE {distance}m / GEM {gemsCollected}
            </div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="high-wire-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
