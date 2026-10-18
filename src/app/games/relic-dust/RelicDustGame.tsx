"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import {
  CLEARED_SAND_THRESHOLD,
  COMPLETE_REVEAL_RATIO,
  GRID_COLS,
  GRID_ROWS,
  INTEGRITY_MAX,
  LIVES_START,
  RelicDustWorld,
  STAMINA_MAX,
} from "./engine/world";
import styles from "./RelicDustGame.module.scss";

const KEY_MOVE_SPEED = 360; // px/秒。矢印キーで刷毛を動かす速さ。
const POPUP_LIFETIME = 1.1;

// 砂の上できらめく砂粒(常時アニメーションし、無操作でも画面が止まった絵にならないようにする)。
const DUST_GLINTS: ReadonlyArray<{ xRatio: number; yRatio: number; phase: number }> = [
  { xRatio: 0.15, yRatio: 0.2, phase: 0 },
  { xRatio: 0.82, yRatio: 0.18, phase: 1.1 },
  { xRatio: 0.12, yRatio: 0.78, phase: 2.3 },
  { xRatio: 0.85, yRatio: 0.75, phase: 3.4 },
  { xRatio: 0.5, yRatio: 0.12, phase: 4.6 },
  { xRatio: 0.5, yRatio: 0.88, phase: 5.7 },
];

interface ResultPopup {
  text: Text;
  age: number;
}

export function RelicDustGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [round, setRound] = useState(1);
  const [lives, setLives] = useState(LIVES_START);
  const [integrityPercent, setIntegrityPercent] = useState(100);
  const [staminaPercent, setStaminaPercent] = useState(100);
  const [progressPercent, setProgressPercent] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<RelicDustWorld | null>(null);
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
    const world = new RelicDustWorld(1, 1);
    worldRef.current = world;

    const relicGraphics = new Graphics();
    const sandGraphics = new Graphics();
    const crackGraphics = new Graphics();
    const glintGraphics = new Graphics();
    const cursorGraphics = new Graphics();
    const popupContainer = new Container();
    const popups: ResultPopup[] = [];

    world.onRoundResolved = ({ success }) => {
      const text = new Text({
        text: success ? "発掘成功!" : "ヒビで破損…",
        style: {
          fill: success ? 0x7cf5c4 : 0xff6b6b,
          fontSize: 22,
          fontWeight: "800",
        },
      });
      text.anchor.set(0.5, 1);
      text.position.set(world.width / 2, world.height * 0.3);
      popupContainer.addChild(text);
      popups.push({ text, age: 0 });
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x1b140d,
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
        relicGraphics,
        sandGraphics,
        glintGraphics,
        crackGraphics,
        cursorGraphics,
        popupContainer,
      );
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds, elapsedSeconds) => {
        let dx = 0;
        let dy = 0;
        if (input.isKeyDown("arrowleft") || input.isKeyDown("a"))
          dx -= KEY_MOVE_SPEED * deltaSeconds;
        if (input.isKeyDown("arrowright") || input.isKeyDown("d"))
          dx += KEY_MOVE_SPEED * deltaSeconds;
        if (input.isKeyDown("arrowup") || input.isKeyDown("w")) dy -= KEY_MOVE_SPEED * deltaSeconds;
        if (input.isKeyDown("arrowdown") || input.isKeyDown("s"))
          dy += KEY_MOVE_SPEED * deltaSeconds;
        if (dx !== 0 || dy !== 0) world.nudgePointer(dx, dy);

        world.step(deltaSeconds);

        setScore(Math.floor(world.score));
        setRound(world.relicIndex + 1);
        setLives(world.lives);
        setIntegrityPercent(Math.round((world.integrity / INTEGRITY_MAX) * 100));
        setStaminaPercent(Math.round((world.stamina / STAMINA_MAX) * 100));
        setProgressPercent(Math.round(world.revealRatio * 100));
        if (world.isOver) setIsOver(true);

        const { cx, cy, rx, ry } = world.getRelicBoundsPx();

        relicGraphics.clear();
        const neckWidth = rx * 0.5;
        const neckHeight = ry * 0.85;
        const bodyCy = cy + ry * 0.12;
        relicGraphics
          .rect(cx - neckWidth / 2, bodyCy - ry - neckHeight * 0.6, neckWidth, neckHeight)
          .fill({ color: 0xb5651d });
        relicGraphics.ellipse(cx, bodyCy, rx, ry).fill({ color: 0xc27a33 });
        relicGraphics
          .ellipse(cx, bodyCy, rx * 0.72, ry * 0.72)
          .stroke({ width: 2, color: 0x8a4513, alpha: 0.45 });
        relicGraphics
          .ellipse(cx, bodyCy - ry - neckHeight * 0.6, neckWidth / 2, neckHeight * 0.16)
          .fill({ color: 0x8a4513 });

        sandGraphics.clear();
        crackGraphics.clear();
        const cw = world.cellWidth;
        const ch = world.cellHeight;
        for (let row = 0; row < GRID_ROWS; row++) {
          for (let col = 0; col < GRID_COLS; col++) {
            const cell = world.getCell(col, row);
            const x = col * cw;
            const y = row * ch;
            if (cell.sand > CLEARED_SAND_THRESHOLD) {
              sandGraphics
                .rect(x, y, cw, ch)
                .fill({ color: 0xd8c08a, alpha: 0.3 + 0.65 * cell.sand });
            }
            if (cell.isCracked) {
              const midX = x + cw / 2;
              const midY = y + ch / 2;
              crackGraphics
                .moveTo(midX - cw * 0.25, midY - ch * 0.25)
                .lineTo(midX + cw * 0.25, midY + ch * 0.25)
                .moveTo(midX + cw * 0.25, midY - ch * 0.25)
                .lineTo(midX - cw * 0.25, midY + ch * 0.25)
                .stroke({ width: 2, color: 0xff6b6b, alpha: 0.85 });
            }
          }
        }

        glintGraphics.clear();
        for (const glint of DUST_GLINTS) {
          const twinkle = (Math.sin(elapsedSeconds * 2.4 + glint.phase) + 1) / 2;
          glintGraphics
            .circle(world.width * glint.xRatio, world.height * glint.yRatio, 1.5 + twinkle * 2.5)
            .fill({ color: 0xfff1c9, alpha: 0.25 + twinkle * 0.55 });
        }

        cursorGraphics.clear();
        const isDanger = world.isBrushing && world.lastBrushSpeed > world.allowedSpeed;
        const cursorColor = world.stamina <= 0 ? 0x5a5f6b : isDanger ? 0xff6b6b : 0x7cf5c4;
        cursorGraphics
          .circle(world.pointerX, world.pointerY, world.brushRadiusPx)
          .fill({ color: cursorColor, alpha: world.isBrushing ? 0.22 : 0.08 })
          .circle(world.pointerX, world.pointerY, world.brushRadiusPx)
          .stroke({ width: 2, color: cursorColor, alpha: 0.9 });

        for (let i = popups.length - 1; i >= 0; i--) {
          const popup = popups[i];
          popup.age += deltaSeconds;
          popup.text.position.y -= deltaSeconds * 22;
          popup.text.alpha = Math.max(0, 1 - popup.age / POPUP_LIFETIME);
          if (popup.age >= POPUP_LIFETIME) {
            popupContainer.removeChild(popup.text);
            popup.text.destroy();
            popups.splice(i, 1);
          }
        }
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => world.setPointerDown(pointer.x, pointer.y),
        onPointerMove: (pointer) => world.setPointerPosition(pointer.x, pointer.y),
        onPointerUp: () => world.setPointerUp(),
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
          } else if (key === "r") {
            world.reset();
            setIsOver(false);
          } else if (key === "enter") {
            world.setBrushing(true);
          }
        },
        onKeyUp: (key) => {
          if (key === "enter") world.setBrushing(false);
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
      title="Relic Dust"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="relic-dust-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="relic-dust-canvas" />
        <div className={styles.hud}>
          <span className={styles.readout} data-testid="relic-dust-round">
            発掘 {round}
          </span>
          <span className={styles.readout} data-testid="relic-dust-lives">
            残りライフ {lives}
          </span>
          <div className={styles.barRow}>
            <span className={styles.barLabel}>耐久</span>
            <div className={styles.barTrack}>
              <div
                className={styles.barFill}
                data-variant="integrity"
                style={{ width: `${integrityPercent}%` }}
              />
            </div>
            <span className={styles.barValue} data-testid="relic-dust-integrity">
              {integrityPercent}%
            </span>
          </div>
          <div className={styles.barRow}>
            <span className={styles.barLabel}>スタミナ</span>
            <div className={styles.barTrack}>
              <div
                className={styles.barFill}
                data-variant="stamina"
                style={{ width: `${staminaPercent}%` }}
              />
            </div>
            <span className={styles.barValue} data-testid="relic-dust-stamina">
              {staminaPercent}%
            </span>
          </div>
          <div className={styles.barRow}>
            <span className={styles.barLabel}>発掘率</span>
            <div className={styles.barTrack}>
              <div
                className={styles.barFill}
                data-variant="progress"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <span className={styles.barValue} data-testid="relic-dust-progress">
              {progressPercent}% / {Math.round(COMPLETE_REVEAL_RATIO * 100)}%
            </span>
          </div>
        </div>
        <div className={styles.hint}>
          ドラッグ/長押しで刷毛を動かして砂を払う。砂が薄くなった遺物を素早く払うとヒビが入る。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="relic-dust-gameover">
            <div className={styles.gameOverTitle}>発掘中止</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="relic-dust-restart"
            >
              もう一度発掘する
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
