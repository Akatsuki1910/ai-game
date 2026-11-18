"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import {
  type Piece,
  ROTATION_STEP_DEG,
  SHAPE_IDS,
  type ShapeId,
  SilhouetteBoardWorld,
} from "./engine/board";
import styles from "./SilhouetteSevenGame.module.scss";

const PIECE_COLOR = 0xffb86b;
const PIECE_PLACED_COLOR = 0x7cf5c4;
const PIECE_SELECTED_STROKE = 0xffe066;
const SLOT_COLOR = 0xffffff;

const KEY_MOVE_PX_PER_SEC = 260;
const POPUP_LIFETIME = 0.9;

interface FloatingText {
  text: Text;
  age: number;
}

/** 形状ごとの原点中心(-1..1)のローカル頂点。回転・拡大してから描く。 */
const SHAPE_LOCAL_POINTS: Record<ShapeId, readonly [number, number][]> = {
  triangle: [
    [-0.9, 0.7],
    [0.9, 0.2],
    [-0.2, -0.9],
  ],
  arrow: [
    [-0.9, 0.35],
    [0.15, 0.35],
    [0.15, 0.85],
    [0.9, 0],
    [0.15, -0.85],
    [0.15, -0.35],
    [-0.9, -0.35],
  ],
  ell: [
    [-0.8, -0.8],
    [-0.15, -0.8],
    [-0.15, 0.25],
    [0.8, 0.25],
    [0.8, 0.8],
    [-0.8, 0.8],
  ],
  trapezoid: [
    [-0.85, 0.65],
    [0.85, 0.65],
    [0.4, -0.65],
    [-0.4, -0.65],
  ],
  house: [
    [-0.7, -0.8],
    [0.7, -0.8],
    [0.7, 0.05],
    [0, 0.8],
    [-0.7, 0.05],
  ],
  tee: [
    [-0.85, 0.85],
    [0.85, 0.85],
    [0.85, 0.25],
    [0.3, 0.25],
    [0.3, -0.85],
    [-0.3, -0.85],
    [-0.3, 0.25],
    [-0.85, 0.25],
  ],
  step: [
    [-0.85, 0.85],
    [-0.85, -0.25],
    [-0.15, -0.25],
    [-0.15, -0.85],
    [0.85, -0.85],
    [0.85, 0.25],
    [0.15, 0.25],
    [0.15, 0.85],
  ],
};

/** ローカル頂点を回転・拡大・平行移動し、Graphics.poly に渡せるフラット配列にする。 */
function shapeToFlatPoints(
  shapeId: ShapeId,
  cx: number,
  cy: number,
  rotationDeg: number,
  radius: number,
): number[] {
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const flat: number[] = [];
  for (const [lx, ly] of SHAPE_LOCAL_POINTS[shapeId]) {
    const rx = lx * cos - ly * sin;
    const ry = lx * sin + ly * cos;
    flat.push(cx + rx * radius, cy + ry * radius);
  }
  return flat;
}

export function SilhouetteSevenGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [round, setRound] = useState(1);
  const [placedCount, setPlacedCount] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<SilhouetteBoardWorld | null>(null);
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
    const world = new SilhouetteBoardWorld(1, 1);
    worldRef.current = world;

    const slotGraphics = new Graphics();
    const pieceGraphics = new Graphics();
    const popupContainer = new Container();
    const floatingTexts: FloatingText[] = [];
    const draggingByPointer = new Map<number, number>();
    let selectedShapeId: ShapeId | null = null;

    const spawnPopup = (x: number, y: number, label: string, color: number) => {
      const text = new Text({
        text: label,
        style: { fill: color, fontSize: 18, fontWeight: "700" },
      });
      text.anchor.set(0.5, 1);
      text.position.set(x, y);
      popupContainer.addChild(text);
      floatingTexts.push({ text, age: 0 });
    };

    world.onPieceSeated = ({ piece, points, combo }) => {
      const label = combo > 0 ? `+${points} COMBO x${combo + 1}` : `+${points}`;
      spawnPopup(piece.x, piece.y - piece.radius - 6, label, 0xffe066);
    };
    world.onRoundCompleted = ({ round: completedRound, bonus }) => {
      spawnPopup(
        world.width / 2,
        world.height * 0.12,
        `ROUND ${completedRound} CLEAR +${bonus}`,
        0x7cf5c4,
      );
    };

    const selectedPiece = (): Piece | undefined =>
      selectedShapeId
        ? world.pieces.find((p) => p.shapeId === selectedShapeId && !p.isPlaced)
        : undefined;

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
      app.stage.addChild(slotGraphics, pieceGraphics, popupContainer);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        world.step(deltaSeconds);
        setScore(Math.floor(world.score));
        setTimeRemaining(Math.ceil(world.timeRemaining));
        setRound(world.round);
        setPlacedCount(world.placedCount);
        if (world.isOver) setIsOver(true);

        const moving = selectedPiece();
        if (moving) {
          let dx = 0;
          let dy = 0;
          if (input.isKeyDown("arrowleft") || input.isKeyDown("a")) dx -= 1;
          if (input.isKeyDown("arrowright") || input.isKeyDown("d")) dx += 1;
          if (input.isKeyDown("arrowup") || input.isKeyDown("w")) dy -= 1;
          if (input.isKeyDown("arrowdown") || input.isKeyDown("s")) dy += 1;
          if (dx !== 0 || dy !== 0) {
            const len = Math.hypot(dx, dy) || 1;
            world.setPiecePosition(
              moving.id,
              moving.x + (dx / len) * KEY_MOVE_PX_PER_SEC * deltaSeconds,
              moving.y + (dy / len) * KEY_MOVE_PX_PER_SEC * deltaSeconds,
            );
          }
        }

        slotGraphics.clear();
        for (const slot of world.slots) {
          const occupied = slot.occupiedBy !== null;
          slotGraphics
            .poly(
              shapeToFlatPoints(slot.shapeId, slot.x, slot.y, slot.targetRotationDeg, slot.radius),
            )
            .stroke({ width: 2, color: SLOT_COLOR, alpha: occupied ? 0 : 0.35 });
        }

        pieceGraphics.clear();
        for (const piece of world.pieces) {
          const isSelected = !piece.isPlaced && piece.shapeId === selectedShapeId;
          const fillColor = piece.isPlaced ? PIECE_PLACED_COLOR : PIECE_COLOR;
          pieceGraphics
            .poly(
              shapeToFlatPoints(piece.shapeId, piece.x, piece.y, piece.rotationDeg, piece.radius),
            )
            .fill({ color: fillColor, alpha: piece.isPlaced ? 0.95 : 0.9 })
            .stroke({
              width: isSelected ? 3 : 1.5,
              color: isSelected ? PIECE_SELECTED_STROKE : 0xffffff,
              alpha: 0.8,
            });
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
          const piece = world.findPieceAt(pointer.x, pointer.y);
          if (!piece) return;
          draggingByPointer.set(pointer.id, piece.id);
          selectedShapeId = piece.shapeId;
        },
        onPointerMove: (pointer) => {
          const pieceId = draggingByPointer.get(pointer.id);
          if (pieceId !== undefined) world.setPiecePosition(pieceId, pointer.x, pointer.y);
        },
        onPointerUp: (pointer) => {
          const pieceId = draggingByPointer.get(pointer.id);
          draggingByPointer.delete(pointer.id);
          if (pieceId === undefined) return;
          const dragDistance = Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY);
          if (dragDistance < 6) {
            world.rotatePiece(pieceId, ROTATION_STEP_DEG);
          } else {
            world.tryPlacePiece(pieceId);
          }
        },
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
            return;
          }
          if (key === "r") {
            world.reset();
            setIsOver(false);
            return;
          }
          const digit = Number(key);
          if (Number.isInteger(digit) && digit >= 1 && digit <= SHAPE_IDS.length) {
            selectedShapeId = SHAPE_IDS[digit - 1];
            return;
          }
          const piece = selectedPiece();
          if (!piece) return;
          if (key === "q") world.rotatePiece(piece.id, -ROTATION_STEP_DEG);
          else if (key === "e") world.rotatePiece(piece.id, ROTATION_STEP_DEG);
          else if (key === "enter") world.tryPlacePiece(piece.id);
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
      title="Silhouette Seven"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="silhouette-seven-stage">
        <div
          ref={canvasHostRef}
          className={styles.canvasHost}
          data-testid="silhouette-seven-canvas"
        />
        <div className={styles.hud}>
          <span className={styles.badge} data-testid="silhouette-seven-round">
            ROUND {round}
          </span>
          <span className={styles.badge} data-testid="silhouette-seven-progress">
            {placedCount}/{SHAPE_IDS.length}
          </span>
          <span className={styles.badge} data-testid="silhouette-seven-timer">
            ⏱ {timeRemaining}s
          </span>
        </div>
        <div className={styles.hint}>
          ピースをドラッグして枠に合わせよう。動かさずタップ/クリックすると45度回転。
          枠の向きとぴったり揃えてから置くとはまる。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="silhouette-seven-gameover">
            <div className={styles.gameOverTitle}>タイムアップ</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="silhouette-seven-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
