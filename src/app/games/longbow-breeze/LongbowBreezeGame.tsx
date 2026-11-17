"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import { LongbowBreezeWorld, type RingDef } from "./engine/world";
import styles from "./LongbowBreezeGame.module.scss";

interface FloatingText {
  text: Text;
  age: number;
}

const POPUP_LIFETIME = 1.1;
const MIN_LAUNCH_DRAG = 14;
const KEY_ROTATE_SPEED = 1.6; // rad/秒
const KEY_POWER_SPEED = 1.1; // /秒
const DEFAULT_AIM_ANGLE = (-45 * Math.PI) / 180;
const DEFAULT_AIM_POWER = 0.6;
const ANGLE_MIN = (-88 * Math.PI) / 180;
const ANGLE_MAX = (-6 * Math.PI) / 180;
const MIN_POWER = 0.08;

const RING_COLORS: Readonly<Record<number, number>> = {
  100: 0xffd34d,
  70: 0xe85b5b,
  50: 0x5b9ee8,
  30: 0x2b2f3a,
};

function ringColor(ring: RingDef): number {
  return RING_COLORS[ring.points] ?? 0xffffff;
}

export function LongbowBreezeGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const canvasHostRef = useRef<HTMLDivElement | null>(null);

  const worldRef = useRef<LongbowBreezeWorld | null>(null);
  const appRef = useRef<Application | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);

  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [round, setRound] = useState(0);
  const [windDisplay, setWindDisplay] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    let disposed = false;

    const app = new Application();
    const world = new LongbowBreezeWorld(1, 1);
    worldRef.current = world;

    const skyGraphics = new Graphics();
    const groundGraphics = new Graphics();
    const flagGraphics = new Graphics();
    const targetGraphics = new Graphics();
    const trailGraphics = new Graphics();
    const bowGraphics = new Graphics();
    const arrowGraphics = new Graphics();
    const popupContainer = new Container();
    const floatingTexts: FloatingText[] = [];

    // ポインター照準とキーボード照準は同じ aimAngle/aimPower を共有し、
    // 「今の狙い」を単一の状態として弓の見た目と発射の両方に使う。
    let aimAngle = DEFAULT_AIM_ANGLE;
    let aimPower = DEFAULT_AIM_POWER;
    let pointerAimId: number | null = null;
    let pointerAnchor = { x: 0, y: 0 };

    world.onShotResolved = (resolution) => {
      const label = resolution.ring
        ? resolution.combo > 0
          ? `+${resolution.points} COMBO x${resolution.combo + 1}`
          : `+${resolution.points}`
        : "MISS";
      const text = new Text({
        text: label,
        style: {
          fill: resolution.ring ? 0xffe066 : 0xff6b6b,
          fontSize: 18,
          fontWeight: "700",
        },
      });
      text.anchor.set(0.5, 1);
      text.position.set(resolution.at.x, resolution.at.y);
      popupContainer.addChild(text);
      floatingTexts.push({ text, age: 0 });
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x1c2b3c,
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
        groundGraphics,
        flagGraphics,
        targetGraphics,
        trailGraphics,
        bowGraphics,
        arrowGraphics,
        popupContainer,
      );
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const computeAimVelocity = () => {
        const speed = world.minSpeed + aimPower * (world.maxSpeed - world.minSpeed);
        return { vx: Math.cos(aimAngle) * speed, vy: Math.sin(aimAngle) * speed };
      };

      const loop = new GameLoop((deltaSeconds, elapsedSeconds) => {
        world.step(deltaSeconds);
        setScore(Math.floor(world.score));
        setLives(world.lives);
        setRound(world.round);
        const minDim = Math.min(world.width, world.height) || 1;
        setWindDisplay(Math.round((world.windAccel / minDim) * 100));
        if (world.isOver) setIsOver(true);

        if (world.ready && pointerAimId === null) {
          if (input.isKeyDown("arrowleft") || input.isKeyDown("a")) {
            aimAngle -= KEY_ROTATE_SPEED * deltaSeconds;
          }
          if (input.isKeyDown("arrowright") || input.isKeyDown("d")) {
            aimAngle += KEY_ROTATE_SPEED * deltaSeconds;
          }
          if (input.isKeyDown("arrowup") || input.isKeyDown("w")) {
            aimPower = Math.min(1, aimPower + KEY_POWER_SPEED * deltaSeconds);
          }
          if (input.isKeyDown("arrowdown") || input.isKeyDown("s")) {
            aimPower = Math.max(MIN_POWER, aimPower - KEY_POWER_SPEED * deltaSeconds);
          }
          aimAngle = Math.min(ANGLE_MAX, Math.max(ANGLE_MIN, aimAngle));
        }

        // 空と地面(静止した背景だが他のGraphicsと同じ描画サイクルに合わせて毎フレーム描く)
        skyGraphics.clear();
        skyGraphics.rect(0, 0, world.width, world.groundY).fill({ color: 0x1c2b3c });
        groundGraphics.clear();
        groundGraphics
          .rect(0, world.groundY, world.width, world.height - world.groundY)
          .fill({ color: 0x2f4a33 });

        // 風見の旗。常に揺れることで「画面が動いている」ことを示す装飾でもある。
        const minDimNow = Math.min(world.width, world.height);
        const flagPoleX = world.width * 0.06;
        const flagPoleTopY = world.height * 0.18;
        const windLean = Math.max(-1, Math.min(1, world.windAccel / (minDimNow * 0.34)));
        const flutter = Math.sin(elapsedSeconds * 6) * 0.12;
        const flagLength = minDimNow * (0.07 + Math.abs(windLean) * 0.05);
        flagGraphics.clear();
        flagGraphics
          .moveTo(flagPoleX, flagPoleTopY)
          .lineTo(flagPoleX, world.groundY)
          .stroke({ width: 3, color: 0x9aa0ac });
        const flagDir = windLean >= 0 ? 1 : -1;
        const flagTipX = flagPoleX + flagDir * flagLength * (0.8 + flutter);
        flagGraphics
          .moveTo(flagPoleX, flagPoleTopY)
          .lineTo(flagTipX, flagPoleTopY + minDimNow * 0.035)
          .lineTo(flagPoleX, flagPoleTopY + minDimNow * 0.07)
          .closePath()
          .fill({ color: 0xffb454, alpha: 0.9 });

        // 的(外側のリングから塗ることで同心円に見せる)
        targetGraphics.clear();
        const outerRadius = world.target.rings[world.target.rings.length - 1]?.radius ?? 0;
        targetGraphics
          .moveTo(world.target.x, world.target.centerY + outerRadius)
          .lineTo(world.target.x, world.groundY)
          .stroke({ width: 4, color: 0x5a4632 });
        for (let i = world.target.rings.length - 1; i >= 0; i--) {
          const ring = world.target.rings[i];
          targetGraphics
            .circle(world.target.x, world.target.centerY, ring.radius)
            .fill({ color: ringColor(ring) });
        }

        // 弓と、狙い中の矢(ドラッグ量/キー入力ぶん後ろに引かれる)
        bowGraphics.clear();
        bowGraphics
          .arc(
            world.anchorX - minDimNow * 0.015,
            world.anchorY,
            minDimNow * 0.055,
            -Math.PI * 0.62,
            Math.PI * 0.62,
          )
          .stroke({ width: 3, color: 0xc9a46a });
        if (world.ready) {
          const forward = { x: Math.cos(aimAngle), y: Math.sin(aimAngle) };
          const tipX = world.anchorX + forward.x * minDimNow * 0.02;
          const tipY = world.anchorY + forward.y * minDimNow * 0.02;
          const drawLength = minDimNow * (0.03 + aimPower * 0.1);
          const tailX = world.anchorX - forward.x * drawLength;
          const tailY = world.anchorY - forward.y * drawLength;
          bowGraphics.moveTo(tailX, tailY).lineTo(tipX, tipY).stroke({ width: 3, color: 0xf2f3f5 });
          bowGraphics.circle(tipX, tipY, 3).fill({ color: 0xffe066 });
        }

        // 飛行中の矢と軌跡
        trailGraphics.clear();
        arrowGraphics.clear();
        if (world.arrow) {
          const arrow = world.arrow;
          const trail = arrow.trail;
          for (let i = 1; i < trail.length; i++) {
            const alpha = i / trail.length;
            trailGraphics
              .moveTo(trail[i - 1].x, trail[i - 1].y)
              .lineTo(trail[i].x, trail[i].y)
              .stroke({ width: 2, color: 0xf2f3f5, alpha: alpha * 0.6 });
          }
          const heading = Math.atan2(arrow.vy, arrow.vx);
          const shaftLength = minDimNow * 0.03;
          const headX = arrow.x + Math.cos(heading) * shaftLength;
          const headY = arrow.y + Math.sin(heading) * shaftLength;
          arrowGraphics
            .moveTo(
              arrow.x - Math.cos(heading) * shaftLength,
              arrow.y - Math.sin(heading) * shaftLength,
            )
            .lineTo(headX, headY)
            .stroke({ width: 3, color: 0xf2f3f5 });
          arrowGraphics.circle(headX, headY, 2.5).fill({ color: 0xffe066 });
        }

        for (let i = floatingTexts.length - 1; i >= 0; i--) {
          const entry = floatingTexts[i];
          entry.age += deltaSeconds;
          entry.text.position.y -= deltaSeconds * 26;
          entry.text.alpha = Math.max(0, 1 - entry.age / POPUP_LIFETIME);
          if (entry.age >= POPUP_LIFETIME) {
            popupContainer.removeChild(entry.text);
            entry.text.destroy();
            floatingTexts.splice(i, 1);
          }
        }
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => {
          if (loop.isPaused || !world.ready || pointerAimId !== null) return;
          pointerAimId = pointer.id;
          pointerAnchor = { x: pointer.x, y: pointer.y };
        },
        onPointerMove: (pointer) => {
          if (pointer.id !== pointerAimId) return;
          const dx = pointer.x - pointerAnchor.x;
          const dy = pointer.y - pointerAnchor.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 2) return;
          const rawAngle = Math.atan2(-dy, -dx);
          aimAngle = Math.min(ANGLE_MAX, Math.max(ANGLE_MIN, rawAngle));
          aimPower = Math.min(1, dist / world.maxDrag);
        },
        onPointerUp: (pointer) => {
          if (pointer.id !== pointerAimId) return;
          pointerAimId = null;
          if (loop.isPaused) return;
          const dist = Math.hypot(pointer.x - pointerAnchor.x, pointer.y - pointerAnchor.y);
          if (dist < MIN_LAUNCH_DRAG) return;
          const { vx, vy } = computeAimVelocity();
          world.fire(vx, vy);
        },
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
          } else if (key === "enter") {
            if (!loop.isPaused && world.ready) {
              const { vx, vy } = computeAimVelocity();
              world.fire(vx, vy);
            }
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

  const handleTogglePause = () => {
    if (!loopRef.current) return;
    setIsPaused(loopRef.current.togglePause());
  };

  const handleRestart = () => {
    worldRef.current?.reset();
    setIsOver(false);
    if (loopRef.current?.isPaused) {
      loopRef.current.resume();
      setIsPaused(false);
    }
  };

  const windLabel =
    windDisplay === 0
      ? "無風"
      : windDisplay > 0
        ? `→ ${windDisplay}`
        : `← ${Math.abs(windDisplay)}`;

  return (
    <GameShell
      title="Longbow Breeze"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner}>
        <div ref={canvasHostRef} className={styles.canvasHost} />
        <div className={styles.hud}>
          <span className={styles.badge} data-testid="longbow-breeze-lives">
            {"♥".repeat(Math.max(0, lives))}
          </span>
          <span className={styles.badge} data-testid="longbow-breeze-wind">
            風 {windLabel}
          </span>
          <span className={styles.badge} data-testid="longbow-breeze-round">
            {round + 1}射目
          </span>
        </div>
        <div className={styles.hint}>
          ドラッグして引っ張り、離すと逆方向へ矢を放つ(矢印キー/WASDで角度・パワー調整 +
          Enterでも可)。風見の旗を見て風を読み、的の中心を狙おう。外すか的に届かないとライフが減る。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="longbow-breeze-game-over">
            <div className={styles.gameOverTitle}>矢が尽きた</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="longbow-breeze-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
