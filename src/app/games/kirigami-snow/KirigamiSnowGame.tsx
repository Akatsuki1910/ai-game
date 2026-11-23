"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import { cellBounds, cellMidpoint, ringHeight } from "./engine/wedgeGeometry";
import { KirigamiSnowWorld, MAX_LIVES, type RoundCompletedEvent } from "./engine/world";
import styles from "./KirigamiSnowGame.module.scss";

const PAPER_COLOR = 0xfdf6ec;
const HOLE_COLOR = 0x05060a;
const KEEP_GUIDE_COLOR = 0x6ee7ff;
const CUT_GUIDE_COLOR = 0xff6b6b;
const SELECTION_COLOR = 0xffe066;

const MAIN_CENTER_X_RATIO = 0.1;
const MAIN_CENTER_Y_RATIO = 0.18;
const MAIN_SCALE_RATIO = 0.42;

const PREVIEW_CENTER_X_RATIO = 0.62;
const PREVIEW_CENTER_Y_RATIO = 0.56;
const PREVIEW_SCALE_RATIO = 0.3;
const PREVIEW_COPIES = 8;
const REVEAL_LIFETIME_SECONDS = 1.6;

interface Selection {
  row: number;
  col: number;
}

interface RevealState {
  cells: RoundCompletedEvent["cells"];
  rowCount: number;
  age: number;
}

function drawWedgeCellPath(graphics: Graphics, row: number, col: number, rowCount: number): void {
  const { innerRadius, outerRadius, angleStart, angleEnd } = cellBounds(row, col, rowCount);
  graphics.moveTo(outerRadius * Math.cos(angleStart), outerRadius * Math.sin(angleStart));
  graphics.arc(0, 0, outerRadius, angleStart, angleEnd);
  graphics.lineTo(innerRadius * Math.cos(angleEnd), innerRadius * Math.sin(angleEnd));
  graphics.arc(0, 0, innerRadius, angleEnd, angleStart, true);
  graphics.closePath();
}

function computeMainLayout(
  width: number,
  height: number,
): { cx: number; cy: number; scale: number } {
  return {
    cx: width * MAIN_CENTER_X_RATIO,
    cy: height * MAIN_CENTER_Y_RATIO,
    scale: Math.max(1, Math.min(width, height) * MAIN_SCALE_RATIO),
  };
}

export function KirigamiSnowGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [round, setRound] = useState(1);
  const [lives, setLives] = useState(MAX_LIVES);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [accuracyPercent, setAccuracyPercent] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<KirigamiSnowWorld | null>(null);
  const appRef = useRef<Application | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const sizeRef = useRef({ width: 1, height: 1 });
  const selectionRef = useRef<Selection>({ row: 0, col: 0 });
  const finishRoundRef = useRef<() => void>(() => {});

  const handleTogglePause = useCallback(() => {
    if (!loopRef.current) return;
    setIsPaused(loopRef.current.togglePause());
  }, []);

  const handleRestart = useCallback(() => {
    worldRef.current?.reset();
    selectionRef.current = { row: 0, col: 0 };
    setIsOver(false);
    if (loopRef.current?.isPaused) {
      loopRef.current.resume();
      setIsPaused(false);
    }
  }, []);

  const handleFinishButton = useCallback(() => {
    finishRoundRef.current();
  }, []);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    let disposed = false;

    const app = new Application();
    const world = new KirigamiSnowWorld();
    worldRef.current = world;
    finishRoundRef.current = () => world.finishRound();

    const wedgeContainer = new Container();
    const wedgeGraphics = new Graphics();
    wedgeContainer.addChild(wedgeGraphics);

    // 8分割(45度ずつ)のウェッジを、実際の蛇腹折りと同じく1つ置きに鏡像反転しながら
    // 円周上に敷き詰める。偶数番目はそのまま回転するだけで角度[i*45, (i+1)*45]に、
    // 奇数番目は鏡像反転してから回転することで角度[i*45, (i+1)*45]に重なる
    // (導出: 鏡像反転は角度θをmoveTo(180-θ)に写すため、回転角を(i-3)*45度にすると
    // 元のウェッジの角度範囲[0,45]がちょうど[i*45,(i+1)*45]に移る)。
    const previewContainer = new Container();
    const previewGraphics: Graphics[] = [];
    for (let i = 0; i < PREVIEW_COPIES; i++) {
      const copyContainer = new Container();
      const graphics = new Graphics();
      const isMirrored = i % 2 === 1;
      copyContainer.rotation = (isMirrored ? i - 3 : i) * (Math.PI / 4);
      copyContainer.scale.x = isMirrored ? -1 : 1;
      copyContainer.addChild(graphics);
      previewContainer.addChild(copyContainer);
      previewGraphics.push(graphics);
    }

    const popupContainer = new Container();
    let revealState: RevealState | null = null;

    world.onRoundCompleted = (event) => {
      revealState = { cells: event.cells, rowCount: event.rowCount, age: 0 };
      const label = event.success
        ? `ラウンド${event.round} クリア! +${event.points}`
        : `やぶれた… (一致率 ${Math.round(event.accuracy * 100)}%)`;
      const text = new Text({
        text: label,
        style: {
          fill: event.success ? 0x7cf5c4 : 0xff6b6b,
          fontSize: 18,
          fontWeight: "700",
        },
      });
      text.anchor.set(0.5, 0.5);
      popupContainer.addChild(text);
      const popup = { text, age: 0 };
      popups.push(popup);
      selectionRef.current = { row: 0, col: 0 };
    };

    const popups: { text: Text; age: number }[] = [];

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
      app.stage.addChild(previewContainer, wedgeContainer, popupContainer);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        const { width, height } = sizeRef.current;
        if (!world.isOver && !revealState) {
          world.step(deltaSeconds);
        }

        setScore(world.score);
        setRound(world.round);
        setLives(world.lives);
        setTimeRemaining(Math.ceil(world.timeRemaining));
        setAccuracyPercent(Math.round(world.liveAccuracy * 100));
        if (world.isOver) setIsOver(true);

        const main = computeMainLayout(width, height);
        wedgeContainer.position.set(main.cx, main.cy);
        wedgeContainer.scale.set(main.scale);

        const previewCx = width * PREVIEW_CENTER_X_RATIO;
        const previewCy = height * PREVIEW_CENTER_Y_RATIO;
        const previewScale = Math.max(1, Math.min(width, height) * PREVIEW_SCALE_RATIO);
        previewContainer.position.set(previewCx, previewCy);

        // ring-sector(moveTo+arc+lineTo+arc+closePath)のパスは、stroke()を重ねると
        // pixi側のmiter結合計算が破綻して巨大な図形になることがあるため、セル本体は
        // fill()のみで描く。お手本(残す/切る)と選択中の表示は、安全な円(circle)の
        // fill/strokeで別途マーカーとして重ねる。
        const markerRadius = ringHeight(world.rowCount) * 0.3;
        wedgeGraphics.clear();
        const selection = selectionRef.current;
        for (const cell of world.cells) {
          drawWedgeCellPath(wedgeGraphics, cell.row, cell.col, world.rowCount);
          wedgeGraphics.fill({
            color: cell.isCut ? HOLE_COLOR : PAPER_COLOR,
            alpha: cell.isCut ? 0.16 : 0.96,
          });

          const mid = cellMidpoint(cell.row, cell.col, world.rowCount);
          wedgeGraphics
            .circle(mid.x, mid.y, markerRadius)
            .fill({ color: cell.shouldKeep ? KEEP_GUIDE_COLOR : CUT_GUIDE_COLOR, alpha: 0.7 });

          if (cell.row === selection.row && cell.col === selection.col) {
            wedgeGraphics
              .circle(mid.x, mid.y, markerRadius * 1.8)
              .stroke({ width: markerRadius * 0.4, color: SELECTION_COLOR, alpha: 0.9 });
          }
        }

        if (revealState) {
          revealState.age += deltaSeconds;
          const alpha = Math.max(0, 1 - revealState.age / REVEAL_LIFETIME_SECONDS);
          previewContainer.scale.set(previewScale * (0.85 + alpha * 0.15));
          previewContainer.alpha = alpha;
          for (const graphics of previewGraphics) {
            graphics.clear();
            for (const cell of revealState.cells) {
              drawWedgeCellPath(graphics, cell.row, cell.col, revealState.rowCount);
              graphics.fill({
                color: cell.isCut ? HOLE_COLOR : PAPER_COLOR,
                alpha: cell.isCut ? 0.04 : 0.92,
              });
            }
          }
          if (revealState.age >= REVEAL_LIFETIME_SECONDS) revealState = null;
        } else {
          previewContainer.alpha = 0;
          previewContainer.scale.set(previewScale);
          for (const graphics of previewGraphics) graphics.clear();
        }

        for (let i = popups.length - 1; i >= 0; i--) {
          const popup = popups[i];
          popup.age += deltaSeconds;
          popup.text.position.set(width * 0.5, height * 0.14 - popup.age * 14);
          popup.text.alpha = Math.max(0, 1 - popup.age / REVEAL_LIFETIME_SECONDS);
          if (popup.age >= REVEAL_LIFETIME_SECONDS) {
            popupContainer.removeChild(popup.text);
            popup.text.destroy();
            popups.splice(i, 1);
          }
        }
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => {
          const main = computeMainLayout(sizeRef.current.width, sizeRef.current.height);
          const localX = (pointer.x - main.cx) / main.scale;
          const localY = (pointer.y - main.cy) / main.scale;
          world.toggleCellAt(localX, localY);
        },
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
            return;
          }
          if (key === "r") {
            world.reset();
            selectionRef.current = { row: 0, col: 0 };
            setIsOver(false);
            return;
          }
          if (key === "f") {
            world.finishRound();
            return;
          }
          const selection = selectionRef.current;
          if (key === "arrowup" || key === "w") {
            const row = Math.min(world.rowCount - 1, selection.row + 1);
            selectionRef.current = { row, col: Math.min(selection.col, row) };
          } else if (key === "arrowdown" || key === "s") {
            const row = Math.max(0, selection.row - 1);
            selectionRef.current = { row, col: Math.min(selection.col, row) };
          } else if (key === "arrowleft" || key === "a") {
            selectionRef.current = { row: selection.row, col: Math.max(0, selection.col - 1) };
          } else if (key === "arrowright" || key === "d") {
            selectionRef.current = {
              row: selection.row,
              col: Math.min(selection.row, selection.col + 1),
            };
          } else if (key === "enter") {
            world.toggleCell(selection.row, selection.col);
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
    sizeRef.current = { width: size.width, height: size.height };
  }, [size.width, size.height]);

  return (
    <GameShell
      title="Kirigami Snow"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="kirigami-snow-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="kirigami-snow-canvas" />
        <div className={styles.hud}>
          <span className={styles.badge} data-testid="kirigami-snow-round">
            ラウンド {round}
          </span>
          <span className={styles.badge} data-testid="kirigami-snow-timer">
            ⏱ {timeRemaining}s
          </span>
          <span className={styles.badge} data-testid="kirigami-snow-lives">
            {"♥".repeat(Math.max(0, lives))}
            {"♡".repeat(Math.max(0, MAX_LIVES - lives))}
          </span>
        </div>
        <div className={styles.accuracyPanel}>
          <span className={styles.accuracyLabel}>一致率</span>
          <div className={styles.accuracyTrack} data-testid="kirigami-snow-accuracy">
            <div className={styles.accuracyFill} style={{ width: `${accuracyPercent}%` }} />
          </div>
          <span className={styles.accuracyValue} data-testid="kirigami-snow-accuracy-value">
            {accuracyPercent}%
          </span>
          <button
            type="button"
            className={styles.finishButton}
            onPointerDown={(event) => event.preventDefault()}
            onClick={handleFinishButton}
            data-testid="kirigami-snow-finish"
          >
            仕上げる
          </button>
        </div>
        <div className={styles.hint}>
          水色の枠は「残す」、赤色の枠は「切る」お手本。クリック/タップでそのマスをカット/復元。
          仕上げると開いた雪の結晶になる(一致率75%以上で成功)。矢印キー/WASDで選択移動、Enterでカット、Fで仕上げる。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="kirigami-snow-gameover">
            <div className={styles.gameOverTitle}>紙が尽きた…</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <div className={styles.gameOverSub}>到達ラウンド {round}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="kirigami-snow-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
