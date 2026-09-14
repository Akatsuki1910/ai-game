"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import styles from "./ChromaWellGame.module.scss";
import {
  ChromaWellWorld,
  PIGMENTS,
  type PigmentIndex,
  ROUND_SECONDS,
  rgbToCssColor,
  rgbToHex,
} from "./engine/world";

interface FloatingScore {
  text: Text;
  age: number;
}

const POPUP_LIFETIME = 0.9;

export function ChromaWellGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(ROUND_SECONDS);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);
  const [selectedPigment, setSelectedPigment] = useState<PigmentIndex>(0);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const targetSwatchRef = useRef<HTMLDivElement | null>(null);
  const currentSwatchRef = useRef<HTMLDivElement | null>(null);
  const progressFillRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<ChromaWellWorld | null>(null);
  const appRef = useRef<Application | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const selectedPigmentRef = useRef<PigmentIndex>(selectedPigment);

  useEffect(() => {
    selectedPigmentRef.current = selectedPigment;
  }, [selectedPigment]);

  const handleTogglePause = useCallback(() => {
    if (!loopRef.current) return;
    setIsPaused(loopRef.current.togglePause());
  }, []);

  const handleSelectPigment = useCallback((index: PigmentIndex) => {
    setSelectedPigment(index);
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
    const world = new ChromaWellWorld(1, 1);
    worldRef.current = world;

    const blobGraphics = new Graphics();
    const popupContainer = new Container();
    const floatingScores: FloatingScore[] = [];
    const activePointerIds = new Set<number>();

    world.onMatchSucceeded = ({ points, streak }) => {
      const label = streak > 1 ? `+${points} STREAK x${streak}` : `+${points}`;
      const text = new Text({
        text: label,
        style: { fill: 0xffe066, fontSize: 18, fontWeight: "700" },
      });
      text.anchor.set(0.5, 1);
      text.position.set(world.width / 2, world.height / 2);
      popupContainer.addChild(text);
      floatingScores.push({ text, age: 0 });
    };

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
      app.stage.addChild(blobGraphics, popupContainer);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        world.step(deltaSeconds);
        setScore(Math.floor(world.score));
        setTimeRemaining(Math.ceil(world.timeRemaining));
        if (world.isOver) setIsOver(true);

        blobGraphics.clear();
        for (const blob of world.blobs) {
          blobGraphics
            .circle(blob.x, blob.y, blob.r)
            .fill({ color: rgbToHex(PIGMENTS[blob.pigmentIndex]), alpha: 0.55 });
        }

        if (targetSwatchRef.current) {
          targetSwatchRef.current.style.backgroundColor = rgbToCssColor(world.target);
        }
        if (currentSwatchRef.current) {
          currentSwatchRef.current.style.backgroundColor = world.currentColor
            ? rgbToCssColor(world.currentColor)
            : "transparent";
        }
        if (progressFillRef.current) {
          progressFillRef.current.style.width = `${Math.round(world.matchProgress * 100)}%`;
        }

        for (let i = floatingScores.length - 1; i >= 0; i--) {
          const entry = floatingScores[i];
          entry.age += deltaSeconds;
          entry.text.position.y -= deltaSeconds * 28;
          entry.text.alpha = Math.max(0, 1 - entry.age / POPUP_LIFETIME);
          if (entry.age >= POPUP_LIFETIME) {
            popupContainer.removeChild(entry.text);
            entry.text.destroy();
            floatingScores.splice(i, 1);
          }
        }
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => {
          activePointerIds.add(pointer.id);
          world.applyPigment(pointer.x, pointer.y, selectedPigmentRef.current);
        },
        onPointerMove: (pointer) => {
          if (!activePointerIds.has(pointer.id)) return;
          world.applyPigment(pointer.x, pointer.y, selectedPigmentRef.current);
        },
        onPointerUp: (pointer) => {
          activePointerIds.delete(pointer.id);
        },
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
          } else if (key === "r") {
            world.reset();
            setIsOver(false);
          } else if (key === "1" || key === "2" || key === "3") {
            setSelectedPigment((Number(key) - 1) as PigmentIndex);
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
      title="Chroma Well"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="chroma-well-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="chroma-well-canvas" />
        <div className={styles.hud}>
          <div className={styles.swatches}>
            <div className={styles.swatchGroup}>
              <span className={styles.swatchLabel}>お題</span>
              <div
                ref={targetSwatchRef}
                className={styles.swatchColor}
                data-testid="chroma-well-target"
              />
            </div>
            <div className={styles.swatchGroup}>
              <span className={styles.swatchLabel}>現在</span>
              <div
                ref={currentSwatchRef}
                className={styles.swatchColor}
                data-testid="chroma-well-current"
              />
            </div>
          </div>
          <div className={styles.progressTrack} data-testid="chroma-well-progress">
            <div ref={progressFillRef} className={styles.progressFill} />
          </div>
          <span className={styles.timer} data-testid="chroma-well-timer">
            ⏱ {timeRemaining}s
          </span>
        </div>
        <div className={styles.palette} data-testid="chroma-well-palette">
          {PIGMENTS.map((color, index) => {
            const pigmentIndex = index as PigmentIndex;
            const isActive = selectedPigment === pigmentIndex;
            return (
              <button
                key={pigmentIndex}
                type="button"
                className={
                  isActive
                    ? `${styles.paletteButton} ${styles.paletteButtonActive}`
                    : styles.paletteButton
                }
                style={{ backgroundColor: rgbToCssColor(color) }}
                onClick={() => handleSelectPigment(pigmentIndex)}
                aria-pressed={isActive}
                data-testid={`chroma-well-pigment-${pigmentIndex}`}
              />
            );
          })}
        </div>
        <div className={styles.hint}>
          ドラッグ/タップでインクを盛ってお題の色に近づけ、そのまま維持して調色を完成させよう。
          数字キー1/2/3で色を切替。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="chroma-well-gameover">
            <div className={styles.gameOverTitle}>ラウンド終了</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="chroma-well-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
