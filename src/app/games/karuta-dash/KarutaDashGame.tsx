"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  KarutaDashWorld,
  type MissReason,
  START_LIVES,
} from "./engine/world";
import styles from "./KarutaDashGame.module.scss";

const SELECTOR_KEY_SPEED = 900; // px/秒。キーボードで手を動かす速さ
const POPUP_LIFETIME = 1.0;

const CARD_COLOR = 0xf4e8c7;
const CARD_BORDER_COLOR = 0x6b4b2b;
const CARD_FLASH_COLOR = 0xff6b6b;
const CARD_TEXT_COLOR = 0x2c1b0f;
const POPUP_CAPTURE_COLOR = 0x7cf5c4;
const POPUP_WRONG_COLOR = 0xff6b6b;
const POPUP_SNATCH_COLOR = 0xffb454;
const POPUP_ROUND_COLOR = 0xffe066;
const SELECTOR_COLOR = 0x6ee7ff;

interface CardAnchor {
  id: number;
  label: string;
  x: number;
  y: number;
}

interface FloatingPopup {
  text: Text;
  age: number;
}

function missPopupText(reason: MissReason, label: string | null): string {
  if (reason === "snatchedByRival") return label ? `横取り!「${label}」` : "横取りされた!";
  return "ちがう札!";
}

export function KarutaDashGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [round, setRound] = useState(1);
  const [lives, setLives] = useState(START_LIVES);
  const [combo, setCombo] = useState(0);
  const [targetLabel, setTargetLabel] = useState("");
  const [rivalProgress, setRivalProgress] = useState(0);
  const [selectorPosition, setSelectorPosition] = useState({ x: 0, y: 0 });
  const [cardAnchors, setCardAnchors] = useState<CardAnchor[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<KarutaDashWorld | null>(null);
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

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    let disposed = false;

    const app = new Application();
    const world = new KarutaDashWorld(1, 1);
    worldRef.current = world;

    const cardGraphics = new Graphics();
    const selectorGraphics = new Graphics();
    const labelHost = new Container();
    const popupHost = new Container();
    const labelsByCardId = new Map<number, Text>();
    const floatingPopups: FloatingPopup[] = [];

    const syncCardState = (): void => {
      setCardAnchors(world.cards.map((c) => ({ id: c.id, label: c.label, x: c.x, y: c.y })));
    };

    const syncLabels = (): void => {
      for (const [id, text] of labelsByCardId) {
        if (!world.cards.some((c) => c.id === id)) {
          labelHost.removeChild(text);
          text.destroy();
          labelsByCardId.delete(id);
        }
      }
      for (const card of world.cards) {
        let text = labelsByCardId.get(card.id);
        if (!text) {
          text = new Text({
            text: card.label,
            style: { fill: CARD_TEXT_COLOR, fontSize: 26, fontWeight: "700" },
          });
          text.anchor.set(0.5, 0.5);
          labelHost.addChild(text);
          labelsByCardId.set(card.id, text);
        }
        text.position.set(card.x, card.y);
      }
    };

    const spawnPopup = (label: string, color: number, x: number, y: number): void => {
      const text = new Text({
        text: label,
        style: { fill: color, fontSize: 18, fontWeight: "700" },
      });
      text.anchor.set(0.5, 0.5);
      text.position.set(x, y);
      popupHost.addChild(text);
      floatingPopups.push({ text, age: 0 });
    };

    world.onCardCaptured = ({ points, x, y }) => {
      syncCardState();
      spawnPopup(`+${points}`, POPUP_CAPTURE_COLOR, x, y);
    };
    world.onMiss = ({ reason, label, x, y }) => {
      syncCardState();
      if (x !== null && y !== null) {
        const color = reason === "snatchedByRival" ? POPUP_SNATCH_COLOR : POPUP_WRONG_COLOR;
        spawnPopup(missPopupText(reason, label), color, x, y);
      }
    };
    world.onRoundStarted = () => {
      syncCardState();
    };
    world.onRoundCleared = ({ bonus }) => {
      const { width } = sizeRef.current;
      spawnPopup(`ROUND CLEAR +${bonus}`, POPUP_ROUND_COLOR, width / 2, 60);
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x241a12,
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
      app.stage.addChild(cardGraphics, labelHost, selectorGraphics, popupHost);
      appRef.current = app;

      // onRoundStartedを割り当てる前に最初のラウンドが生成済みのため、ここで一度だけ反映する
      syncCardState();

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
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
        setCombo(world.combo);
        setTargetLabel(world.targetLabel);
        setRivalProgress(world.rivalProgress);
        setSelectorPosition({ x: world.selectorX, y: world.selectorY });
        if (world.isOver) setIsOver(true);

        const { width, height } = sizeRef.current;
        if (width <= 0 || height <= 0) return;

        cardGraphics.clear();
        for (const card of world.cards) {
          const isFlashing =
            world.missFlashRemaining > 0 &&
            world.missFlashCardId === card.id &&
            world.lastMissReason === "wrongCard";
          cardGraphics
            .roundRect(
              card.x - CARD_WIDTH / 2,
              card.y - CARD_HEIGHT / 2,
              CARD_WIDTH,
              CARD_HEIGHT,
              8,
            )
            .fill({ color: CARD_COLOR, alpha: 0.96 })
            .stroke({
              width: isFlashing ? 4 : 2,
              color: isFlashing ? CARD_FLASH_COLOR : CARD_BORDER_COLOR,
            });
        }
        syncLabels();

        selectorGraphics.clear();
        const pulse = 0.6 + 0.4 * Math.sin(world.elapsedSeconds * 6);
        selectorGraphics
          .circle(world.selectorX, world.selectorY, 10 + 3 * pulse)
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
          world.setSelectorPosition(pointer.x, pointer.y);
          world.grabAtSelector();
        },
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
          } else if (key === "r") {
            world.reset();
            setIsOver(false);
          } else if (key === "enter") {
            if (!loop.isPaused) world.grabAtSelector();
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
    if (size.width === 0 || size.height === 0) return;
    const world = worldRef.current;
    if (!world) return;
    world.resize(size.width, size.height);
    setCardAnchors(world.cards.map((c) => ({ id: c.id, label: c.label, x: c.x, y: c.y })));
  }, [size.width, size.height]);

  const rivalPercent = Math.round(rivalProgress * 100);

  return (
    <GameShell
      title="Karuta Dash"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="karuta-dash-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="karuta-dash-canvas" />

        {cardAnchors.map((card) => (
          <div
            key={card.id}
            className={styles.cardAnchor}
            data-testid={`karuta-dash-card-${card.id}`}
            data-label={card.label}
            style={{ left: `${card.x}px`, top: `${card.y}px` }}
          />
        ))}

        <div
          className={styles.debug}
          data-testid="karuta-dash-debug"
          data-target-label={targetLabel}
          data-rival-progress={rivalProgress.toFixed(3)}
          data-round={round}
          data-combo={combo}
          data-selector-x={selectorPosition.x.toFixed(1)}
          data-selector-y={selectorPosition.y.toFixed(1)}
        />

        <div className={styles.hud}>
          <span className={styles.round} data-testid="karuta-dash-round">
            ROUND {round}
          </span>
          <span className={styles.lives} data-testid="karuta-dash-lives">
            ライフ {lives}
          </span>
          <span className={styles.combo} data-testid="karuta-dash-combo">
            コンボ {combo}
          </span>
        </div>

        <div className={styles.prompt} data-testid="karuta-dash-prompt">
          さがす札:
          <span className={styles.promptLabel} data-testid="karuta-dash-target-label">
            {targetLabel}
          </span>
        </div>

        <div className={styles.rivalGauge} data-testid="karuta-dash-rival-gauge">
          <span className={styles.rivalGaugeLabel}>ライバルの手</span>
          <div className={styles.rivalGaugeTrack}>
            <div
              className={styles.rivalGaugeFill}
              style={{ width: `${rivalPercent}%` }}
              data-danger={rivalPercent >= 80}
            />
          </div>
        </div>

        <div className={styles.hint}>
          表示された文字の札をクリック/タップして取ろう。ライバルが先に手を伸ばして0になる前に
          見つけて取れ。ハズレの札を取るとライフが減る。矢印キー/WASDで手を移動しEnterで取ることも
          できる。Space: 一時停止 / R: リセット。
        </div>

        {isOver && (
          <div className={styles.gameOver} data-testid="karuta-dash-gameover">
            <div className={styles.gameOverTitle}>場が片付いた…</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <div className={styles.gameOverRound}>ROUND {round}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="karuta-dash-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
