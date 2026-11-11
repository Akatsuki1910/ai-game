"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import {
  type CoreHitEvent,
  FlailWardWorld,
  type Meteor,
  type MeteorDeflectedEvent,
} from "./engine/world";
import styles from "./FlailWardGame.module.scss";

interface FloatingPopup {
  text: Text;
  age: number;
}

const POPUP_LIFETIME = 0.8;
const CORE_COLOR = 0x6ee7ff;
const CORE_FLASH_COLOR = 0xff6b6b;
const BALL_COLOR = 0xffe066;
const CHAIN_COLOR = 0xf2f3f5;
const METEOR_COLOR = 0xff9d7a;
const CORE_FLASH_LIFETIME = 0.3;
// メテオは画面外で生まれるため、最初の1体が見えるまでは画面に動くものが何もなくなる。
// コアの外周をゆっくり脈動させ、開始直後から生きている画面だと分かるようにする。
const CORE_PULSE_AMPLITUDE = 0.12;
const CORE_PULSE_SPEED = 3;

export function FlailWardGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(0);
  const [streak, setStreak] = useState(0);
  const [deflected, setDeflected] = useState(0);
  const [reachedCore, setReachedCore] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const nextMeteorMarkerRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<FlailWardWorld | null>(null);
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
    const world = new FlailWardWorld(1, 1);
    worldRef.current = world;

    const coreGraphics = new Graphics();
    const chainGraphics = new Graphics();
    const ballGraphics = new Graphics();
    const meteorGraphics = new Graphics();
    const popupContainer = new Container();
    const floatingPopups: FloatingPopup[] = [];
    let coreFlashAge = Number.POSITIVE_INFINITY;

    world.onMeteorDeflected = ({ points, streak: currentStreak, x, y }: MeteorDeflectedEvent) => {
      const label = currentStreak > 1 ? `+${points} STREAK x${currentStreak}` : `+${points}`;
      const text = new Text({
        text: label,
        style: { fill: 0xffe066, fontSize: 18, fontWeight: "700" },
      });
      text.anchor.set(0.5, 1);
      text.position.set(x, y - 10);
      popupContainer.addChild(text);
      floatingPopups.push({ text, age: 0 });
    };

    world.onCoreHit = (_event: CoreHitEvent) => {
      coreFlashAge = 0;
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x05060a,
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
      app.stage.addChild(chainGraphics, coreGraphics, meteorGraphics, ballGraphics, popupContainer);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds, elapsedSeconds) => {
        const pointer = input.getPrimaryPointer();
        if (pointer) {
          world.aimAt(pointer.x, pointer.y);
        } else if (input.isKeyDown("arrowleft") || input.isKeyDown("a")) {
          world.rotateManually(-1, deltaSeconds);
        } else if (input.isKeyDown("arrowright") || input.isKeyDown("d")) {
          world.rotateManually(1, deltaSeconds);
        }

        world.step(deltaSeconds);
        setScore(world.score);
        setLives(world.lives);
        setStreak(world.streak);
        setDeflected(world.meteorsDeflected);
        setReachedCore(world.meteorsReachedCore);
        if (world.isOver) setIsOver(true);

        coreFlashAge += deltaSeconds;
        const flashT = Math.max(0, 1 - coreFlashAge / CORE_FLASH_LIFETIME);
        const coreColor = flashT > 0 ? CORE_FLASH_COLOR : CORE_COLOR;

        coreGraphics.clear();
        const pulse = CORE_PULSE_AMPLITUDE * Math.sin(elapsedSeconds * CORE_PULSE_SPEED);
        coreGraphics
          .circle(world.centerX, world.centerY, world.coreRadius * (1.4 + pulse))
          .stroke({ width: 2, color: coreColor, alpha: 0.2 + flashT * 0.5 })
          .circle(world.centerX, world.centerY, world.coreRadius)
          .fill({ color: coreColor, alpha: 0.9 })
          .stroke({ width: 2, color: 0xffffff, alpha: 0.6 });

        const ballPos = world.ballPosition;
        chainGraphics.clear();
        chainGraphics
          .moveTo(world.centerX, world.centerY)
          .lineTo(ballPos.x, ballPos.y)
          .stroke({ width: 3, color: CHAIN_COLOR, alpha: 0.5 });

        ballGraphics.clear();
        ballGraphics
          .circle(ballPos.x, ballPos.y, world.ballRadius)
          .fill({ color: BALL_COLOR, alpha: 0.95 })
          .stroke({ width: 2, color: 0xffffff, alpha: 0.6 });

        meteorGraphics.clear();
        let nearestMeteor: Meteor | null = null;
        for (const meteor of world.meteors) {
          const pos = world.meteorPosition(meteor);
          meteorGraphics
            .circle(pos.x, pos.y, meteor.size)
            .fill({ color: METEOR_COLOR, alpha: 0.9 })
            .stroke({ width: 1.5, color: 0x05060a, alpha: 0.5 });
          if (!nearestMeteor || meteor.distance < nearestMeteor.distance) nearestMeteor = meteor;
        }
        if (nextMeteorMarkerRef.current) {
          if (nearestMeteor) {
            const pos = world.meteorPosition(nearestMeteor);
            nextMeteorMarkerRef.current.style.left = `${pos.x}px`;
            nextMeteorMarkerRef.current.style.top = `${pos.y}px`;
            nextMeteorMarkerRef.current.style.display = "block";
          } else {
            nextMeteorMarkerRef.current.style.display = "none";
          }
        }

        for (let i = floatingPopups.length - 1; i >= 0; i--) {
          const entry = floatingPopups[i];
          entry.age += deltaSeconds;
          entry.text.position.y -= deltaSeconds * 28;
          entry.text.alpha = Math.max(0, 1 - entry.age / POPUP_LIFETIME);
          if (entry.age >= POPUP_LIFETIME) {
            popupContainer.removeChild(entry.text);
            entry.text.destroy();
            floatingPopups.splice(i, 1);
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
      title="Flail Ward"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="flail-ward-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="flail-ward-canvas" />
        <div
          ref={nextMeteorMarkerRef}
          className={styles.meteorMarker}
          data-testid="flail-ward-next-meteor-marker"
        />
        <div className={styles.hud}>
          <span className={styles.lives} data-testid="flail-ward-lives">
            ♥ {lives}
          </span>
          <span className={styles.stat} data-testid="flail-ward-deflected">
            弾いた {deflected}
          </span>
          <span className={styles.stat} data-testid="flail-ward-reached-core">
            被弾 {reachedCore}
          </span>
          {streak >= 2 && (
            <span className={styles.streak} data-testid="flail-ward-streak">
              STREAK {streak}
            </span>
          )}
        </div>
        <div className={styles.hint}>
          ドラッグ/長押しでフレイルをポインタの方向へ振り回し(矢印キー/A・Dでも回転可)、
          四方から迫るメテオを弾いてコアを守れ。コアに当たるとライフが減り、時間とともにメテオは増え速くなる。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="flail-ward-gameover">
            <div className={styles.gameOverTitle}>コア破壊</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <div className={styles.gameOverSub}>
              弾いた {deflected} / 被弾 {reachedCore}
            </div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="flail-ward-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
