"use client";

import { Application, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import {
  type CollapseEvent,
  PagodaStackWorld,
  PERFECT_OVERLAP_RATIO,
  type TierPlacedEvent,
} from "./engine/world";
import styles from "./PagodaStackGame.module.scss";

const TIER_HEIGHT_FRAC = 0.12;
const ARM_SCREEN_RATIO = 0.22;
const GROUND_SCREEN_RATIO = 0.88;
const RENDER_TIER_WINDOW = 60;
const DEBRIS_LIFETIME = 0.9;
const POPUP_LIFETIME = 0.9;

const COLOR_TIER_BODY = 0xd98a3d;
const COLOR_TIER_ROOF = 0x7a3b2e;
const COLOR_TIER_PERFECT = 0x7cf5c4;
const COLOR_FALLING = 0xffd08a;
const COLOR_GUIDE = 0x6ee7ff;
const COLOR_DEBRIS = 0x8a5a3d;
const COLOR_DANGER = 0xff6b6b;

interface FloatingPopup {
  text: Text;
  age: number;
  isPositioned: boolean;
}

interface Debris {
  graphics: Graphics;
  x: number;
  y: number;
  width: number;
  vy: number;
  rotation: number;
  rotationSpeed: number;
  age: number;
}

function drawTier(
  g: Graphics,
  x: number,
  y: number,
  width: number,
  tierHeight: number,
  color: number,
): void {
  const roofOverhang = width * 0.08;
  const roofHeight = tierHeight * 0.3;
  g.roundRect(x - width / 2, y - tierHeight, width, tierHeight, 3).fill({
    color,
    alpha: 0.95,
  });
  g.moveTo(x - width / 2 - roofOverhang, y - tierHeight)
    .lineTo(x + width / 2 + roofOverhang, y - tierHeight)
    .lineTo(x + width / 2, y - tierHeight - roofHeight)
    .lineTo(x - width / 2, y - tierHeight - roofHeight)
    .closePath()
    .fill({ color: COLOR_TIER_ROOF, alpha: 0.95 });
}

export function PagodaStackGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [stackHeight, setStackHeight] = useState(0);
  const [combo, setCombo] = useState(0);
  const [overlapPreviewPercent, setOverlapPreviewPercent] = useState(100);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<PagodaStackWorld | null>(null);
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
    const world = new PagodaStackWorld(1, 1);
    worldRef.current = world;

    const guideGraphics = new Graphics();
    const towerGraphics = new Graphics();
    const fallingGraphics = new Graphics();
    const debrisList: Debris[] = [];
    const floatingPopups: FloatingPopup[] = [];

    const spawnPopup = (label: string, color: number, x: number, y: number): void => {
      const text = new Text({
        text: label,
        style: { fill: color, fontSize: 20, fontWeight: "700" },
      });
      text.anchor.set(0.5, 1);
      text.position.set(x, y);
      app.stage.addChild(text);
      floatingPopups.push({ text, age: 0, isPositioned: false });
    };

    const spawnDebris = (x: number, y: number, width: number): void => {
      const graphics = new Graphics();
      app.stage.addChild(graphics);
      debrisList.push({
        graphics,
        x,
        y,
        width,
        vy: 0,
        rotation: 0,
        rotationSpeed: (Math.random() < 0.5 ? -1 : 1) * (1.5 + Math.random() * 2),
        age: 0,
      });
    };

    const handleTierPlaced = ({ points, isPerfect, combo: comboValue }: TierPlacedEvent): void => {
      const label = isPerfect ? `PERFECT +${points}` : `+${points}`;
      spawnPopup(
        comboValue > 1 ? `${label} x${comboValue}` : label,
        isPerfect ? COLOR_TIER_PERFECT : 0xffffff,
        world.topTier.x,
        0,
      );
    };
    const handleCollapse = ({ reason }: CollapseEvent): void => {
      spawnPopup(
        reason === "missed" ? "外した!" : "薄すぎて崩れた…",
        COLOR_DANGER,
        world.currentX,
        0,
      );
    };
    world.onTierPlaced = handleTierPlaced;
    world.onCollapse = handleCollapse;

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x101722,
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
      app.stage.addChild(guideGraphics, towerGraphics, fallingGraphics);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const tryDrop = (): void => {
        if (loop.isPaused || world.isOver) return;
        const beforeX = world.currentX;
        const beforeWidth = world.fallingWidth;
        const heightBefore = world.stackHeight;
        world.drop();
        if (world.stackHeight > heightBefore) {
          // はみ出してそぎ落とされた分を、崩れた粉として軽く散らす視覚的な演出。
          spawnDebris(beforeX, 0, beforeWidth * 0.3);
        }
      };

      const loop = new GameLoop((deltaSeconds) => {
        world.step(deltaSeconds);

        setScore(world.score);
        setStackHeight(world.stackHeight);
        setCombo(world.combo);
        setOverlapPreviewPercent(Math.round(world.previewOverlapRatio * 100));
        if (world.isOver) setIsOver(true);

        const { width, height } = world;
        if (width <= 0 || height <= 0) return;

        const tierHeight = height * TIER_HEIGHT_FRAC;
        const groundScreenY = height * GROUND_SCREEN_RATIO;
        const armWorldY = (world.stackHeight + 1) * tierHeight;
        const armScreenYUnscrolled = groundScreenY - armWorldY;
        const targetArmScreenY = height * ARM_SCREEN_RATIO;
        const cameraScroll = Math.max(0, targetArmScreenY - armScreenYUnscrolled);

        const screenYForTierIndex = (index: number): number =>
          groundScreenY - index * tierHeight + cameraScroll;

        guideGraphics.clear();
        const armScreenY = screenYForTierIndex(world.stackHeight + 1);
        guideGraphics
          .moveTo(width / 2, 0)
          .lineTo(width / 2, armScreenY - tierHeight)
          .stroke({ width: 2, color: COLOR_GUIDE, alpha: 0.25 });
        guideGraphics
          .moveTo(width / 2 - world.amplitude, armScreenY + 2)
          .lineTo(width / 2 + world.amplitude, armScreenY + 2)
          .stroke({ width: 1, color: COLOR_GUIDE, alpha: 0.2 });

        towerGraphics.clear();
        const total = world.tiers.length;
        const startIndex = Math.max(0, total - RENDER_TIER_WINDOW);
        for (let index = startIndex; index < total; index++) {
          const tier = world.tiers[index];
          const screenY = screenYForTierIndex(index + 1);
          const isTopTier = index === total - 1;
          drawTier(
            towerGraphics,
            tier.x,
            screenY,
            tier.width,
            tierHeight,
            isTopTier ? COLOR_TIER_PERFECT : COLOR_TIER_BODY,
          );
        }

        fallingGraphics.clear();
        if (!world.isOver) {
          drawTier(
            fallingGraphics,
            world.currentX,
            armScreenY,
            world.fallingWidth,
            tierHeight,
            COLOR_FALLING,
          );
        }

        for (let i = debrisList.length - 1; i >= 0; i--) {
          const debris = debrisList[i];
          debris.age += deltaSeconds;
          debris.vy += 420 * deltaSeconds;
          debris.y += debris.vy * deltaSeconds;
          debris.rotation += debris.rotationSpeed * deltaSeconds;
          debris.graphics.clear();
          debris.graphics
            .rect(-debris.width / 2, -debris.width / 2, debris.width, debris.width)
            .fill({ color: COLOR_DEBRIS, alpha: Math.max(0, 1 - debris.age / DEBRIS_LIFETIME) });
          debris.graphics.position.set(debris.x, armScreenY + debris.y);
          debris.graphics.rotation = debris.rotation;
          if (debris.age >= DEBRIS_LIFETIME) {
            app.stage.removeChild(debris.graphics);
            debris.graphics.destroy();
            debrisList.splice(i, 1);
          }
        }

        for (let i = floatingPopups.length - 1; i >= 0; i--) {
          const entry = floatingPopups[i];
          entry.age += deltaSeconds;
          if (!entry.isPositioned) {
            entry.text.position.y = armScreenY - tierHeight;
            entry.isPositioned = true;
          }
          entry.text.position.y -= deltaSeconds * 32;
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
          tryDrop();
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
            tryDrop();
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
      title="Pagoda Stack"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="pagoda-stack-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="pagoda-stack-canvas" />
        <div className={styles.hud}>
          <span
            className={styles.height}
            data-testid="pagoda-stack-height"
            data-height={stackHeight}
          >
            高さ {stackHeight} 段
          </span>
          <span className={styles.combo} data-testid="pagoda-stack-combo" data-combo={combo}>
            COMBO {combo}
          </span>
        </div>
        <div
          className={styles.status}
          data-testid="pagoda-stack-status"
          data-overlap-preview={overlapPreviewPercent}
          data-perfect-ratio={Math.round(PERFECT_OVERLAP_RATIO * 100)}
        />
        <div className={styles.hint}>
          画面をタップ/クリックすると、振れている段をそのままの位置に積む。下の段とのズレが大きいほど次の段は狭くなり、外すか薄すぎて崩れると終了。高く積むほど振れは速く、風の揺れも大きくなる。
          キーボードはEnter: 積む / Space: 一時停止 / R: リセット
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="pagoda-stack-gameover">
            <div className={styles.gameOverTitle}>塔が崩れた…</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <div className={styles.gameOverHeight}>{stackHeight}段の塔</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="pagoda-stack-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
