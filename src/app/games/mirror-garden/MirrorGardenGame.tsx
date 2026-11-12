"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import { getPanelRects, type Rect, toAbsolute } from "./engine/gardenLayout.ts";
import {
  type ElementType,
  type GardenElement,
  type MutationKind,
  PALETTES,
} from "./engine/gardenScene.ts";
import { type DifferenceFoundEvent, GardenWorld } from "./engine/gardenWorld.ts";
import styles from "./MirrorGardenGame.module.scss";

// px/秒。キーボードでカーソルを動かす速さ。
// GameLoopのdeltaは最大0.1秒にクランプされるため、フレーム供給が乱れる環境でも
// 1フレームあたりの移動量(speed*0.1)が最小ラウンドの当たり判定半径を超えないよう抑えている。
const SELECTOR_KEY_SPEED = 120;
const POPUP_LIFETIME = 1.1;
const PETAL_COUNT = 10;

const SELECTOR_COLOR = 0x6ee7ff;
const PANEL_BG_COLOR = 0x1b2a1e;
const PANEL_BORDER_COLOR = 0x3f5a42;
const PANEL_LABEL_COLOR = 0xcfe6c9;
const POPUP_FOUND_COLOR = 0xffe066;
const POPUP_MISS_COLOR = 0xff6b6b;
const POPUP_CLEAR_COLOR = 0x7cf5c4;
const POPUP_TIMEOUT_COLOR = 0xff8a3d;
const PETAL_COLOR = 0xffc9de;

interface Petal {
  xFraction: number;
  y: number;
  speed: number;
  driftPhase: number;
  size: number;
}

interface FloatingPopup {
  text: Text;
  age: number;
}

interface DiffAnchor {
  elementId: number;
  mutation: MutationKind;
  x: number;
  y: number;
}

/** まだ見つかっていない差分の、パネルB側での現在の絶対座標一覧を作る(テスト/キーボードの目印用)。 */
function computeDiffAnchors(world: GardenWorld): DiffAnchor[] {
  const rects = getPanelRects(world.width, world.height);
  const anchors: DiffAnchor[] = [];
  for (const spot of world.scene.differences) {
    if (spot.isFound) continue;
    const element = world.scene.elementsB.find((e) => e.id === spot.elementId);
    if (!element) continue;
    const abs = toAbsolute(rects.b, element);
    anchors.push({ elementId: spot.elementId, mutation: spot.mutation, x: abs.x, y: abs.y });
  }
  return anchors;
}

function createPetals(): Petal[] {
  return Array.from({ length: PETAL_COUNT }, () => ({
    xFraction: Math.random(),
    y: Math.random() * -400,
    speed: 18 + Math.random() * 22,
    driftPhase: Math.random() * Math.PI * 2,
    size: 3 + Math.random() * 3,
  }));
}

function drawElement(
  g: Graphics,
  rect: Rect,
  element: GardenElement,
  elapsedSeconds: number,
): void {
  const abs = toAbsolute(rect, element);
  const radius = element.size * Math.min(rect.width, rect.height);
  const color = PALETTES[element.type][element.colorIndex];

  switch (element.type as ElementType) {
    case "stone": {
      g.ellipse(abs.x, abs.y, radius * 1.1, radius * 0.8)
        .fill({ color, alpha: 0.95 })
        .stroke({ width: 2, color: 0x20261f, alpha: 0.35 });
      return;
    }
    case "lantern": {
      const postWidth = radius * 0.5;
      g.roundRect(abs.x - postWidth / 2, abs.y, postWidth, radius * 0.9, 2).fill({
        color: 0x6b4226,
      });
      const glowAlpha = 0.55 + 0.35 * Math.sin(elapsedSeconds * 2.4 + element.id);
      g.circle(abs.x, abs.y - radius * 0.15, radius * 0.6).fill({ color, alpha: glowAlpha });
      g.poly([
        abs.x - radius * 0.75,
        abs.y - radius * 0.55,
        abs.x + radius * 0.75,
        abs.y - radius * 0.55,
        abs.x,
        abs.y - radius * 1.25,
      ]).fill({ color: 0x6b4226, alpha: 0.9 });
      return;
    }
    case "bush": {
      g.circle(abs.x - radius * 0.35, abs.y + radius * 0.1, radius * 0.6).fill({
        color,
        alpha: 0.95,
      });
      g.circle(abs.x + radius * 0.35, abs.y + radius * 0.1, radius * 0.6).fill({
        color,
        alpha: 0.95,
      });
      g.circle(abs.x, abs.y - radius * 0.25, radius * 0.65).fill({ color, alpha: 0.95 });
      return;
    }
    case "koi": {
      g.ellipse(abs.x, abs.y, radius, radius * 0.6).fill({ color, alpha: 0.95 });
      g.poly([
        abs.x - radius,
        abs.y,
        abs.x - radius * 1.6,
        abs.y - radius * 0.5,
        abs.x - radius * 1.6,
        abs.y + radius * 0.5,
      ]).fill({ color, alpha: 0.85 });
      g.circle(abs.x + radius * 0.55, abs.y - radius * 0.1, radius * 0.08).fill({
        color: 0x14161d,
      });
      return;
    }
    case "bridge": {
      g.roundRect(abs.x - radius * 1.2, abs.y - radius * 0.35, radius * 2.4, radius * 0.7, 4).fill({
        color,
        alpha: 0.95,
      });
      g.rect(abs.x - radius * 1.2, abs.y - radius * 0.05, radius * 2.4, 2).fill({
        color: 0x2c1b0f,
        alpha: 0.5,
      });
      return;
    }
  }
}

function drawPanelBackground(g: Graphics, rect: Rect): void {
  if (rect.width <= 0 || rect.height <= 0) return;
  g.roundRect(rect.x, rect.y, rect.width, rect.height, 16)
    .fill({ color: PANEL_BG_COLOR, alpha: 0.92 })
    .stroke({ width: 2, color: PANEL_BORDER_COLOR, alpha: 0.7 });
}

export function MirrorGardenGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [round, setRound] = useState(1);
  const [lives, setLives] = useState(3);
  const [remaining, setRemaining] = useState(0);
  const [totalDiffs, setTotalDiffs] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);
  const [diffAnchors, setDiffAnchors] = useState<DiffAnchor[]>([]);
  const [selectorPosition, setSelectorPosition] = useState({ x: 0, y: 0 });

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<GardenWorld | null>(null);
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
    const world = new GardenWorld(1, 1);
    worldRef.current = world;

    const panelGraphics = new Graphics();
    const elementGraphics = new Graphics();
    const petalGraphics = new Graphics();
    const selectorGraphics = new Graphics();
    const popupHost = new Container();
    const labelA = new Text({
      text: "A: もとの庭",
      style: { fill: PANEL_LABEL_COLOR, fontSize: 13, fontWeight: "700" },
    });
    const labelB = new Text({
      text: "B: 見比べる庭",
      style: { fill: PANEL_LABEL_COLOR, fontSize: 13, fontWeight: "700" },
    });
    const petals = createPetals();
    const floatingPopups: FloatingPopup[] = [];
    const lastInteractionPoint = { x: 0, y: 0 };

    const syncDiffAnchors = (): void => {
      setDiffAnchors(computeDiffAnchors(world));
    };

    const spawnPopup = (label: string, color: number, x: number, y: number): void => {
      const text = new Text({
        text: label,
        style: { fill: color, fontSize: 16, fontWeight: "700" },
      });
      text.anchor.set(0.5, 1);
      text.position.set(x, y);
      popupHost.addChild(text);
      floatingPopups.push({ text, age: 0 });
    };

    world.onDifferenceFound = ({ spot, points, panel }: DifferenceFoundEvent) => {
      const rects = getPanelRects(world.width, world.height);
      const rect = panel === "a" ? rects.a : rects.b;
      const element = world.scene.elementsA.find((e) => e.id === spot.elementId);
      if (element) {
        const abs = toAbsolute(rect, element);
        spawnPopup(`+${points}`, POPUP_FOUND_COLOR, abs.x, abs.y);
      }
      syncDiffAnchors();
    };
    world.onWrongGuess = () => {
      spawnPopup("ちがう…", POPUP_MISS_COLOR, lastInteractionPoint.x, lastInteractionPoint.y);
    };
    world.onRoundCleared = () => {
      spawnPopup("見比べクリア!", POPUP_CLEAR_COLOR, world.width / 2, Math.min(60, world.height));
    };
    world.onRoundTimedOut = () => {
      spawnPopup("じかんぎれ…", POPUP_TIMEOUT_COLOR, world.width / 2, Math.min(60, world.height));
    };
    world.onRoundStarted = syncDiffAnchors;

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x0b140c,
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
        petalGraphics,
        panelGraphics,
        elementGraphics,
        labelA,
        labelB,
        selectorGraphics,
        popupHost,
      );
      appRef.current = app;

      // onRoundStartedを割り当てる前に最初のラウンドが生成済みのため、ここで一度だけ反映する
      syncDiffAnchors();

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds, elapsedSeconds) => {
        let kx = 0;
        let ky = 0;
        if (input.isKeyDown("arrowleft") || input.isKeyDown("a")) kx -= 1;
        if (input.isKeyDown("arrowright") || input.isKeyDown("d")) kx += 1;
        if (input.isKeyDown("arrowup") || input.isKeyDown("w")) ky -= 1;
        if (input.isKeyDown("arrowdown") || input.isKeyDown("s")) ky += 1;
        if (kx !== 0 || ky !== 0) {
          const length = Math.hypot(kx, ky) || 1;
          world.moveSelectorBy(
            (kx / length) * SELECTOR_KEY_SPEED * deltaSeconds,
            (ky / length) * SELECTOR_KEY_SPEED * deltaSeconds,
          );
        }

        world.step(deltaSeconds);

        setScore(world.score);
        setRound(world.round);
        setLives(world.lives);
        setRemaining(world.remainingDifferenceCount);
        setTotalDiffs(world.totalDifferenceCount);
        setTimeRemaining(Math.ceil(world.timeRemaining));
        setSelectorPosition({ x: world.selectorX, y: world.selectorY });
        if (world.isOver) setIsOver(true);

        const { width, height } = world;
        if (width <= 0 || height <= 0) return;

        petalGraphics.clear();
        for (const petal of petals) {
          petal.y += petal.speed * deltaSeconds;
          if (petal.y > height + 20) petal.y = -20;
          const x =
            petal.xFraction * width + Math.sin(elapsedSeconds * 0.6 + petal.driftPhase) * 16;
          petalGraphics.circle(x, petal.y, petal.size).fill({ color: PETAL_COLOR, alpha: 0.35 });
        }

        const rects = getPanelRects(width, height);
        panelGraphics.clear();
        drawPanelBackground(panelGraphics, rects.a);
        drawPanelBackground(panelGraphics, rects.b);
        labelA.position.set(rects.a.x + 12, rects.a.y + 8);
        labelB.position.set(rects.b.x + 12, rects.b.y + 8);

        elementGraphics.clear();
        for (const element of world.scene.elementsA) {
          if (element.isVisible) drawElement(elementGraphics, rects.a, element, elapsedSeconds);
        }
        for (const element of world.scene.elementsB) {
          if (element.isVisible) drawElement(elementGraphics, rects.b, element, elapsedSeconds);
        }

        selectorGraphics.clear();
        const pulse = 0.6 + 0.4 * Math.sin(elapsedSeconds * 6);
        selectorGraphics
          .circle(world.selectorX, world.selectorY, 11 + 3 * pulse)
          .stroke({ width: 3, color: SELECTOR_COLOR, alpha: 0.85 });

        for (let i = floatingPopups.length - 1; i >= 0; i--) {
          const entry = floatingPopups[i];
          entry.age += deltaSeconds;
          entry.text.position.y -= deltaSeconds * 26;
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
          lastInteractionPoint.x = pointer.x;
          lastInteractionPoint.y = pointer.y;
          world.setSelectorPosition(pointer.x, pointer.y);
          world.guessAt(pointer.x, pointer.y);
        },
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
          } else if (key === "r") {
            world.reset();
            setIsOver(false);
          } else if (key === "enter") {
            if (!loop.isPaused) {
              lastInteractionPoint.x = world.selectorX;
              lastInteractionPoint.y = world.selectorY;
              world.guessAtSelector();
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
    setDiffAnchors(computeDiffAnchors(world));
  }, [size.width, size.height]);

  return (
    <GameShell
      title="Mirror Garden"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="mirror-garden-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="mirror-garden-canvas" />

        {diffAnchors.map((anchor) => (
          <div
            key={anchor.elementId}
            className={styles.diffAnchor}
            data-testid={`mirror-garden-diff-${anchor.elementId}`}
            data-mutation={anchor.mutation}
            style={{ left: `${anchor.x}px`, top: `${anchor.y}px` }}
          />
        ))}

        <div
          className={styles.debug}
          data-testid="mirror-garden-debug"
          data-selector-x={selectorPosition.x.toFixed(1)}
          data-selector-y={selectorPosition.y.toFixed(1)}
        />

        <div className={styles.hud}>
          <span className={styles.round} data-testid="mirror-garden-round">
            見比べ {round}
          </span>
          <span className={styles.lives} data-testid="mirror-garden-lives">
            ライフ {lives}
          </span>
          <span className={styles.remaining} data-testid="mirror-garden-remaining">
            みつけた {totalDiffs - remaining} / {totalDiffs}
          </span>
          <span className={styles.timer} data-testid="mirror-garden-timer">
            ⏱ {timeRemaining}s
          </span>
        </div>
        <div className={styles.hint}>
          左右(縦長では上下)に並んだ庭を見比べて、違う部分をクリック/タップしよう。ハズすと残り時間が減る。矢印キー/WASDでカーソルを動かし、Enterで確定することもできる。Space:
          一時停止 / R: リセット。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="mirror-garden-gameover">
            <div className={styles.gameOverTitle}>庭めぐり終了</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <div className={styles.gameOverRound}>見比べ {round}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="mirror-garden-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
