"use client";

import { Application, Graphics } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import {
  ATTEMPTS_MAX,
  CHUTE_X_MAX,
  type ClawPhase,
  getPrizeValue,
  PRIZE_TIERS,
  PrizeCraneWorld,
  type PrizeTier,
} from "./engine/world";
import styles from "./PrizeCraneGame.module.scss";

const TIER_HEX = {
  plush: 0xffb454,
  robot: 0x6ee7ff,
  gem: 0xd48bff,
} as const satisfies Record<PrizeTier, number>;

const TIER_CSS = {
  plush: "#ffb454",
  robot: "#6ee7ff",
  gem: "#d48bff",
} as const satisfies Record<PrizeTier, string>;

const TIER_LABEL = {
  plush: "ぬいぐるみ",
  robot: "ロボット",
  gem: "ジュエル",
} as const satisfies Record<PrizeTier, string>;

const TIER_RADIUS_SCALE = {
  plush: 1.15,
  robot: 1,
  gem: 0.8,
} as const satisfies Record<PrizeTier, number>;

const PHASE_STATUS_LABEL = {
  idle: "狙いを定めて「降ろす」",
  descending: "降下中…",
  ascending: "引き上げ中…",
  carrying: "搬出口まで運んで「置く」",
} as const satisfies Record<ClawPhase, string>;

const PHASE_ACTION_LABEL = {
  idle: "降ろす",
  descending: "…",
  ascending: "…",
  carrying: "置く",
} as const satisfies Record<ClawPhase, string>;

const RAIL_Y_RATIO = 0.16;
const BIN_Y_RATIO = 0.78;
const SWING_WARNING_COLOR = 0xff6b6b;
const CABLE_COLOR = 0x5a6072;

interface PixelPoint {
  x: number;
  y: number;
}

function railY(height: number): number {
  return height * RAIL_Y_RATIO;
}

function binY(height: number): number {
  return height * BIN_Y_RATIO;
}

function clawPixelPosition(
  clawX: number,
  clawDepth: number,
  width: number,
  height: number,
): PixelPoint {
  const top = railY(height);
  const bottom = binY(height);
  return { x: width * clawX, y: top + (bottom - top) * clawDepth };
}

function slotPixelPosition(x: number, width: number, height: number): PixelPoint {
  return { x: width * x, y: binY(height) };
}

function prizeRadius(tier: PrizeTier, width: number, height: number): number {
  const shortest = Math.min(width, height);
  const base = Math.min(30, Math.max(16, shortest * 0.045));
  return base * TIER_RADIUS_SCALE[tier];
}

function clawRadius(width: number, height: number): number {
  const shortest = Math.min(width, height);
  return Math.min(22, Math.max(12, shortest * 0.03));
}

export function PrizeCraneGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [attempts, setAttempts] = useState(ATTEMPTS_MAX);
  const [combo, setCombo] = useState(0);
  const [phase, setPhase] = useState<ClawPhase>("idle");
  const [carriedTier, setCarriedTier] = useState<PrizeTier | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<PrizeCraneWorld | null>(null);
  const appRef = useRef<Application | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  const isDraggingRef = useRef(false);

  const handleTogglePause = useCallback(() => {
    if (!loopRef.current) return;
    setIsPaused(loopRef.current.togglePause());
  }, []);

  const handleRestart = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    world.reset();
    setIsOver(false);
    if (loopRef.current?.isPaused) {
      loopRef.current.resume();
      setIsPaused(false);
    }
  }, []);

  const handleAction = useCallback(() => {
    if (loopRef.current?.isPaused) return;
    worldRef.current?.triggerAction();
  }, []);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    let disposed = false;

    const app = new Application();
    const world = new PrizeCraneWorld();
    worldRef.current = world;

    const chuteGraphics = new Graphics();
    const binGraphics = new Graphics();
    const prizeGraphics = new Graphics();
    const clawGraphics = new Graphics();

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x0c0e16,
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
      app.stage.addChild(chuteGraphics, binGraphics, prizeGraphics, clawGraphics);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const CLAW_KEY_SPEED = 0.6;

      const loop = new GameLoop((deltaSeconds, elapsedSeconds) => {
        if (input.isKeyDown("arrowleft") || input.isKeyDown("a")) {
          world.setClawX(world.clawX - CLAW_KEY_SPEED * deltaSeconds);
        }
        if (input.isKeyDown("arrowright") || input.isKeyDown("d")) {
          world.setClawX(world.clawX + CLAW_KEY_SPEED * deltaSeconds);
        }

        world.step(deltaSeconds);

        setScore(world.score);
        setAttempts(world.attempts);
        setCombo(world.combo);
        setPhase(world.phase);
        setCarriedTier(world.carriedTier);
        if (world.isOver) setIsOver(true);

        const { width, height } = sizeRef.current;
        if (width > 0 && height > 0) {
          const top = railY(height);
          const bottom = binY(height);
          const chuteWidth = width * CHUTE_X_MAX;

          chuteGraphics.clear();
          chuteGraphics
            .rect(0, 0, chuteWidth, height)
            .fill({ color: 0x1d2a2a, alpha: 0.7 })
            .rect(chuteWidth - 2, 0, 2, height)
            .fill({ color: 0x3fe0a8, alpha: 0.6 });

          binGraphics.clear();
          binGraphics
            .moveTo(0, top)
            .lineTo(width, top)
            .stroke({ width: 3, color: CABLE_COLOR, alpha: 0.6 });
          binGraphics
            .rect(0, bottom + 10, width, Math.max(0, height - bottom - 10))
            .fill({ color: 0x15171f, alpha: 0.9 });

          prizeGraphics.clear();
          for (const prize of world.prizes) {
            const pos = slotPixelPosition(prize.x, width, height);
            const radius = prizeRadius(prize.tier, width, height);
            prizeGraphics
              .circle(pos.x, pos.y, radius)
              .fill({ color: TIER_HEX[prize.tier], alpha: 0.95 })
              .stroke({ width: 2, color: 0xffffff, alpha: 0.5 });
          }

          const clawPos = clawPixelPosition(world.clawX, world.clawDepth, width, height);
          // クレーンが静止している間も画面が死んだ絵にならないよう、ぶら下がりの
          // 微振動を見た目だけに加える(ワールドの clawX 自体は変えない)。
          clawPos.x += Math.sin(elapsedSeconds * 1.6) * width * 0.008;
          clawPos.y += Math.sin(elapsedSeconds * 2.3) * 3;
          const cRadius = clawRadius(width, height);
          const isSwinging = world.swingRatio > 0.6;
          const clawColor = isSwinging ? SWING_WARNING_COLOR : 0xf2f3f5;

          clawGraphics.clear();
          clawGraphics
            .moveTo(clawPos.x, 0)
            .lineTo(clawPos.x, clawPos.y)
            .stroke({ width: 2, color: CABLE_COLOR, alpha: 0.8 });

          if (world.carriedTier) {
            const prizeRadiusAtClaw = prizeRadius(world.carriedTier, width, height);
            const tilt = world.swingRatio * 0.5;
            prizeGraphics
              .circle(
                clawPos.x + Math.sin(tilt) * 10,
                clawPos.y + cRadius + prizeRadiusAtClaw * 0.6,
                prizeRadiusAtClaw,
              )
              .fill({ color: TIER_HEX[world.carriedTier], alpha: 0.95 })
              .stroke({ width: 2, color: clawColor, alpha: 0.9 });
          }

          clawGraphics
            .circle(clawPos.x, clawPos.y, cRadius)
            .fill({ color: clawColor, alpha: 0.9 })
            .moveTo(clawPos.x - cRadius, clawPos.y)
            .lineTo(clawPos.x - cRadius * 0.4, clawPos.y + cRadius * 1.3)
            .moveTo(clawPos.x + cRadius, clawPos.y)
            .lineTo(clawPos.x + cRadius * 0.4, clawPos.y + cRadius * 1.3)
            .stroke({ width: 3, color: clawColor, alpha: 0.9 });
        }
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => {
          if (loop.isPaused) return;
          const { width } = sizeRef.current;
          if (width === 0) return;
          isDraggingRef.current = true;
          world.setClawX(pointer.x / width);
        },
        onPointerMove: (pointer) => {
          if (loop.isPaused || !isDraggingRef.current) return;
          const { width } = sizeRef.current;
          if (width === 0) return;
          world.setClawX(pointer.x / width);
        },
        onPointerUp: () => {
          isDraggingRef.current = false;
        },
        onKeyDown: (key) => {
          if (loop.isPaused && key !== " ") return;
          if (key === " ") {
            setIsPaused(loop.togglePause());
            return;
          }
          if (key === "r") {
            world.reset();
            setIsOver(false);
            return;
          }
          if (key === "enter") {
            world.triggerAction();
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
    sizeRef.current = { width: size.width, height: size.height };
  }, [size.width, size.height]);

  return (
    <GameShell
      title="Prize Crane"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="prize-crane-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="prize-crane-canvas" />

        <div className={styles.hud}>
          <span className={styles.combo} data-testid="prize-crane-combo">
            COMBO {combo}
          </span>
          <span
            className={styles.attempts}
            data-testid="prize-crane-attempts"
            data-attempts={attempts}
          >
            クレーン残り {attempts} / {ATTEMPTS_MAX}
          </span>
        </div>

        <div
          className={styles.status}
          data-testid="prize-crane-status"
          data-phase={phase}
          data-tier={carriedTier ?? ""}
        >
          {PHASE_STATUS_LABEL[phase]}
        </div>

        <div className={styles.hint}>
          ドラッグ/矢印キーでクレーンを左右に移動し、ボタンで降ろして景品をつかもう。つかんだら緑のライン(搬出口)まで運んで再度ボタンを押すと獲得。運搬中に激しく動かすと振り落として失敗する。
          Space: 一時停止 / R: リセット
        </div>

        <div className={styles.bottomPanel}>
          <button
            type="button"
            className={styles.actionButton}
            onClick={handleAction}
            disabled={phase === "descending" || phase === "ascending" || isOver}
            data-testid="prize-crane-action"
          >
            {PHASE_ACTION_LABEL[phase]}
          </button>

          <div className={styles.legend} data-testid="prize-crane-legend">
            {PRIZE_TIERS.map((tier) => (
              <span
                key={tier}
                className={styles.legendItem}
                data-testid={`prize-crane-legend-${tier}`}
              >
                <span className={styles.legendSwatch} style={{ backgroundColor: TIER_CSS[tier] }} />
                {TIER_LABEL[tier]} {getPrizeValue(tier)}pt
              </span>
            ))}
          </div>
        </div>

        {isOver && (
          <div className={styles.gameOver} data-testid="prize-crane-gameover">
            <div className={styles.gameOverTitle}>クレーン終了</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="prize-crane-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
