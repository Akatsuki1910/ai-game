"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import styles from "./BatonSyncGame.module.scss";
import {
  BatonSyncWorld,
  DYNAMICS_MAX,
  DYNAMICS_MIN,
  FOCUS_MAX,
  TEMPO_MAX,
  TEMPO_MIN,
} from "./engine/world";

const BATON_KEY_SPEED_X = 360; // px/秒。矢印キーでバトンを横に動かす速さ。
const BATON_KEY_SPEED_Y = 300; // px/秒。矢印キーでバトンを縦に動かす速さ。
const ORCHESTRA_SIZE = 6;
const POPUP_LIFETIME = 0.9;

interface SegmentPopup {
  text: Text;
  age: number;
}

export function BatonSyncGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [focus, setFocus] = useState(FOCUS_MAX);
  const [tempo, setTempo] = useState((TEMPO_MIN + TEMPO_MAX) / 2);
  const [dynamics, setDynamics] = useState((DYNAMICS_MIN + DYNAMICS_MAX) / 2);
  const [targetTempo, setTargetTempo] = useState((TEMPO_MIN + TEMPO_MAX) / 2);
  const [targetDynamics, setTargetDynamics] = useState((DYNAMICS_MIN + DYNAMICS_MAX) / 2);
  const [isInTune, setIsInTune] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<BatonSyncWorld | null>(null);
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
    const world = new BatonSyncWorld(1, 1);
    worldRef.current = world;

    const tempoBarGraphics = new Graphics();
    const dynamicsBarGraphics = new Graphics();
    const orchestraGraphics = new Graphics();
    const batonGraphics = new Graphics();
    const popupContainer = new Container();
    const popups: SegmentPopup[] = [];
    let orchestraPhase = 0;

    world.onSegmentAdvanced = ({ difficulty }) => {
      const text = new Text({
        text: `フレーズ ${difficulty + 1}`,
        style: { fill: 0x6ee7ff, fontSize: 18, fontWeight: "700" },
      });
      text.anchor.set(0.5, 1);
      text.position.set(world.width / 2, world.height * 0.3);
      popupContainer.addChild(text);
      popups.push({ text, age: 0 });
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
      app.stage.addChild(
        tempoBarGraphics,
        dynamicsBarGraphics,
        orchestraGraphics,
        batonGraphics,
        popupContainer,
      );
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        let dx = 0;
        let dy = 0;
        if (input.isKeyDown("arrowleft") || input.isKeyDown("a"))
          dx -= BATON_KEY_SPEED_X * deltaSeconds;
        if (input.isKeyDown("arrowright") || input.isKeyDown("d"))
          dx += BATON_KEY_SPEED_X * deltaSeconds;
        if (input.isKeyDown("arrowup") || input.isKeyDown("w"))
          dy -= BATON_KEY_SPEED_Y * deltaSeconds;
        if (input.isKeyDown("arrowdown") || input.isKeyDown("s"))
          dy += BATON_KEY_SPEED_Y * deltaSeconds;
        if (dx !== 0 || dy !== 0) world.nudgeBatonInput(dx, dy);

        world.step(deltaSeconds);
        setScore(Math.floor(world.score));
        setFocus(Math.round(world.focus));
        setTempo(Math.round(world.tempo));
        setDynamics(Math.round(world.dynamics));
        setTargetTempo(Math.round(world.targetTempo));
        setTargetDynamics(Math.round(world.targetDynamics));
        setIsInTune(world.isInTune);
        if (world.isOver) setIsOver(true);

        orchestraPhase += ((world.tempo / 60) * Math.PI * 2 * deltaSeconds) % (Math.PI * 2);

        const tempoBarX0 = world.width * 0.08;
        const tempoBarX1 = world.width * 0.92;
        const tempoBarY = world.height - 36;
        const tempoToX = (value: number) =>
          tempoBarX0 + ((value - TEMPO_MIN) / (TEMPO_MAX - TEMPO_MIN)) * (tempoBarX1 - tempoBarX0);

        tempoBarGraphics.clear();
        tempoBarGraphics
          .rect(tempoBarX0, tempoBarY, tempoBarX1 - tempoBarX0, 10)
          .stroke({ width: 2, color: 0x2b2f3a, alpha: 0.9 });
        const tempoTargetX0 = tempoToX(world.targetTempo - world.tempoTolerance);
        const tempoTargetX1 = tempoToX(world.targetTempo + world.tempoTolerance);
        tempoBarGraphics
          .rect(tempoTargetX0, tempoBarY, tempoTargetX1 - tempoTargetX0, 10)
          .fill({ color: 0x7cf5c4, alpha: 0.3 });
        tempoBarGraphics
          .circle(tempoToX(world.tempo), tempoBarY + 5, 8)
          .fill({ color: world.isInTune ? 0x7cf5c4 : 0xff6b6b });

        const dynamicsBarX = world.width * 0.06;
        const dynamicsBarY0 = world.height * 0.1;
        const dynamicsBarY1 = world.height * 0.72;
        const dynamicsToY = (value: number) =>
          dynamicsBarY0 +
          (1 - (value - DYNAMICS_MIN) / (DYNAMICS_MAX - DYNAMICS_MIN)) *
            (dynamicsBarY1 - dynamicsBarY0);

        dynamicsBarGraphics.clear();
        dynamicsBarGraphics
          .rect(dynamicsBarX, dynamicsBarY0, 10, dynamicsBarY1 - dynamicsBarY0)
          .stroke({ width: 2, color: 0x2b2f3a, alpha: 0.9 });
        const dynamicsTargetY0 = dynamicsToY(world.targetDynamics + world.dynamicsTolerance);
        const dynamicsTargetY1 = dynamicsToY(world.targetDynamics - world.dynamicsTolerance);
        dynamicsBarGraphics
          .rect(dynamicsBarX, dynamicsTargetY0, 10, dynamicsTargetY1 - dynamicsTargetY0)
          .fill({ color: 0x7cf5c4, alpha: 0.3 });
        dynamicsBarGraphics
          .circle(dynamicsBarX + 5, dynamicsToY(world.dynamics), 8)
          .fill({ color: world.isInTune ? 0x7cf5c4 : 0xff6b6b });

        orchestraGraphics.clear();
        const orchestraY = world.height * 0.42;
        const orchestraX0 = world.width * 0.18;
        const orchestraX1 = world.width * 0.82;
        const dynamicsRatio = world.dynamics / DYNAMICS_MAX;
        for (let i = 0; i < ORCHESTRA_SIZE; i++) {
          const x = orchestraX0 + ((orchestraX1 - orchestraX0) * i) / (ORCHESTRA_SIZE - 1);
          const wobble = Math.sin(orchestraPhase + i * 0.7);
          const radius = 10 + dynamicsRatio * 14 + wobble * 3;
          orchestraGraphics.circle(x, orchestraY + wobble * 4, Math.max(4, radius)).fill({
            color: world.isInTune ? 0x6ee7ff : 0x9aa0ac,
            alpha: 0.55 + dynamicsRatio * 0.4,
          });
        }

        batonGraphics.clear();
        const pivotX = world.width / 2;
        const pivotY = world.height - 8;
        batonGraphics
          .moveTo(pivotX, pivotY)
          .lineTo(world.inputX, world.inputY)
          .stroke({ width: 3, color: 0xffb454, alpha: 0.9 });
        batonGraphics.circle(world.inputX, world.inputY, 7).fill({ color: 0xffb454 });
        batonGraphics.circle(pivotX, pivotY, 5).fill({ color: 0x9aa0ac });

        for (let i = popups.length - 1; i >= 0; i--) {
          const popup = popups[i];
          popup.age += deltaSeconds;
          popup.text.position.y -= deltaSeconds * 24;
          popup.text.alpha = Math.max(0, 1 - popup.age / POPUP_LIFETIME);
          if (popup.age >= POPUP_LIFETIME) {
            popupContainer.removeChild(popup.text);
            popup.text.destroy();
            popups.splice(i, 1);
          }
        }
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => world.setBatonInput(pointer.x, pointer.y),
        onPointerMove: (pointer) => world.setBatonInput(pointer.x, pointer.y),
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
      title="Baton Sync"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="baton-sync-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="baton-sync-canvas" />
        <div className={styles.hud}>
          <div className={styles.focusBar}>
            <span className={styles.focusLabel}>集中力</span>
            <div className={styles.focusTrack}>
              <div
                className={styles.focusFill}
                style={{ width: `${focus}%` }}
                data-in-tune={isInTune}
              />
            </div>
            <span className={styles.focusValue} data-testid="baton-sync-focus">
              {focus}%
            </span>
          </div>
          <span className={styles.readout} data-testid="baton-sync-tempo">
            テンポ ♩={tempo}（目標 {targetTempo}）
          </span>
          <span className={styles.readout} data-testid="baton-sync-dynamics">
            音量 {dynamics}%（目標 {targetDynamics}%）
          </span>
        </div>
        <div className={styles.hint}>
          ドラッグ/長押しでバトンを動かす（左右=テンポ・上下=音量）。目標の帯（緑）に合わせ続けて集中力を保とう。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="baton-sync-gameover">
            <div className={styles.gameOverTitle}>演奏崩壊</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="baton-sync-restart"
            >
              もう一度指揮する
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
