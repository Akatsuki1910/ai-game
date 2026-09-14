"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import { GridBreachWorld } from "./engine/world";
import styles from "./GridBreachGame.module.scss";

const COLOR_BG = 0x05060a;
const COLOR_GRID_LINE = 0x1c2230;
const COLOR_TERRITORY = 0x2fe6c4;
const COLOR_TRAIL_SAFE = 0x6ee7ff;
const COLOR_TRAIL_DANGER = 0xffb454;
const COLOR_PLAYER = 0xf2f3f5;
const COLOR_ENEMY = 0xff6b6b;

const MOVE_KEYS: Record<string, { dx: number; dy: number }> = {
  arrowup: { dx: 0, dy: -1 },
  arrowdown: { dx: 0, dy: 1 },
  arrowleft: { dx: -1, dy: 0 },
  arrowright: { dx: 1, dy: 0 },
  w: { dx: 0, dy: -1 },
  s: { dx: 0, dy: 1 },
  a: { dx: -1, dy: 0 },
  d: { dx: 1, dy: 0 },
};

interface FloatingLabel {
  text: Text;
  age: number;
  lifetime: number;
}

function rotate(x: number, y: number, angle: number): { x: number; y: number } {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}

export function GridBreachGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const canvasHostRef = useRef<HTMLDivElement | null>(null);

  const worldRef = useRef<GridBreachWorld | null>(null);
  const appRef = useRef<Application | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);

  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [capturedPercent, setCapturedPercent] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);
  const [isClear, setIsClear] = useState(false);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    let disposed = false;

    const app = new Application();
    const world = new GridBreachWorld(1, 1);
    worldRef.current = world;

    const gridGraphics = new Graphics();
    const territoryGraphics = new Graphics();
    const trailGraphics = new Graphics();
    const enemyGraphics = new Graphics();
    const playerGraphics = new Graphics();
    const popupContainer = new Container();
    const floatingLabels: FloatingLabel[] = [];
    let drawnTerritoryVersion = -1;
    let drawnPlayfieldSize = -1;
    let drawnCellSize = -1;
    const heldKeys = new Set<string>();

    const spawnLabel = (text: string, color: number, x: number, y: number, lifetime = 0.9) => {
      const label = new Text({
        text,
        style: { fill: color, fontSize: 18, fontWeight: "700" },
      });
      label.anchor.set(0.5, 1);
      label.position.set(x, y);
      popupContainer.addChild(label);
      floatingLabels.push({ text: label, age: 0, lifetime });
    };

    world.onCapture = ({ points }) => {
      spawnLabel(
        `+${points}`,
        0xffe066,
        world.offsetX + world.player.x,
        world.offsetY + world.player.y - world.playerRadius - 6,
      );
    };
    world.onLifeLost = () => {
      spawnLabel(
        "MISS",
        COLOR_ENEMY,
        world.offsetX + world.playfieldSize / 2,
        world.offsetY + world.playfieldSize / 2 - 30,
        1.1,
      );
    };

    const applyMoveKeys = () => {
      let dx = 0;
      let dy = 0;
      for (const key of heldKeys) {
        const dir = MOVE_KEYS[key];
        if (!dir) continue;
        dx += dir.dx;
        dy += dir.dy;
      }
      if (dx !== 0 || dy !== 0) world.setDesiredAngle(Math.atan2(dy, dx));
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: COLOR_BG,
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
        gridGraphics,
        territoryGraphics,
        trailGraphics,
        enemyGraphics,
        playerGraphics,
        popupContainer,
      );
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        world.step(deltaSeconds);
        setScore(Math.floor(world.score));
        setLives(world.lives);
        setCapturedPercent(Math.floor(world.capturedRatio * 100));
        if (world.isOver) {
          setIsOver(true);
          setIsClear(world.isClear);
        }

        if (drawnPlayfieldSize !== world.playfieldSize || drawnCellSize !== world.cellSize) {
          drawnPlayfieldSize = world.playfieldSize;
          drawnCellSize = world.cellSize;
          gridGraphics.clear();
          gridGraphics
            .rect(world.offsetX, world.offsetY, world.playfieldSize, world.playfieldSize)
            .fill({ color: 0x0b0e16 });
          for (let col = 0; col <= world.cols; col++) {
            const x = world.offsetX + col * world.cellSize;
            gridGraphics
              .moveTo(x, world.offsetY)
              .lineTo(x, world.offsetY + world.playfieldSize)
              .stroke({ width: 1, color: COLOR_GRID_LINE, alpha: 0.6 });
          }
          for (let row = 0; row <= world.rows; row++) {
            const y = world.offsetY + row * world.cellSize;
            gridGraphics
              .moveTo(world.offsetX, y)
              .lineTo(world.offsetX + world.playfieldSize, y)
              .stroke({ width: 1, color: COLOR_GRID_LINE, alpha: 0.6 });
          }
          drawnTerritoryVersion = -1;
        }

        if (drawnTerritoryVersion !== world.territoryVersion) {
          drawnTerritoryVersion = world.territoryVersion;
          territoryGraphics.clear();
          for (let row = 0; row < world.rows; row++) {
            for (let col = 0; col < world.cols; col++) {
              if (world.ownership[row * world.cols + col] !== 1) continue;
              territoryGraphics
                .rect(
                  world.offsetX + col * world.cellSize,
                  world.offsetY + row * world.cellSize,
                  world.cellSize,
                  world.cellSize,
                )
                .fill({ color: COLOR_TERRITORY, alpha: 0.28 });
            }
          }
        }

        trailGraphics.clear();
        if (world.trail.length > 1) {
          const color = world.player.isTrailing ? COLOR_TRAIL_DANGER : COLOR_TRAIL_SAFE;
          trailGraphics.moveTo(world.offsetX + world.trail[0].x, world.offsetY + world.trail[0].y);
          for (let i = 1; i < world.trail.length; i++) {
            trailGraphics.lineTo(
              world.offsetX + world.trail[i].x,
              world.offsetY + world.trail[i].y,
            );
          }
          trailGraphics.stroke({ width: 3, color, alpha: 0.9 });
        }

        enemyGraphics.clear();
        for (const enemy of world.enemies) {
          const ex = world.offsetX + enemy.x;
          const ey = world.offsetY + enemy.y;
          const r = world.enemyRadius;
          enemyGraphics
            .moveTo(ex, ey - r)
            .lineTo(ex + r, ey)
            .lineTo(ex, ey + r)
            .lineTo(ex - r, ey)
            .closePath()
            .fill({ color: COLOR_ENEMY, alpha: 0.9 })
            .stroke({ width: 1.5, color: 0xffffff, alpha: 0.5 });
        }

        playerGraphics.clear();
        {
          const px = world.offsetX + world.player.x;
          const py = world.offsetY + world.player.y;
          const r = world.playerRadius;
          const nose = rotate(r * 1.5, 0, world.player.angle);
          const left = rotate(-r * 0.9, r * 0.95, world.player.angle);
          const right = rotate(-r * 0.9, -r * 0.95, world.player.angle);
          const color = world.player.isTrailing ? COLOR_TRAIL_DANGER : COLOR_PLAYER;
          playerGraphics
            .moveTo(px + nose.x, py + nose.y)
            .lineTo(px + left.x, py + left.y)
            .lineTo(px + right.x, py + right.y)
            .closePath()
            .fill({ color, alpha: 0.95 });
        }

        for (let i = floatingLabels.length - 1; i >= 0; i--) {
          const entry = floatingLabels[i];
          entry.age += deltaSeconds;
          entry.text.position.y -= deltaSeconds * 30;
          entry.text.alpha = Math.max(0, 1 - entry.age / entry.lifetime);
          if (entry.age >= entry.lifetime) {
            popupContainer.removeChild(entry.text);
            entry.text.destroy();
            floatingLabels.splice(i, 1);
          }
        }
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => {
          world.aimAtStagePoint(pointer.x, pointer.y);
        },
        onPointerMove: (pointer) => {
          world.aimAtStagePoint(pointer.x, pointer.y);
        },
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
            return;
          }
          if (key === "r") {
            world.reset();
            setIsOver(false);
            setIsClear(false);
            return;
          }
          if (key in MOVE_KEYS) {
            heldKeys.add(key);
            applyMoveKeys();
          }
        },
        onKeyUp: (key) => {
          if (key in MOVE_KEYS) {
            heldKeys.delete(key);
            applyMoveKeys();
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
    setIsClear(false);
    if (loopRef.current?.isPaused) {
      loopRef.current.resume();
      setIsPaused(false);
    }
  };

  return (
    <GameShell
      title="Grid Breach"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner}>
        <div ref={canvasHostRef} className={styles.canvasHost} />
        <div className={styles.hud}>
          <span className={styles.chip}>ライフ {"♥".repeat(Math.max(0, lives))}</span>
          <span className={styles.chip}>制圧 {capturedPercent}%</span>
        </div>
        <div className={styles.hint}>
          ドラッグ/矢印キーで進路変更。自陣（水色エリア）から出て軌跡を伸ばし、戻って囲むと制圧。
          軌跡を伸ばしている間に敵（赤ひし形）に触れるとミス。75%制圧でクリア。
        </div>
        {isOver && (
          <div className={styles.gameOver}>
            <div className={styles.gameOverTitle}>
              {isClear ? "エリア制圧！" : "ミッション失敗"}
            </div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button type="button" className={styles.restartButton} onClick={handleRestart}>
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
