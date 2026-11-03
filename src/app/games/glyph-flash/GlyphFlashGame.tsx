"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import { type Point, pathLength, trimPathToLength } from "./engine/path";
import { GlyphFlashWorld, type GlyphPhase, type RoundResult } from "./engine/world";
import styles from "./GlyphFlashGame.module.scss";

const CURSOR_KEY_SPEED = 360; // px/秒。キーボードでペンカーソルを動かす速さ
const PREVIEW_FADE_RATIO = 0.2; // お題が消える直前、残り時間の何割から薄くし始めるか
const POPUP_LIFETIME = 1.1;

const STATUS_TEXT: Record<GlyphPhase, string> = {
  preview: "形を覚えて…",
  trace: "なぞって再現!",
  result: "けっか",
};

interface FloatingPopup {
  text: Text;
  age: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function drawPolyline(
  graphics: Graphics,
  points: readonly Point[],
  style: { width: number; color: number; alpha: number },
): void {
  if (points.length < 2) return;
  graphics.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) graphics.lineTo(points[i].x, points[i].y);
  graphics.stroke(style);
}

function previewAlpha(world: GlyphFlashWorld): number {
  const fadeWindow = world.previewDuration * PREVIEW_FADE_RATIO;
  if (fadeWindow <= 0 || world.previewTimer >= fadeWindow) return 1;
  return clamp(world.previewTimer / fadeWindow, 0, 1);
}

function resultStatusText(result: RoundResult | null): string {
  if (!result) return STATUS_TEXT.result;
  return result.passed ? `せいかい! ${result.score}点` : `ざんねん… ${result.score}点`;
}

export function GlyphFlashGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [round, setRound] = useState(1);
  const [lives, setLives] = useState(3);
  const [phase, setPhase] = useState<GlyphPhase>("preview");
  const [lastResult, setLastResult] = useState<RoundResult | null>(null);
  const [targetPath, setTargetPath] = useState<Point[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<GlyphFlashWorld | null>(null);
  const appRef = useRef<Application | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const cursorRef = useRef<Point>({ x: 0, y: 0 });
  const hasCursorInitRef = useRef(false);
  const isPointerDrawingRef = useRef(false);
  const isKeyboardPenActiveRef = useRef(false);

  const handleTogglePause = useCallback(() => {
    if (!loopRef.current) return;
    setIsPaused(loopRef.current.togglePause());
  }, []);

  const handleRestart = useCallback(() => {
    worldRef.current?.reset();
    isPointerDrawingRef.current = false;
    isKeyboardPenActiveRef.current = false;
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
    const world = new GlyphFlashWorld(1, 1);
    worldRef.current = world;

    const backgroundGraphics = new Graphics();
    const targetGraphics = new Graphics();
    const drawnGraphics = new Graphics();
    const cursorGraphics = new Graphics();
    const gaugeGraphics = new Graphics();
    const popupHost = new Container();
    const floatingPopups: FloatingPopup[] = [];
    let drawnBackgroundWidth = -1;
    let drawnBackgroundHeight = -1;

    const syncTargetPath = (): void => setTargetPath([...world.targetPath]);

    world.onRoundStarted = syncTargetPath;
    world.onRoundResolved = (result) => {
      const popupColor = result.passed ? 0x7cf5c4 : 0xff6b6b;
      const text = new Text({
        text: resultStatusText(result),
        style: { fill: popupColor, fontSize: 20, fontWeight: "700" },
      });
      text.anchor.set(0.5, 0.5);
      text.position.set(world.width / 2, world.height * 0.3);
      popupHost.addChild(text);
      floatingPopups.push({ text, age: 0 });
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
      app.stage.addChild(
        backgroundGraphics,
        targetGraphics,
        drawnGraphics,
        cursorGraphics,
        gaugeGraphics,
        popupHost,
      );
      appRef.current = app;

      // onRoundStartedを割り当てる前に最初のラウンドが生成済みのため、ここで一度だけ反映する
      syncTargetPath();

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds, elapsedSeconds) => {
        if (!isPointerDrawingRef.current) {
          let kx = 0;
          let ky = 0;
          if (input.isKeyDown("arrowleft") || input.isKeyDown("a")) kx -= 1;
          if (input.isKeyDown("arrowright") || input.isKeyDown("d")) kx += 1;
          if (input.isKeyDown("arrowup") || input.isKeyDown("w")) ky -= 1;
          if (input.isKeyDown("arrowdown") || input.isKeyDown("s")) ky += 1;
          if (kx !== 0 || ky !== 0) {
            const length = Math.hypot(kx, ky) || 1;
            const next = {
              x: clamp(
                cursorRef.current.x + (kx / length) * CURSOR_KEY_SPEED * deltaSeconds,
                0,
                world.width,
              ),
              y: clamp(
                cursorRef.current.y + (ky / length) * CURSOR_KEY_SPEED * deltaSeconds,
                0,
                world.height,
              ),
            };
            cursorRef.current = next;
            if (isKeyboardPenActiveRef.current) world.extendStroke(next.x, next.y);
          }
        }

        world.step(deltaSeconds);

        setScore(world.score);
        setRound(world.round);
        setLives(world.lives);
        setPhase(world.phase);
        setLastResult(world.lastResult);
        if (world.isOver) setIsOver(true);

        const { width, height } = world;
        if (width <= 0 || height <= 0) return;

        if (drawnBackgroundWidth !== width || drawnBackgroundHeight !== height) {
          drawnBackgroundWidth = width;
          drawnBackgroundHeight = height;
          backgroundGraphics.clear().rect(0, 0, width, height).fill({ color: 0x0d0f16 });
        }

        targetGraphics.clear();
        if (world.phase === "preview") {
          const totalLength = pathLength(world.targetPath);
          const revealLength = totalLength * (1 - world.previewTimer / world.previewDuration);
          const revealed = trimPathToLength(world.targetPath, revealLength);
          drawPolyline(targetGraphics, revealed, {
            width: 4,
            color: 0xffe066,
            alpha: previewAlpha(world),
          });
        } else if (world.phase === "result") {
          drawPolyline(targetGraphics, world.targetPath, { width: 3, color: 0xffffff, alpha: 0.2 });
        }

        drawnGraphics.clear();
        const strokeColor =
          world.phase === "result" ? (world.lastResult?.passed ? 0x7cf5c4 : 0xff6b6b) : 0x6ee7ff;
        drawPolyline(drawnGraphics, world.drawnPath, { width: 4, color: strokeColor, alpha: 0.9 });

        cursorGraphics.clear();
        const pulse = 0.5 + 0.5 * Math.sin(elapsedSeconds * 5);
        const cursorColor = world.isStrokeActive ? 0xffe066 : 0x6ee7ff;
        const cursorAlpha = world.phase === "trace" ? 0.4 + 0.5 * pulse : 0.15 + 0.1 * pulse;
        cursorGraphics
          .circle(cursorRef.current.x, cursorRef.current.y, 9 + pulse * 3)
          .stroke({ width: 2, color: cursorColor, alpha: cursorAlpha });

        gaugeGraphics.clear();
        if (world.phase === "trace" && world.inkBudget > 0) {
          const ratio = clamp(world.inkRemaining / world.inkBudget, 0, 1);
          const gaugeWidth = Math.min(220, width * 0.5);
          const gaugeX = width / 2 - gaugeWidth / 2;
          const gaugeY = height - 28;
          gaugeGraphics
            .rect(gaugeX, gaugeY, gaugeWidth, 8)
            .fill({ color: 0x1b1e27, alpha: 0.8 })
            .rect(gaugeX, gaugeY, gaugeWidth * ratio, 8)
            .fill({ color: ratio > 0.3 ? 0x7cf5c4 : 0xff6b6b, alpha: 0.9 });
        }

        for (let i = floatingPopups.length - 1; i >= 0; i--) {
          const entry = floatingPopups[i];
          entry.age += deltaSeconds;
          entry.text.position.y -= deltaSeconds * 18;
          entry.text.alpha = Math.max(0, 1 - entry.age / POPUP_LIFETIME);
          if (entry.age >= POPUP_LIFETIME) {
            popupHost.removeChild(entry.text);
            entry.text.destroy();
            floatingPopups.splice(i, 1);
          }
        }
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => {
          if (loop.isPaused) return;
          cursorRef.current = { x: pointer.x, y: pointer.y };
          world.beginStroke(pointer.x, pointer.y);
          isPointerDrawingRef.current = world.isStrokeActive;
        },
        onPointerMove: (pointer) => {
          if (loop.isPaused) return;
          cursorRef.current = { x: pointer.x, y: pointer.y };
          if (isPointerDrawingRef.current) world.extendStroke(pointer.x, pointer.y);
        },
        onPointerUp: () => {
          if (isPointerDrawingRef.current) {
            isPointerDrawingRef.current = false;
            if (!loop.isPaused) world.endStroke();
          }
        },
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
          } else if (key === "r") {
            world.reset();
            isPointerDrawingRef.current = false;
            isKeyboardPenActiveRef.current = false;
            setIsOver(false);
          } else if (key === "enter") {
            if (loop.isPaused) return;
            if (isKeyboardPenActiveRef.current) {
              isKeyboardPenActiveRef.current = false;
              world.endStroke();
            } else if (world.phase === "trace") {
              isKeyboardPenActiveRef.current = true;
              world.beginStroke(cursorRef.current.x, cursorRef.current.y);
            }
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
    const world = worldRef.current;
    if (!world) return;
    world.resize(size.width, size.height);
    // お題の座標はリサイズで拡大縮小されるため、デバッグ用に公開しているReact側のコピーも
    // 取り直す(取り直さないと、テストが読む座標だけ古いまま=画面外を指してしまう)。
    setTargetPath([...world.targetPath]);
    if (!hasCursorInitRef.current) {
      cursorRef.current = { x: size.width / 2, y: size.height / 2 };
      hasCursorInitRef.current = true;
    } else {
      cursorRef.current = {
        x: clamp(cursorRef.current.x, 0, size.width),
        y: clamp(cursorRef.current.y, 0, size.height),
      };
    }
  }, [size.width, size.height]);

  const statusText = phase === "result" ? resultStatusText(lastResult) : STATUS_TEXT[phase];

  return (
    <GameShell
      title="Glyph Flash"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="glyph-flash-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="glyph-flash-canvas" />

        <div
          className={styles.debug}
          data-testid="glyph-flash-debug"
          data-phase={phase}
          data-round={round}
          data-lives={lives}
          data-target-path={JSON.stringify(targetPath)}
        />

        <div className={styles.hud}>
          <span className={styles.round} data-testid="glyph-flash-round">
            ROUND {round}
          </span>
          <span className={styles.lives} data-testid="glyph-flash-lives">
            ライフ {lives}
          </span>
        </div>

        <div className={styles.status} data-testid="glyph-flash-status">
          {statusText}
        </div>

        <div className={styles.hint}>
          一瞬だけ光る形を覚えて、消えたらその通りになぞろう。ドラッグでなぞる、インクが尽きたら打ち切り。
          キーボードは矢印/WASDでペンを移動、Enterでペンを下ろす/上げる。
        </div>

        {isOver && (
          <div className={styles.gameOver} data-testid="glyph-flash-gameover">
            <div className={styles.gameOverTitle}>ゲームオーバー</div>
            <div className={styles.gameOverScore}>
              SCORE {score.toLocaleString("ja-JP")} / ROUND {round}
            </div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="glyph-flash-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
