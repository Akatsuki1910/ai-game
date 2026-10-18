"use client";

import { Application, Graphics } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import styles from "./AugerDropGame.module.scss";
import {
  AugerDropWorld,
  CURIOUS_RADIUS,
  FISH_RADIUS,
  type FishKind,
  LURE_RADIUS,
  REEL_PROGRESS_MAX,
  TENSION_MAX,
  WARMTH_MAX,
} from "./engine/world";

const KEY_AIM_OFFSET = 70; // px。キーボード操作時、ルアーの進みたい向きに置く仮の狙点との距離
const MESSAGE_LIFETIME_MS = 1200;

const FISH_COLOR: Record<FishKind, number> = { small: 0x9ec8ff, big: 0xffd166 };
const HOLE_COLOR = 0x08131f;
const LURE_COLOR = 0xf2f5f8;
const LINE_COLOR = 0xcfe8ff;

export function AugerDropGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [catches, setCatches] = useState(0);
  const [warmth, setWarmth] = useState(WARMTH_MAX);
  const [tension, setTension] = useState(0);
  const [reelProgress, setReelProgress] = useState(0);
  const [hookedKind, setHookedKind] = useState<FishKind | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const holeMarkerRef = useRef<HTMLDivElement | null>(null);
  const lureMarkerRef = useRef<HTMLDivElement | null>(null);
  const fishMarkerRefs = useRef<Array<HTMLDivElement | null>>([]);
  const worldRef = useRef<AugerDropWorld | null>(null);
  const appRef = useRef<Application | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const messageTimeoutRef = useRef<number | null>(null);

  const showMessage = useCallback((text: string) => {
    setMessage(text);
    if (messageTimeoutRef.current !== null) window.clearTimeout(messageTimeoutRef.current);
    messageTimeoutRef.current = window.setTimeout(() => setMessage(null), MESSAGE_LIFETIME_MS);
  }, []);

  const handleTogglePause = useCallback(() => {
    if (!loopRef.current) return;
    setIsPaused(loopRef.current.togglePause());
  }, []);

  const handleRestart = useCallback(() => {
    worldRef.current?.reset();
    setIsOver(false);
    if (messageTimeoutRef.current !== null) window.clearTimeout(messageTimeoutRef.current);
    setMessage(null);
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
    const world = new AugerDropWorld(1, 1);
    worldRef.current = world;

    const waterGraphics = new Graphics();
    const lineGraphics = new Graphics();
    const fishGraphics = new Graphics();
    const lureGraphics = new Graphics();

    let draggingPointerId: number | null = null;
    let isPointerDown = false;
    let pointerX = 0;
    let pointerY = 0;

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x02070d,
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
      app.stage.addChild(waterGraphics, lineGraphics, fishGraphics, lureGraphics);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        let isHoldingNow = false;
        if (isPointerDown) {
          world.setAimTarget(pointerX, pointerY);
          isHoldingNow = true;
        } else {
          let kx = 0;
          let ky = 0;
          if (input.isKeyDown("arrowleft") || input.isKeyDown("a")) kx -= 1;
          if (input.isKeyDown("arrowright") || input.isKeyDown("d")) kx += 1;
          if (input.isKeyDown("arrowup") || input.isKeyDown("w")) ky -= 1;
          if (input.isKeyDown("arrowdown") || input.isKeyDown("s")) ky += 1;

          if (kx !== 0 || ky !== 0) {
            const length = Math.hypot(kx, ky) || 1;
            world.setAimTarget(
              world.lure.x + (kx / length) * KEY_AIM_OFFSET,
              world.lure.y + (ky / length) * KEY_AIM_OFFSET,
            );
            isHoldingNow = true;
          } else if (input.isKeyDown("enter")) {
            world.setAimTarget(world.lure.x, world.lure.y);
            isHoldingNow = true;
          }
        }
        world.setHolding(isHoldingNow);

        world.step(deltaSeconds);
        setScore(world.score);
        setCatches(world.catches);
        setWarmth(world.warmth);
        setTension(world.tension);
        setReelProgress(world.reelProgress);
        setHookedKind(world.hookedIndex !== null ? world.fish[world.hookedIndex].kind : null);
        if (world.isOver) setIsOver(true);

        // 氷の下の水面。穴だけ暗く抜く。
        waterGraphics
          .clear()
          .rect(0, 0, world.width, world.height)
          .fill({ color: 0x0d2438, alpha: 1 })
          .rect(0, 0, world.width, Math.max(0, world.hole.y - 6))
          .fill({ color: 0x02070d, alpha: 1 })
          .circle(world.hole.x, world.hole.y, 34)
          .fill({ color: HOLE_COLOR, alpha: 1 })
          .circle(world.hole.x, world.hole.y, 34)
          .stroke({ width: 3, color: LINE_COLOR, alpha: 0.5 });

        lineGraphics.clear().moveTo(world.hole.x, world.hole.y).lineTo(world.lure.x, world.lure.y);
        const lineAlpha = world.hookedIndex !== null ? 0.85 : 0.35;
        lineGraphics.stroke({ width: 2, color: LINE_COLOR, alpha: lineAlpha });

        fishGraphics.clear();
        for (const f of world.fish) {
          const radius = FISH_RADIUS[f.kind];
          const dist = Math.hypot(f.x - world.lure.x, f.y - world.lure.y);
          const isCurious = world.hookedIndex === null && dist < CURIOUS_RADIUS;
          const glowAlpha = isCurious ? 0.25 + (f.interest / 100) * 0.5 : 0;
          if (glowAlpha > 0) {
            fishGraphics
              .circle(f.x, f.y, radius + 8)
              .fill({ color: FISH_COLOR[f.kind], alpha: glowAlpha });
          }
          const heading = Math.atan2(f.vy, f.vx);
          const tipX = f.x + Math.cos(heading) * radius * 1.3;
          const tipY = f.y + Math.sin(heading) * radius * 1.3;
          const backX = f.x - Math.cos(heading) * radius;
          const backY = f.y - Math.sin(heading) * radius;
          const leftX = backX + Math.cos(heading + Math.PI / 2) * radius * 0.7;
          const leftY = backY + Math.sin(heading + Math.PI / 2) * radius * 0.7;
          const rightX = backX + Math.cos(heading - Math.PI / 2) * radius * 0.7;
          const rightY = backY + Math.sin(heading - Math.PI / 2) * radius * 0.7;
          fishGraphics
            .poly([tipX, tipY, leftX, leftY, rightX, rightY])
            .fill({ color: FISH_COLOR[f.kind], alpha: 0.95 });
        }

        const tensionRatio = world.tension / TENSION_MAX;
        const lureColor =
          world.hookedIndex !== null
            ? tensionRatio > 0.75
              ? 0xff6b6b
              : tensionRatio > 0.45
                ? 0xffd166
                : LURE_COLOR
            : LURE_COLOR;
        lureGraphics
          .clear()
          .circle(world.lure.x, world.lure.y, LURE_RADIUS)
          .fill({ color: lureColor, alpha: 0.95 });

        if (holeMarkerRef.current) {
          holeMarkerRef.current.style.left = `${world.hole.x}px`;
          holeMarkerRef.current.style.top = `${world.hole.y}px`;
        }
        if (lureMarkerRef.current) {
          lureMarkerRef.current.style.left = `${world.lure.x}px`;
          lureMarkerRef.current.style.top = `${world.lure.y}px`;
        }
        world.fish.forEach((f, i) => {
          const marker = fishMarkerRefs.current[i];
          if (!marker) return;
          marker.style.left = `${f.x}px`;
          marker.style.top = `${f.y}px`;
        });
      }, 0.1);

      world.onBite = () => showMessage("食いついた!");
      world.onCatch = ({ points, kind }) =>
        showMessage(`${kind === "big" ? "大物" : "釣果"} +${points}`);
      world.onLost = () => showMessage("逃げられた…");
      world.onFrozen = () => showMessage("冷えきった…");

      input.addListener({
        onPointerDown: (pointer) => {
          if (draggingPointerId !== null) return;
          draggingPointerId = pointer.id;
          isPointerDown = true;
          pointerX = pointer.x;
          pointerY = pointer.y;
        },
        onPointerMove: (pointer) => {
          if (pointer.id !== draggingPointerId) return;
          pointerX = pointer.x;
          pointerY = pointer.y;
        },
        onPointerUp: (pointer) => {
          if (pointer.id !== draggingPointerId) return;
          draggingPointerId = null;
          isPointerDown = false;
        },
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
          } else if (key === "r") {
            world.reset();
            setIsOver(false);
            if (messageTimeoutRef.current !== null) window.clearTimeout(messageTimeoutRef.current);
            setMessage(null);
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
      if (messageTimeoutRef.current !== null) window.clearTimeout(messageTimeoutRef.current);
      if (appRef.current) {
        appRef.current.destroy(true, { children: true });
        appRef.current = null;
      }
    };
  }, [showMessage]);

  useEffect(() => {
    if (size.width === 0 || size.height === 0) return;
    worldRef.current?.resize(size.width, size.height);
  }, [size.width, size.height]);

  return (
    <GameShell
      title="Auger Drop"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="auger-drop-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="auger-drop-canvas" />
        <div
          ref={holeMarkerRef}
          className={styles.holeMarker}
          data-testid="auger-drop-hole-marker"
        />
        <div
          ref={lureMarkerRef}
          className={styles.lureMarker}
          data-testid="auger-drop-lure-marker"
        />
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            ref={(el) => {
              fishMarkerRefs.current[i] = el;
            }}
            className={styles.fishMarker}
            data-testid={`auger-drop-fish-marker-${i}`}
          />
        ))}
        <div className={styles.hud}>
          <div className={styles.catches} data-testid="auger-drop-catches">
            釣果 {catches}
          </div>
          <span className={styles.hudLabel}>あたたかさ</span>
          <div className={styles.warmthBar} data-testid="auger-drop-warmth">
            <div
              className={styles.warmthFill}
              style={{ width: `${Math.max(0, Math.min(100, (warmth / WARMTH_MAX) * 100))}%` }}
            />
          </div>
          <span className={styles.hudLabel}>
            テンション{hookedKind ? `(${hookedKind === "big" ? "大物" : "小物"})` : ""}
          </span>
          <div
            className={`${styles.tensionBar} ${hookedKind ? styles.tensionBarActive : ""}`}
            data-testid="auger-drop-tension"
          >
            <div
              className={styles.tensionFill}
              style={{ width: `${Math.max(0, Math.min(100, (tension / TENSION_MAX) * 100))}%` }}
            />
          </div>
          <span className={styles.hudLabel}>リール</span>
          <div
            className={`${styles.reelBar} ${hookedKind ? styles.reelBarActive : ""}`}
            data-testid="auger-drop-reel-progress"
          >
            <div
              className={styles.reelFill}
              style={{
                width: `${Math.max(0, Math.min(100, (reelProgress / REEL_PROGRESS_MAX) * 100))}%`,
              }}
            />
          </div>
        </div>
        {message && (
          <div className={styles.message} data-testid="auger-drop-message">
            {message}
          </div>
        )}
        <div className={styles.hint}>
          ドラッグ/長押しでルアーを操作。魚の近くで素早く揺すって誘おう。食いついたらそのまま長押しでリール、テンションが上がりすぎたら離して落ち着かせよう。矢印キー/WASD:
          ルアー操作 / Enter: その場で長押し(リール) / Space: 一時停止 / R: リセット
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="auger-drop-gameover">
            <div className={styles.gameOverTitle}>冷えきった…</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <div className={styles.gameOverCatches}>釣果 {catches}匹</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="auger-drop-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
