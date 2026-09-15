"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import styles from "./ConstellationEchoGame.module.scss";
import {
  ConstellationEchoWorld,
  type MistakeReason,
  type Phase,
  STAR_COUNT,
  STAR_RADIUS,
} from "./engine/world";

const STAR_COLOR_IDLE = 0x6ee7ff;
const STAR_COLOR_CONFIRMED = 0xffe066;
const STAR_COLOR_FLASH = 0xffffff;
const STAR_COLOR_MISTAKE = 0xff6b6b;
const LINE_COLOR_PREVIEW = 0x6ee7ff;
const LINE_COLOR_CONFIRMED = 0xffe066;
const BG_STAR_COLOR = 0x9aa0ac;

const POPUP_LIFETIME = 1.0;
const FLASH_DURATION = 0.5;
const BG_STAR_COUNT = 26;

interface StarPosition {
  id: number;
  x: number;
  y: number;
}

interface FloatingPopup {
  text: Text;
  age: number;
}

interface BackgroundStar {
  xRatio: number;
  yRatio: number;
  radius: number;
  phase: number;
  speed: number;
}

function createBackgroundStars(count: number): BackgroundStar[] {
  return Array.from({ length: count }, () => ({
    xRatio: Math.random(),
    yRatio: Math.random(),
    radius: 0.6 + Math.random() * 1.4,
    phase: Math.random() * Math.PI * 2,
    speed: 0.5 + Math.random() * 0.8,
  }));
}

const STATUS_TEXT: Record<Phase, string> = {
  preview: "見て覚えて…",
  recall: "同じ順にタップ!",
  success: "せいかい!",
  mistake: "ちがった…",
  gameOver: "しゅうりょう",
};

function mistakeStatusText(reason: MistakeReason | null): string {
  if (reason === "timeout") return "時間切れ…";
  if (reason === "wrongStar") return "ちがう星…";
  return STATUS_TEXT.mistake;
}

export function ConstellationEchoGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [round, setRound] = useState(1);
  const [lives, setLives] = useState(3);
  const [phase, setPhase] = useState<Phase>("preview");
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [recallProgress, setRecallProgress] = useState(0);
  const [lastMistakeReason, setLastMistakeReason] = useState<MistakeReason | null>(null);
  const [starPositions, setStarPositions] = useState<StarPosition[]>([]);
  const [sequence, setSequence] = useState<number[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<ConstellationEchoWorld | null>(null);
  const appRef = useRef<Application | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const sizeRef = useRef({ width: 0, height: 0 });

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

  const handleSelectStar = useCallback((id: number) => {
    if (!worldRef.current || loopRef.current?.isPaused) return;
    worldRef.current.selectStar(id);
  }, []);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    let disposed = false;

    const app = new Application();
    const world = new ConstellationEchoWorld(1, 1);
    worldRef.current = world;

    const backgroundGraphics = new Graphics();
    const lineGraphics = new Graphics();
    const starGraphics = new Graphics();
    const labelHost = new Container();
    const popupHost = new Container();
    const labelsByStarId = new Map<number, Text>();
    const floatingPopups: FloatingPopup[] = [];
    const backgroundStars = createBackgroundStars(BG_STAR_COUNT);

    let previewFlash: { starId: number; startedAt: number } | null = null;

    const spawnPopup = (label: string, color: number, xRatio: number, yRatio: number): void => {
      const { width, height } = sizeRef.current;
      const text = new Text({
        text: label,
        style: { fill: color, fontSize: 18, fontWeight: "700" },
      });
      text.anchor.set(0.5, 0.5);
      text.position.set(width * xRatio, height * yRatio);
      popupHost.addChild(text);
      floatingPopups.push({ text, age: 0 });
    };

    const syncLabels = (): void => {
      for (const [id, text] of labelsByStarId) {
        if (!world.stars.some((s) => s.id === id)) {
          labelHost.removeChild(text);
          text.destroy();
          labelsByStarId.delete(id);
        }
      }
      for (const star of world.stars) {
        let text = labelsByStarId.get(star.id);
        if (!text) {
          text = new Text({
            text: String(star.id + 1),
            style: { fill: 0xffffff, fontSize: 12, fontWeight: "600" },
          });
          text.anchor.set(0.5, 0.5);
          labelHost.addChild(text);
          labelsByStarId.set(star.id, text);
        }
        text.position.set(star.x, star.y + STAR_RADIUS + 12);
      }
    };

    const syncStarState = (): void => {
      setStarPositions(world.stars.map((s) => ({ id: s.id, x: s.x, y: s.y })));
      setSequence([...world.sequence]);
    };

    world.onRoundStarted = () => {
      syncStarState();
      syncLabels();
    };
    world.onStarRevealed = ({ star }) => {
      previewFlash = { starId: star.id, startedAt: world.elapsedSeconds };
    };
    world.onRoundCleared = ({ points }) => {
      spawnPopup(`+${points}`, STAR_COLOR_CONFIRMED, 0.5, 0.14);
    };
    world.onMistake = ({ reason }) => {
      spawnPopup(reason === "timeout" ? "時間切れ!" : "ちがう星!", STAR_COLOR_MISTAKE, 0.5, 0.14);
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x05070f,
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
      app.stage.addChild(backgroundGraphics, lineGraphics, starGraphics, labelHost, popupHost);
      appRef.current = app;

      // onRoundStartedを割り当てる前に最初のラウンドが生成済みのため、ここで一度だけ反映する
      syncStarState();
      syncLabels();

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        world.step(deltaSeconds);

        setScore(world.score);
        setRound(world.round);
        setLives(world.lives);
        setPhase(world.phase);
        setTimeRemaining(world.timeRemaining);
        setRecallProgress(world.recallProgress);
        if (world.lastMistakeReason) setLastMistakeReason(world.lastMistakeReason);
        if (world.isOver) setIsOver(true);

        const { width, height } = sizeRef.current;
        if (width <= 0 || height <= 0) return;

        backgroundGraphics.clear();
        for (const bg of backgroundStars) {
          const twinkle =
            0.35 + 0.45 * (0.5 + 0.5 * Math.sin(world.elapsedSeconds * bg.speed + bg.phase));
          backgroundGraphics
            .circle(bg.xRatio * width, bg.yRatio * height, bg.radius)
            .fill({ color: BG_STAR_COLOR, alpha: twinkle });
        }

        lineGraphics.clear();
        const previewCount =
          world.phase === "preview" ? world.revealedCount : world.sequence.length;
        for (let i = 1; i < previewCount; i++) {
          const from = world.stars[world.sequence[i - 1]];
          const to = world.stars[world.sequence[i]];
          if (!from || !to) continue;
          lineGraphics
            .moveTo(from.x, from.y)
            .lineTo(to.x, to.y)
            .stroke({ width: 2.5, color: LINE_COLOR_PREVIEW, alpha: 0.55 });
        }
        if (world.phase === "recall" || world.phase === "success") {
          for (let i = 1; i < world.recallProgress; i++) {
            const from = world.stars[world.sequence[i - 1]];
            const to = world.stars[world.sequence[i]];
            if (!from || !to) continue;
            lineGraphics
              .moveTo(from.x, from.y)
              .lineTo(to.x, to.y)
              .stroke({ width: 3, color: LINE_COLOR_CONFIRMED, alpha: 0.85 });
          }
        }

        starGraphics.clear();
        for (const star of world.stars) {
          const twinkle = 0.6 + 0.4 * Math.sin(world.elapsedSeconds * 2.4 + star.id * 1.3);
          const confirmedIndex = world.sequence.indexOf(star.id);
          const isConfirmed =
            (world.phase === "recall" || world.phase === "success") &&
            confirmedIndex >= 0 &&
            confirmedIndex < world.recallProgress;

          let color = STAR_COLOR_IDLE;
          let radius = STAR_RADIUS * (0.85 + 0.15 * twinkle);
          let alpha = 0.55 + 0.35 * twinkle;

          if (isConfirmed) {
            color = STAR_COLOR_CONFIRMED;
            alpha = 0.95;
          }

          if (previewFlash?.starId === star.id) {
            const age = world.elapsedSeconds - previewFlash.startedAt;
            if (age >= 0 && age < FLASH_DURATION) {
              const t = age / FLASH_DURATION;
              color = STAR_COLOR_FLASH;
              alpha = 1;
              radius = STAR_RADIUS * (1 + 0.9 * (1 - t));
              starGraphics
                .circle(star.x, star.y, STAR_RADIUS * (1.6 + 1.4 * t))
                .stroke({ width: 2, color: STAR_COLOR_FLASH, alpha: (1 - t) * 0.6 });
            } else {
              previewFlash = null;
            }
          }

          if (world.mistakeFlashRemaining > 0 && world.mistakeFlashStarId === star.id) {
            const t = world.mistakeFlashRemaining / FLASH_DURATION;
            color = STAR_COLOR_MISTAKE;
            alpha = 1;
            starGraphics
              .circle(star.x, star.y, STAR_RADIUS * (1.4 + 1.2 * (1 - t)))
              .stroke({ width: 2, color: STAR_COLOR_MISTAKE, alpha: t * 0.7 });
          }

          starGraphics.circle(star.x, star.y, radius).fill({ color, alpha });
        }

        for (let i = floatingPopups.length - 1; i >= 0; i--) {
          const entry = floatingPopups[i];
          entry.age += deltaSeconds;
          entry.text.position.y -= deltaSeconds * 22;
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
          const star = world.findStarAt(pointer.x, pointer.y);
          if (star) handleSelectStar(star.id);
        },
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
          } else if (key === "r") {
            world.reset();
            setIsOver(false);
          } else {
            const digit = Number.parseInt(key, 10);
            if (Number.isInteger(digit) && digit >= 1 && digit <= STAR_COUNT) {
              handleSelectStar(digit - 1);
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
  }, [handleSelectStar]);

  useEffect(() => {
    sizeRef.current = { width: size.width, height: size.height };
    if (size.width === 0 || size.height === 0) return;
    const world = worldRef.current;
    if (!world) return;
    world.resize(size.width, size.height);
    setStarPositions(world.stars.map((s) => ({ id: s.id, x: s.x, y: s.y })));
  }, [size.width, size.height]);

  const statusText =
    phase === "mistake" ? mistakeStatusText(lastMistakeReason) : STATUS_TEXT[phase];

  return (
    <GameShell
      title="Constellation Echo"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="constellation-echo-stage">
        <div
          ref={canvasHostRef}
          className={styles.canvasHost}
          data-testid="constellation-echo-canvas"
        />

        {starPositions.map((star) => (
          <div
            key={star.id}
            className={styles.starAnchor}
            data-testid={`constellation-echo-star-${star.id}`}
            style={{ left: `${star.x}px`, top: `${star.y}px` }}
          />
        ))}

        <div
          className={styles.sequenceDebug}
          data-testid="constellation-echo-sequence"
          data-sequence={sequence.join(",")}
          data-phase={phase}
          data-round={round}
          data-recall-progress={recallProgress}
        />

        <div className={styles.hud}>
          <span className={styles.round} data-testid="constellation-echo-round">
            ROUND {round}
          </span>
          <span className={styles.lives} data-testid="constellation-echo-lives">
            ライフ {lives}
          </span>
          {phase === "recall" && (
            <span className={styles.timer} data-testid="constellation-echo-timer">
              ⏱ {timeRemaining.toFixed(1)}s
            </span>
          )}
        </div>

        <div className={styles.status} data-testid="constellation-echo-status">
          {statusText}
          {phase === "recall" && sequence.length > 0 && (
            <span className={styles.progress}>
              {" "}
              {recallProgress}/{sequence.length}
            </span>
          )}
        </div>

        <div className={styles.hint}>
          光った星の順番を覚えて、同じ順にクリック/タップ(またはキーボードの1〜{STAR_COUNT}
          )で選ぼう。 制限時間内に全部選べればクリア、間違えるか時間切れになるとライフが減る。
          Space: 一時停止 / R: リセット。
        </div>

        {isOver && (
          <div className={styles.gameOver} data-testid="constellation-echo-gameover">
            <div className={styles.gameOverTitle}>星が消えた…</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <div className={styles.gameOverRound}>ROUND {round}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="constellation-echo-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
