"use client";

import { Application, Graphics } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import {
  GLASS_CAPACITY,
  INGREDIENT_IDS,
  INITIAL_LIVES,
  type IngredientId,
  type LayerCommittedEvent,
  type ParfaitCompletedEvent,
  ParfaitLayerWorld,
  type PourFailedEvent,
  type RecipeLayer,
} from "./engine/world";
import styles from "./ParfaitLayerGame.module.scss";

const INGREDIENT_HEX = {
  yogurt: 0xfff6e8,
  berry: 0xe85275,
  mango: 0xffb13d,
  cocoa: 0x6b4423,
} as const satisfies Record<IngredientId, number>;

const INGREDIENT_CSS = {
  yogurt: "#fff6e8",
  berry: "#e85275",
  mango: "#ffb13d",
  cocoa: "#6b4423",
} as const satisfies Record<IngredientId, string>;

const INGREDIENT_LABEL = {
  yogurt: "ヨーグルト",
  berry: "ベリー",
  mango: "マンゴー",
  cocoa: "ココア",
} as const satisfies Record<IngredientId, string>;

const TARGET_BAND_COLOR = 0x6ee7ff;
const GLASS_TOP_Y_RATIO = 0.18;
const GLASS_BOTTOM_Y_RATIO = 0.86;
const GLASS_TOP_HALF_WIDTH_RATIO = 0.22;
const GLASS_BOTTOM_HALF_WIDTH_RATIO = 0.12;
const JAR_BOB_SPEED = 2.1;
const JAR_SWAY_SPEED = 1.1;

interface RecipeChip {
  layerIndex: number;
  ingredientId: IngredientId;
  status: "done" | "current" | "upcoming";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function buildRecipeChips(recipe: readonly RecipeLayer[], recipeIndex: number): RecipeChip[] {
  return recipe.map((layer, index) => ({
    layerIndex: index,
    ingredientId: layer.ingredientId,
    status: index < recipeIndex ? "done" : index === recipeIndex ? "current" : "upcoming",
  }));
}

function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

export function ParfaitLayerGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [round, setRound] = useState(1);
  const [lives, setLives] = useState(INITIAL_LIVES);
  const [fillPercent, setFillPercent] = useState(0);
  const [recipeChips, setRecipeChips] = useState<RecipeChip[]>([]);
  const [targetBandText, setTargetBandText] = useState("");
  const [selectedIngredientId, setSelectedIngredientId] = useState<IngredientId>(INGREDIENT_IDS[0]);
  const [feedbackMessage, setFeedbackMessage] = useState("グラスを選んで注ごう");
  const [isPaused, setIsPaused] = useState(false);
  const [isGameOver, setIsGameOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<ParfaitLayerWorld | null>(null);
  const appRef = useRef<Application | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  const pourSourcesRef = useRef<Set<string>>(new Set());

  const refreshRecipeChips = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    setRecipeChips(buildRecipeChips(world.recipe, world.recipeIndex));
    setTargetBandText(
      `${formatPercent(world.currentLayerTarget.minVolume / GLASS_CAPACITY)}〜${formatPercent(
        world.currentLayerTarget.maxVolume / GLASS_CAPACITY,
      )}`,
    );
  }, []);

  const handleTogglePause = useCallback(() => {
    const world = worldRef.current;
    const loop = loopRef.current;
    if (!world || !loop) return;
    const nowPaused = loop.togglePause();
    setIsPaused(nowPaused);
    if (nowPaused) {
      world.cancelPour();
    } else if (pourSourcesRef.current.size > 0) {
      world.startPour();
    }
  }, []);

  const handleRestart = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    world.reset();
    setSelectedIngredientId(world.selectedIngredientId);
    setFeedbackMessage("グラスを選んで注ごう");
    setIsGameOver(false);
    refreshRecipeChips();
    if (loopRef.current?.isPaused) {
      loopRef.current.resume();
      setIsPaused(false);
    }
  }, [refreshRecipeChips]);

  const handleSelectIngredient = useCallback((ingredientId: IngredientId) => {
    worldRef.current?.selectIngredient(ingredientId);
    setSelectedIngredientId(ingredientId);
  }, []);

  const addPourSource = useCallback((source: string) => {
    const sources = pourSourcesRef.current;
    const wasEmpty = sources.size === 0;
    sources.add(source);
    if (wasEmpty && !loopRef.current?.isPaused) {
      worldRef.current?.startPour();
    }
  }, []);

  const removePourSource = useCallback((source: string) => {
    const sources = pourSourcesRef.current;
    sources.delete(source);
    if (sources.size === 0) {
      worldRef.current?.stopPour();
    }
  }, []);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    let disposed = false;

    const app = new Application();
    const world = new ParfaitLayerWorld();
    worldRef.current = world;

    const glassGraphics = new Graphics();
    const jarGraphics = new Graphics();

    world.onLayerCommitted = (event: LayerCommittedEvent) => {
      setFeedbackMessage(`+${event.quality}`);
      refreshRecipeChips();
    };
    world.onPourFailed = (event: PourFailedEvent) => {
      setFeedbackMessage(event.reason === "wrong-ingredient" ? "ちがう具材!" : "あふれた!");
      if (event.livesRemaining <= 0) setIsGameOver(true);
    };
    world.onParfaitCompleted = (event: ParfaitCompletedEvent) => {
      setFeedbackMessage("パルフェ完成!");
      setRound(event.round);
      refreshRecipeChips();
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x1c1420,
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
      app.stage.addChild(glassGraphics, jarGraphics);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      refreshRecipeChips();

      const loop = new GameLoop((deltaSeconds, elapsedSeconds) => {
        world.step(deltaSeconds);

        setScore(world.score);
        setLives(world.lives);
        setFillPercent(Math.round(clamp(world.glassFillRatio, 0, 1) * 100));

        const { width, height } = sizeRef.current;
        if (width <= 0 || height <= 0) return;

        const shortest = Math.min(width, height);
        const topHalfWidthPx = shortest * GLASS_TOP_HALF_WIDTH_RATIO;
        const bottomHalfWidthPx = shortest * GLASS_BOTTOM_HALF_WIDTH_RATIO;
        const glassTopY = height * GLASS_TOP_Y_RATIO;
        const glassBottomY = height * GLASS_BOTTOM_Y_RATIO;
        const glassHeightPx = glassBottomY - glassTopY;
        const cx = width / 2;

        const halfWidthAt = (y: number): number => {
          const t = clamp((glassBottomY - y) / glassHeightPx, 0, 1);
          return bottomHalfWidthPx + (topHalfWidthPx - bottomHalfWidthPx) * t;
        };
        const drawQuad = (
          topY: number,
          bottomY: number,
          color: number,
          alpha: number,
          strokeColor?: number,
          strokeAlpha?: number,
        ) => {
          const hwBottom = halfWidthAt(bottomY);
          const hwTop = halfWidthAt(topY);
          glassGraphics
            .moveTo(cx - hwBottom, bottomY)
            .lineTo(cx - hwTop, topY)
            .lineTo(cx + hwTop, topY)
            .lineTo(cx + hwBottom, bottomY)
            .closePath()
            .fill({ color, alpha });
          if (strokeColor !== undefined) {
            glassGraphics.stroke({ width: 1.5, color: strokeColor, alpha: strokeAlpha ?? 0.7 });
          }
        };

        glassGraphics.clear();
        glassGraphics
          .moveTo(cx - bottomHalfWidthPx, glassBottomY)
          .lineTo(cx - topHalfWidthPx, glassTopY)
          .lineTo(cx + topHalfWidthPx, glassTopY)
          .lineTo(cx + bottomHalfWidthPx, glassBottomY)
          .closePath()
          .fill({ color: 0xffffff, alpha: 0.04 })
          .stroke({ width: 3, color: 0xffffff, alpha: 0.45 });

        let currentTopY = glassBottomY;
        for (const layer of world.committedLayers) {
          const layerHeightPx = (layer.volume / GLASS_CAPACITY) * glassHeightPx;
          const nextTopY = currentTopY - layerHeightPx;
          drawQuad(nextTopY, currentTopY, INGREDIENT_HEX[layer.ingredientId], 0.92);
          currentTopY = nextTopY;
        }

        if (!world.isGameOver) {
          const target = world.currentLayerTarget;
          const bandBottomY = currentTopY - (target.minVolume / GLASS_CAPACITY) * glassHeightPx;
          const bandTopY = currentTopY - (target.maxVolume / GLASS_CAPACITY) * glassHeightPx;
          drawQuad(bandTopY, bandBottomY, TARGET_BAND_COLOR, 0.14, TARGET_BAND_COLOR, 0.6);
        }

        if (world.currentPourVolume > 0) {
          const pourHeightPx = (world.currentPourVolume / GLASS_CAPACITY) * glassHeightPx;
          drawQuad(
            currentTopY - pourHeightPx,
            currentTopY,
            INGREDIENT_HEX[world.selectedIngredientId],
            0.62,
            0xffffff,
            0.5,
          );
        }

        jarGraphics.clear();
        const jarX = cx + Math.sin(elapsedSeconds * JAR_SWAY_SPEED) * shortest * 0.03;
        const jarBobY = world.isPouring ? 2 : Math.sin(elapsedSeconds * JAR_BOB_SPEED) * 4;
        const jarY = glassTopY - shortest * 0.1 + jarBobY;
        jarGraphics
          .circle(jarX, jarY, shortest * 0.028)
          .fill({ color: INGREDIENT_HEX[world.selectedIngredientId], alpha: 0.95 })
          .circle(jarX, jarY, shortest * 0.028)
          .stroke({ width: 2, color: 0xffffff, alpha: 0.7 });
        if (world.isPouring) {
          jarGraphics
            .moveTo(jarX, jarY + shortest * 0.028)
            .lineTo(jarX, jarY + shortest * 0.028 + 10 + Math.sin(elapsedSeconds * 10) * 3)
            .stroke({ width: 2, color: INGREDIENT_HEX[world.selectedIngredientId], alpha: 0.8 });
        }
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => {
          addPourSource(`pointer:${pointer.id}`);
        },
        onPointerUp: (pointer) => {
          removePourSource(`pointer:${pointer.id}`);
        },
        onKeyDown: (key) => {
          if (key === " ") {
            handleTogglePause();
            return;
          }
          if (key === "r") {
            handleRestart();
            return;
          }
          if (key === "enter") {
            addPourSource("keyboard");
            return;
          }
          const index = Number(key) - 1;
          if (Number.isInteger(index) && index >= 0 && index < INGREDIENT_IDS.length) {
            handleSelectIngredient(INGREDIENT_IDS[index]);
          }
        },
        onKeyUp: (key) => {
          if (key === "enter") removePourSource("keyboard");
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
      pourSourcesRef.current.clear();
      if (appRef.current) {
        appRef.current.destroy(true, { children: true });
        appRef.current = null;
      }
    };
  }, [
    addPourSource,
    removePourSource,
    handleTogglePause,
    handleRestart,
    handleSelectIngredient,
    refreshRecipeChips,
  ]);

  useEffect(() => {
    sizeRef.current = { width: size.width, height: size.height };
  }, [size.width, size.height]);

  return (
    <GameShell
      title="Parfait Layer"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="parfait-layer-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="parfait-layer-canvas" />

        <div className={styles.hud}>
          <span className={styles.round} data-testid="parfait-layer-round">
            ROUND {round}
          </span>
          <span className={styles.lives} data-testid="parfait-layer-lives" data-lives={lives}>
            ライフ {lives} / {INITIAL_LIVES}
          </span>
        </div>

        <div className={styles.recipePanel} data-testid="parfait-layer-recipe">
          <span className={styles.recipeLabel}>レシピ</span>
          <div className={styles.recipeChips}>
            {recipeChips.map((chip) => (
              <span
                key={chip.layerIndex}
                className={styles.recipeChip}
                data-testid={`parfait-layer-recipe-chip-${chip.layerIndex}`}
                data-status={chip.status}
                data-ingredient={chip.ingredientId}
                style={{ backgroundColor: INGREDIENT_CSS[chip.ingredientId] }}
              />
            ))}
          </div>
          {!isGameOver && (
            <span className={styles.targetBand} data-testid="parfait-layer-target">
              目安 {targetBandText}
            </span>
          )}
        </div>

        <div className={styles.fillPanel}>
          <span className={styles.fillLabel} data-testid="parfait-layer-fill">
            {fillPercent}%
          </span>
        </div>

        <div className={styles.feedback} data-testid="parfait-layer-feedback">
          {feedbackMessage}
        </div>

        <div className={styles.hint}>
          材料を選んでキャンバスを長押しすると注がれる(長押しを続けるほど流量が増える)。
          レシピと違う材料を注ぐ・グラスをあふれさせるとライフが減る。
          キーボードは1〜4で材料選択、Enter長押しで注ぐ。
        </div>

        <div className={styles.ingredients} data-testid="parfait-layer-ingredients">
          {INGREDIENT_IDS.map((id) => (
            <button
              key={id}
              type="button"
              className={styles.ingredientButton}
              data-testid={`parfait-layer-ingredient-${id}`}
              data-selected={id === selectedIngredientId}
              onClick={() => handleSelectIngredient(id)}
              style={
                id === selectedIngredientId
                  ? { borderColor: INGREDIENT_CSS[id], backgroundColor: INGREDIENT_CSS[id] }
                  : { borderColor: INGREDIENT_CSS[id] }
              }
            >
              {INGREDIENT_LABEL[id]}
            </button>
          ))}
        </div>

        {isGameOver && (
          <div className={styles.gameOver} data-testid="parfait-layer-gameover">
            <div className={styles.gameOverTitle}>パルフェが崩れた…</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="parfait-layer-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
