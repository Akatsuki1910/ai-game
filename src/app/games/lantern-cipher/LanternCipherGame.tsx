"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import { type GuessResult, LanternCipherWorld } from "./engine/world";
import styles from "./LanternCipherGame.module.scss";

const LANTERN_COLORS: readonly string[] = [
  "#ff6b6b",
  "#ffb454",
  "#f5d547",
  "#7cf5c4",
  "#6ee7ff",
  "#8a8dff",
  "#f472b6",
  "#c08bff",
];

const FLICKER_FREQUENCY = 3.2;
const FLICKER_AMPLITUDE = 0.18;

function isColorIndex(value: number | null): value is number {
  return value !== null;
}

function emptyGuess(slotCount: number): (number | null)[] {
  return Array.from({ length: slotCount }, () => null);
}

export function LanternCipherGame() {
  const { ref: stageRef } = useElementSize<HTMLDivElement>();

  const [level, setLevel] = useState(1);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [colorCount, setColorCount] = useState(0);
  const [attemptsUsed, setAttemptsUsed] = useState(0);
  const [maxAttempts, setMaxAttempts] = useState(0);
  const [roundTimeRemaining, setRoundTimeRemaining] = useState(0);
  const [roundTimeTotal, setRoundTimeTotal] = useState(0);
  const [history, setHistory] = useState<GuessResult[]>([]);
  const [currentGuess, setCurrentGuess] = useState<(number | null)[]>([]);
  const [focusedSlot, setFocusedSlot] = useState(0);
  const [flicker, setFlicker] = useState(1);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const interactionRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<LanternCipherWorld | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const currentGuessRef = useRef<(number | null)[]>([]);
  const focusedSlotRef = useRef(0);
  const historyLengthRef = useRef(0);
  const lastRoundIdRef = useRef(0);

  const applyGuess = useCallback((updater: (prev: (number | null)[]) => (number | null)[]) => {
    const next = updater(currentGuessRef.current);
    currentGuessRef.current = next;
    setCurrentGuess(next);
  }, []);

  const applyFocus = useCallback((updater: (prev: number) => number) => {
    const next = updater(focusedSlotRef.current);
    focusedSlotRef.current = next;
    setFocusedSlot(next);
  }, []);

  const selectColor = useCallback(
    (colorIndex: number) => {
      if (loopRef.current?.isPaused || !worldRef.current || worldRef.current.isOver) return;
      if (colorIndex < 0 || colorIndex >= worldRef.current.colorCount) return;
      const slotIndex = focusedSlotRef.current;
      applyGuess((prev) => prev.map((color, i) => (i === slotIndex ? colorIndex : color)));
      applyFocus((prev) =>
        Math.min(prev + 1, worldRef.current ? worldRef.current.slotCount - 1 : prev),
      );
    },
    [applyGuess, applyFocus],
  );

  const clearGuess = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    const next = emptyGuess(world.slotCount);
    currentGuessRef.current = next;
    setCurrentGuess(next);
    focusedSlotRef.current = 0;
    setFocusedSlot(0);
  }, []);

  /** 直前にPIN入力の要領で埋めたスロットを消す。現在のスロットが空ならひとつ前のスロットへ戻って消す。 */
  const eraseLastEntry = useCallback(() => {
    const guess = currentGuessRef.current;
    const current = focusedSlotRef.current;
    const targetIndex = guess[current] !== null ? current : Math.max(current - 1, 0);
    applyGuess((prev) => prev.map((color, i) => (i === targetIndex ? null : color)));
    focusedSlotRef.current = targetIndex;
    setFocusedSlot(targetIndex);
  }, [applyGuess]);

  /** 画面に出す全状態をworldの値で即時に揃える。ゲームループの次フレームを待たずに反映するため、マウント時とリスタート時の両方で使う。 */
  const syncFromWorld = useCallback((world: LanternCipherWorld) => {
    historyLengthRef.current = world.history.length;
    lastRoundIdRef.current = world.roundId;
    const guess = emptyGuess(world.slotCount);
    currentGuessRef.current = guess;
    focusedSlotRef.current = 0;
    setLevel(world.level);
    setScore(world.score);
    setLives(world.lives);
    setColorCount(world.colorCount);
    setAttemptsUsed(world.attemptsUsed);
    setMaxAttempts(world.maxAttempts);
    setRoundTimeRemaining(world.roundTimeRemaining);
    setRoundTimeTotal(world.roundTimeRemaining);
    setHistory(world.history);
    setCurrentGuess(guess);
    setFocusedSlot(0);
  }, []);

  const submitGuess = useCallback(() => {
    const world = worldRef.current;
    if (!world || loopRef.current?.isPaused || world.isOver) return;
    const guess = currentGuessRef.current;
    if (!guess.every(isColorIndex)) return;
    const result = world.submitGuess(guess);
    if (!result) return;
    clearGuess();
  }, [clearGuess]);

  const handleTogglePause = useCallback(() => {
    if (!loopRef.current) return;
    setIsPaused(loopRef.current.togglePause());
  }, []);

  const handleRestart = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    world.reset();
    syncFromWorld(world);
    setIsOver(false);
    if (loopRef.current?.isPaused) {
      loopRef.current.resume();
      setIsPaused(false);
    }
  }, [syncFromWorld]);

  useEffect(() => {
    const stage = interactionRef.current;
    if (!stage) return;

    const world = new LanternCipherWorld();
    worldRef.current = world;
    syncFromWorld(world);

    const loop = new GameLoop((deltaSeconds, elapsedSeconds) => {
      world.step(deltaSeconds);

      setLevel(world.level);
      setScore(world.score);
      setLives(world.lives);
      setAttemptsUsed(world.attemptsUsed);
      setRoundTimeRemaining(world.roundTimeRemaining);
      setFlicker(
        1 -
          FLICKER_AMPLITUDE / 2 +
          Math.sin(elapsedSeconds * FLICKER_FREQUENCY) * (FLICKER_AMPLITUDE / 2),
      );
      if (world.isOver) setIsOver(true);

      if (world.roundId !== lastRoundIdRef.current) {
        lastRoundIdRef.current = world.roundId;
        setColorCount(world.colorCount);
        setMaxAttempts(world.maxAttempts);
        setRoundTimeTotal(world.roundTimeRemaining);
        const resetGuess = emptyGuess(world.slotCount);
        currentGuessRef.current = resetGuess;
        setCurrentGuess(resetGuess);
        focusedSlotRef.current = 0;
        setFocusedSlot(0);
      }

      if (world.history.length !== historyLengthRef.current) {
        historyLengthRef.current = world.history.length;
        setHistory(world.history);
      }
    }, 0.1);

    // InputManagerはpointerdown時にtarget(=このstage)へsetPointerCaptureするため、
    // stage配下のボタンのclickが(ブラウザ仕様上)捕捉元のstageへリターゲットされてしまい、
    // DOM操作主体のこのゲームではボタンが事実上押せなくなる。ポインター操作は不要なため
    // キーボードだけを素のwindowイベントで扱い、InputManagerは使わない。
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat) return;
      const key = event.key.toLowerCase();
      if (key === " ") {
        setIsPaused(loop.togglePause());
        return;
      }
      if (key === "r") {
        handleRestart();
        return;
      }
      if (loop.isPaused) return;
      if (key === "arrowleft" || key === "a") {
        applyFocus((prev) => (prev - 1 + world.slotCount) % world.slotCount);
        return;
      }
      if (key === "arrowright" || key === "d") {
        applyFocus((prev) => (prev + 1) % world.slotCount);
        return;
      }
      if (key === "enter") {
        submitGuess();
        return;
      }
      if (key === "backspace" || key === "delete") {
        eraseLastEntry();
        return;
      }
      const digit = Number(key);
      if (Number.isInteger(digit) && digit >= 1 && digit <= world.colorCount) {
        selectColor(digit - 1);
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    loopRef.current = loop;
    loop.start();

    return () => {
      loopRef.current?.stop();
      loopRef.current = null;
      window.removeEventListener("keydown", handleKeyDown);
    };
    // handleRestart/selectColor/submitGuess/applyFocus/applyGuess/eraseLastEntryはrefとstable
    // setterのみに依存するため参照が変わらず、依存配列に含めてもworld/loopの構築は
    // 初回マウント時の1回だけに保たれる。
  }, [applyFocus, eraseLastEntry, handleRestart, selectColor, submitGuess, syncFromWorld]);

  const roundTimeRatio = roundTimeTotal > 0 ? Math.max(0, roundTimeRemaining / roundTimeTotal) : 0;

  return (
    <GameShell
      title="Lantern Cipher"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div
        ref={(el) => {
          stageRef.current = el;
          interactionRef.current = el;
        }}
        className={styles.stageInner}
        data-testid="lantern-cipher-stage"
      >
        <div className={styles.hud}>
          <span className={styles.badge} data-testid="lantern-cipher-level">
            LEVEL {level}
          </span>
          <span className={styles.badge} data-testid="lantern-cipher-lives">
            ♥ {lives}
          </span>
          <span className={styles.badge} data-testid="lantern-cipher-attempts">
            {attemptsUsed}/{maxAttempts}
          </span>
        </div>

        <div
          className={styles.candleTrack}
          data-testid="lantern-cipher-candle"
          data-ratio={roundTimeRatio.toFixed(2)}
        >
          <div className={styles.candleFill} style={{ width: `${roundTimeRatio * 100}%` }} />
          <span className={styles.candleLabel} data-testid="lantern-cipher-timer">
            ⏳ {Math.ceil(roundTimeRemaining)}s
          </span>
        </div>

        <div className={styles.history} data-testid="lantern-cipher-history">
          {history.map((entry, index) => (
            <div
              key={entry.attemptNumber}
              className={styles.historyRow}
              data-testid={`lantern-cipher-history-${index}`}
              data-exact={entry.exactMatches}
              data-color={entry.colorMatches}
              data-guess={entry.guess.join(",")}
            >
              <div className={styles.historyGuess}>
                {entry.guess.map((color, slotIndex) => (
                  <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: スロット位置(slotIndex)自体がこの色チップの意味的なアイデンティティであり、並び替え・削除も発生しない固定長配列のため
                    key={slotIndex}
                    className={styles.historyChip}
                    style={{ background: LANTERN_COLORS[color] }}
                  />
                ))}
              </div>
              <div className={styles.historyFeedback}>
                <span className={styles.exactCount}>🔥{entry.exactMatches}</span>
                <span className={styles.colorCountLabel}>・{entry.colorMatches}</span>
              </div>
            </div>
          ))}
        </div>

        <div className={styles.guessRow}>
          {currentGuess.map((color, index) => (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: スロット位置(index)自体がこのボタンの意味的なアイデンティティであり、並び替え・削除も発生しない固定長配列のため
              key={index}
              type="button"
              className={`${styles.slot} ${focusedSlot === index ? styles.slotFocused : ""}`}
              style={{
                background: color !== null ? LANTERN_COLORS[color] : undefined,
                opacity: color !== null ? flicker : undefined,
              }}
              onClick={() => applyFocus(() => index)}
              disabled={isPaused || isOver}
              data-testid={`lantern-cipher-slot-${index}`}
              data-color={color ?? ""}
              data-focused={focusedSlot === index}
            />
          ))}
        </div>

        <div className={styles.palette}>
          {Array.from({ length: colorCount }, (_, colorIndex) => (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: 色のインデックス(colorIndex)自体がこのボタンの意味的なアイデンティティであり、並び替え・削除も発生しない固定長配列のため
              key={colorIndex}
              type="button"
              className={styles.swatch}
              style={{ background: LANTERN_COLORS[colorIndex] }}
              onClick={() => selectColor(colorIndex)}
              disabled={isPaused || isOver}
              data-testid={`lantern-cipher-color-${colorIndex}`}
            />
          ))}
        </div>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.clearButton}
            onClick={clearGuess}
            disabled={isPaused || isOver}
            data-testid="lantern-cipher-clear"
          >
            消す
          </button>
          <button
            type="button"
            className={styles.submitButton}
            onClick={submitGuess}
            disabled={isPaused || isOver || !currentGuess.every(isColorIndex)}
            data-testid="lantern-cipher-submit"
          >
            点灯して試す
          </button>
        </div>

        <div className={styles.hint}>
          色を選ぶ→スロットが埋まったら「点灯して試す」。🔥は位置も色も正解、・は色だけ正解の数。
          矢印キー/ADでスロット移動、数字キーで色選択、Enterで点灯、Backspaceで1マス消去、Rでやり直し。
        </div>

        {isOver && (
          <div className={styles.gameOver} data-testid="lantern-cipher-gameover">
            <div className={styles.gameOverTitle}>ロウソクが尽きた…</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="lantern-cipher-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
