"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import { MAX_ACTIVE_TRUFFLES, MISS_LIMIT, TruffleTrailWorld } from "./engine/world";
import styles from "./TruffleTrailGame.module.scss";

const KEYBOARD_REACH = 800;
const POPUP_LIFETIME = 0.9;
const MISS_FLASH_DURATION = 0.4;
const TREE_SPOTS = [
  [0.08, 0.15],
  [0.92, 0.1],
  [0.15, 0.85],
  [0.85, 0.9],
  [0.04, 0.5],
  [0.96, 0.55],
  [0.5, 0.05],
] as const satisfies ReadonlyArray<readonly [number, number]>;
/** 操作していない間も画面が止まって見えないよう漂わせる虫の光。見た目だけでゲーム性には影響しない。 */
const FIREFLY_SEEDS = [
  { yRatio: 0.25, speed: 26, bobAmplitude: 10, bobSpeed: 1.3 },
  { yRatio: 0.55, speed: -19, bobAmplitude: 8, bobSpeed: 1.7 },
  { yRatio: 0.75, speed: 22, bobAmplitude: 12, bobSpeed: 0.9 },
] as const satisfies ReadonlyArray<{
  yRatio: number;
  speed: number;
  bobAmplitude: number;
  bobSpeed: number;
}>;

interface FloatingScore {
  text: Text;
  age: number;
}

export function TruffleTrailGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [scentPercent, setScentPercent] = useState(0);
  const [missed, setMissed] = useState(0);
  const [dugCount, setDugCount] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<TruffleTrailWorld | null>(null);
  const appRef = useRef<Application | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const markerRefs = useRef<Array<HTMLDivElement | null>>([]);

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
    const world = new TruffleTrailWorld(1, 1);
    worldRef.current = world;

    const groundGraphics = new Graphics();
    const fireflyGraphics = new Graphics();
    const scentGraphics = new Graphics();
    const truffleGraphics = new Graphics();
    const dogGraphics = new Graphics();
    const flashGraphics = new Graphics();
    const popupContainer = new Container();
    const floatingScores: FloatingScore[] = [];

    let drawnGroundWidth = -1;
    let drawnGroundHeight = -1;
    let facingAngle = 0;
    let missFlashAge = MISS_FLASH_DURATION;
    let isPointerDown = false;
    let pointerX = 0;
    let pointerY = 0;
    let elapsedTime = 0;

    world.onTruffleDug = ({ points }) => {
      const text = new Text({
        text: `+${points}`,
        style: { fill: 0xffe066, fontSize: 18, fontWeight: "700" },
      });
      text.anchor.set(0.5, 1);
      text.position.set(world.dogX, world.dogY - 28);
      popupContainer.addChild(text);
      floatingScores.push({ text, age: 0 });
    };

    world.onTruffleLost = () => {
      missFlashAge = 0;
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x0a0d08,
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
        groundGraphics,
        fireflyGraphics,
        scentGraphics,
        truffleGraphics,
        dogGraphics,
        popupContainer,
        flashGraphics,
      );
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        if (isPointerDown) {
          world.setMoveTarget(pointerX, pointerY);
        } else {
          let kx = 0;
          let ky = 0;
          if (input.isKeyDown("arrowleft") || input.isKeyDown("a")) kx -= 1;
          if (input.isKeyDown("arrowright") || input.isKeyDown("d")) kx += 1;
          if (input.isKeyDown("arrowup") || input.isKeyDown("w")) ky -= 1;
          if (input.isKeyDown("arrowdown") || input.isKeyDown("s")) ky += 1;

          if (kx !== 0 || ky !== 0) {
            const length = Math.hypot(kx, ky) || 1;
            world.setMoveTarget(
              world.dogX + (kx / length) * KEYBOARD_REACH,
              world.dogY + (ky / length) * KEYBOARD_REACH,
            );
          } else {
            world.setMoveTarget(world.dogX, world.dogY);
          }
        }
        world.setDigHeld(isPointerDown || input.isKeyDown("enter"));

        world.step(deltaSeconds);
        elapsedTime += deltaSeconds;
        missFlashAge = Math.min(MISS_FLASH_DURATION, missFlashAge + deltaSeconds);

        setScore(world.score);
        setScentPercent(Math.round(world.scentStrength * 100));
        setMissed(world.missed);
        setDugCount(world.dugCount);
        if (world.isOver) setIsOver(true);

        if (drawnGroundWidth !== world.width || drawnGroundHeight !== world.height) {
          drawnGroundWidth = world.width;
          drawnGroundHeight = world.height;
          groundGraphics.clear();
          groundGraphics.rect(0, 0, world.width, world.height).fill({ color: 0x1b2412 });
          const treeRadius = Math.min(world.width, world.height) * 0.05;
          for (const [ratioX, ratioY] of TREE_SPOTS) {
            groundGraphics
              .circle(ratioX * world.width, ratioY * world.height, treeRadius)
              .fill({ color: 0x24311a, alpha: 0.8 });
          }
        }

        const distanceToTarget = Math.hypot(world.targetX - world.dogX, world.targetY - world.dogY);
        if (distanceToTarget > 2) {
          facingAngle = Math.atan2(world.targetY - world.dogY, world.targetX - world.dogX);
        }

        // 操作していない間も画面が止まって見えないよう、常に漂う蛍の光を描く。
        fireflyGraphics.clear();
        for (const firefly of FIREFLY_SEEDS) {
          const spanWidth = world.width + 60;
          const traveled = ((elapsedTime * firefly.speed) % spanWidth) + spanWidth;
          const x = (traveled % spanWidth) - 30;
          const y =
            firefly.yRatio * world.height +
            Math.sin(elapsedTime * firefly.bobSpeed) * firefly.bobAmplitude;
          const twinkle = 0.4 + Math.sin(elapsedTime * firefly.bobSpeed * 2.3) * 0.3;
          fireflyGraphics.circle(x, y, 3).fill({ color: 0xffe066, alpha: Math.max(0.1, twinkle) });
        }

        scentGraphics.clear();
        // 匂いが0のときも犬が「くんくん」と息づいているのが分かるよう、常に弱く脈動させる。
        const sniffPulse = 0.85 + Math.sin(elapsedTime * 3.2) * 0.15;
        const scentRadius = (18 + world.scentStrength * 36) * sniffPulse;
        scentGraphics
          .circle(world.dogX, world.dogY, scentRadius)
          .stroke({ width: 2, color: 0xffe066, alpha: 0.18 + world.scentStrength * 0.6 });

        truffleGraphics.clear();
        const locatedTruffles = world.truffles.filter((truffle) => truffle.isLocated);
        for (const truffle of locatedTruffles) {
          const lifeRatio = Math.max(0, truffle.remainingSeconds / truffle.totalLifeSeconds);
          const moundColor = lifeRatio < 0.25 ? 0xff6b6b : 0x8a5a2b;
          truffleGraphics
            .ellipse(truffle.x, truffle.y, 20, 13)
            .fill({ color: moundColor, alpha: 0.9 })
            .stroke({ width: 2, color: 0xf2f3f5, alpha: 0.5 });
          if (truffle.digProgress > 0) {
            truffleGraphics
              .circle(truffle.x, truffle.y, 26)
              .stroke({ width: 3, color: 0x7cf5c4, alpha: 0.3 + truffle.digProgress * 0.6 });
          }
        }
        // 見つかったトリュフの正確な座標をDOM要素としても反映する（自動テストでの座標取得・将来のa11y用途のため）。
        // Reactの再描画を避けるため、refを介して直接スタイルを書き換える（ferro-bloomのtargetMarkerと同じ手法）。
        for (let slot = 0; slot < MAX_ACTIVE_TRUFFLES; slot++) {
          const marker = markerRefs.current[slot];
          if (!marker) continue;
          const truffle = locatedTruffles[slot];
          if (truffle) {
            marker.style.left = `${truffle.x}px`;
            marker.style.top = `${truffle.y}px`;
            marker.style.display = "block";
          } else {
            marker.style.display = "none";
          }
        }

        dogGraphics.clear();
        dogGraphics
          .circle(world.dogX, world.dogY, 18)
          .fill({ color: 0xc98b4a })
          .stroke({ width: 2, color: 0x5c3a1a, alpha: 0.8 });
        const noseX = world.dogX + Math.cos(facingAngle) * 20;
        const noseY = world.dogY + Math.sin(facingAngle) * 20;
        dogGraphics.circle(noseX, noseY, 6).fill({ color: 0x3a2412 });

        flashGraphics.clear();
        if (missFlashAge < MISS_FLASH_DURATION) {
          const alpha = 0.3 * (1 - missFlashAge / MISS_FLASH_DURATION);
          flashGraphics.rect(0, 0, world.width, world.height).fill({ color: 0xff3b3b, alpha });
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
          isPointerDown = true;
          pointerX = pointer.x;
          pointerY = pointer.y;
        },
        onPointerMove: (pointer) => {
          pointerX = pointer.x;
          pointerY = pointer.y;
        },
        onPointerUp: () => {
          isPointerDown = false;
        },
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
      title="Truffle Trail"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="truffle-trail-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="truffle-trail-canvas" />
        {Array.from({ length: MAX_ACTIVE_TRUFFLES }, (_, slot) => slot).map((slot) => (
          <div
            key={slot}
            ref={(element) => {
              markerRefs.current[slot] = element;
            }}
            className={styles.locatedMarker}
            data-testid={`truffle-trail-located-marker-${slot}`}
          />
        ))}
        <div className={styles.hud}>
          <span className={styles.scentLabel} data-testid="truffle-trail-scent">
            👃 {scentPercent}%
          </span>
          <div className={styles.scentBar}>
            <div
              className={styles.scentFill}
              data-testid="truffle-trail-scent-bar"
              style={{ width: `${scentPercent}%` }}
            />
          </div>
          <span className={styles.missLabel} data-testid="truffle-trail-miss">
            MISS {missed}/{MISS_LIMIT}
          </span>
        </div>
        <div className={styles.hint}>
          ドラッグ/タップした位置へ犬を誘導しよう。匂いが強くなるほどトリュフに近い。見つけたら長押しで掘り出せ。
          掘りきれずに新鮮さが尽きると腐ってミスになる。掘るほど同時に探すトリュフが増える。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="truffle-trail-gameover">
            <div className={styles.gameOverTitle}>狩りは終わり</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <div className={styles.gameOverSub}>掘り出した数 {dugCount}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="truffle-trail-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
