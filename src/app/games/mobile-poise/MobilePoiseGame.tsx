"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import { type Charm, type Hook, MobilePoiseWorld } from "./engine/world";
import styles from "./MobilePoiseGame.module.scss";

const BOB_FREQUENCY = 1.6;
const BOB_AMPLITUDE = 5;
const NEEDLE_TORQUE_RANGE = 24;

interface DraggingState {
  charmId: number;
  x: number;
  y: number;
}

export function MobilePoiseGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [level, setLevel] = useState(1);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [holdProgress, setHoldProgress] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);
  const [roundHooks, setRoundHooks] = useState<Hook[]>([]);
  const [roundCharms, setRoundCharms] = useState<Charm[]>([]);
  const [targetTorque, setTargetTorque] = useState(0);
  const [selectedHookIndex, setSelectedHookIndex] = useState<number | null>(null);

  const interactionRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<MobilePoiseWorld | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const hookElementsRef = useRef(new Map<number, HTMLDivElement>());
  const charmElementsRef = useRef(new Map<number, HTMLDivElement>());
  const rodElementRef = useRef<HTMLDivElement | null>(null);
  const needleElementRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef<DraggingState | null>(null);
  const selectedHookIndexRef = useRef<number | null>(null);
  const lastRoundHooksRef = useRef<Hook[] | null>(null);

  const handleTogglePause = useCallback(() => {
    if (!loopRef.current) return;
    setIsPaused(loopRef.current.togglePause());
  }, []);

  const handleRestart = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    world.reset();
    selectedHookIndexRef.current = null;
    setSelectedHookIndex(null);
    setIsOver(false);
    if (loopRef.current?.isPaused) {
      loopRef.current.resume();
      setIsPaused(false);
    }
  }, []);

  useEffect(() => {
    const stage = interactionRef.current;
    if (!stage) return;

    const world = new MobilePoiseWorld(1, 1);
    worldRef.current = world;
    setRoundHooks(world.hooks);
    setRoundCharms(world.charms);
    setTargetTorque(world.targetTorque);
    lastRoundHooksRef.current = world.hooks;

    const input = new InputManager(stage);
    inputRef.current = input;

    const loop = new GameLoop((deltaSeconds, elapsedSeconds) => {
      world.step(deltaSeconds);
      setScore(world.score);
      setLevel(world.level);
      setTimeRemaining(Math.ceil(world.roundTimeRemaining));
      setHoldProgress(
        world.holdRequiredSeconds > 0
          ? Math.min(1, world.holdTimer / world.holdRequiredSeconds)
          : 0,
      );
      if (world.isOver) setIsOver(true);

      if (world.hooks !== lastRoundHooksRef.current) {
        lastRoundHooksRef.current = world.hooks;
        setRoundHooks(world.hooks);
        setRoundCharms(world.charms);
        setTargetTorque(world.targetTorque);
      }

      const [rodA, rodB] = world.rodEndpoints();
      const rodEl = rodElementRef.current;
      if (rodEl) {
        const midX = (rodA.x + rodB.x) / 2;
        const midY = (rodA.y + rodB.y) / 2;
        const length = Math.hypot(rodB.x - rodA.x, rodB.y - rodA.y);
        const angleDeg = (Math.atan2(rodB.y - rodA.y, rodB.x - rodA.x) * 180) / Math.PI;
        rodEl.style.left = `${midX}px`;
        rodEl.style.top = `${midY}px`;
        rodEl.style.width = `${length}px`;
        rodEl.style.transform = `translate(-50%, -50%) rotate(${angleDeg}deg)`;
      }

      for (const hook of world.hooks) {
        const el = hookElementsRef.current.get(hook.id);
        if (!el) continue;
        const p = world.hookPosition(hook);
        el.style.left = `${p.x}px`;
        el.style.top = `${p.y}px`;
        const occupant = world.charms.find((c) => c.hookId === hook.id);
        el.dataset.filled = occupant ? "true" : "false";
        el.dataset.mass = occupant ? String(occupant.mass) : "";
      }

      const dragging = draggingRef.current;
      for (const charm of world.charms) {
        const el = charmElementsRef.current.get(charm.id);
        if (!el) continue;
        const isDragging = dragging?.charmId === charm.id;
        const base = world.charmPosition(charm);
        const bob = isDragging
          ? 0
          : Math.sin(elapsedSeconds * BOB_FREQUENCY + charm.id * 0.9) * BOB_AMPLITUDE;
        const x = isDragging ? dragging.x : base.x;
        const y = (isDragging ? dragging.y : base.y) + bob;
        const radius = world.charmRadius(charm);
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        el.style.width = `${radius * 2}px`;
        el.style.height = `${radius * 2}px`;
        el.style.transform = "translate(-50%, -50%)";
        el.style.zIndex = isDragging ? "10" : "1";
        el.dataset.hookOffset =
          charm.hookId !== null
            ? String(world.hooks.find((h) => h.id === charm.hookId)?.offsetUnits ?? "")
            : "";
      }

      const needleEl = needleElementRef.current;
      if (needleEl) {
        const ratio = Math.min(1, Math.max(-1, world.totalTorque / NEEDLE_TORQUE_RANGE));
        needleEl.style.left = `${50 + ratio * 50}%`;
      }
    }, 0.1);

    input.addListener({
      onPointerDown: (pointer) => {
        const charm = world.findCharmAt(pointer.x, pointer.y);
        if (charm) {
          draggingRef.current = { charmId: charm.id, x: pointer.x, y: pointer.y };
        }
      },
      onPointerMove: (pointer) => {
        if (!draggingRef.current) return;
        draggingRef.current = { ...draggingRef.current, x: pointer.x, y: pointer.y };
      },
      onPointerUp: (pointer) => {
        const dragging = draggingRef.current;
        draggingRef.current = null;
        if (!dragging) return;
        const dragDistance = Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY);
        if (dragDistance < 6) return;
        const hook = world.findHookAt(pointer.x, pointer.y);
        if (hook) {
          world.assignCharmToHook(dragging.charmId, hook.id);
        } else {
          world.unassignCharm(dragging.charmId);
        }
      },
      onKeyDown: (key) => {
        if (key === " ") {
          setIsPaused(loop.togglePause());
          return;
        }
        if (key === "r") {
          world.reset();
          selectedHookIndexRef.current = null;
          setSelectedHookIndex(null);
          setIsOver(false);
          return;
        }
        if (key === "arrowleft" || key === "arrowright") {
          const count = world.hooks.length;
          const current = selectedHookIndexRef.current;
          const next =
            current === null
              ? 0
              : key === "arrowleft"
                ? (current - 1 + count) % count
                : (current + 1) % count;
          selectedHookIndexRef.current = next;
          setSelectedHookIndex(next);
          return;
        }
        const hookIndex = selectedHookIndexRef.current;
        if (hookIndex === null) return;
        const hook = world.hooks[hookIndex];
        if (!hook) return;
        if (key === "backspace" || key === "delete") {
          const occupant = world.charms.find((c) => c.hookId === hook.id);
          if (occupant) world.unassignCharm(occupant.id);
          return;
        }
        const digit = Number(key);
        if (Number.isInteger(digit) && digit >= 1 && digit <= 9) {
          const target = world.getUnassignedCharms()[digit - 1];
          if (target) world.assignCharmToHook(target.id, hook.id);
        }
      },
    });

    loopRef.current = loop;
    loop.start();

    return () => {
      loopRef.current?.stop();
      loopRef.current = null;
      inputRef.current?.dispose();
      inputRef.current = null;
      hookElementsRef.current.clear();
      charmElementsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (size.width === 0 || size.height === 0) return;
    worldRef.current?.resize(size.width, size.height);
  }, [size.width, size.height]);

  return (
    <GameShell
      title="Mobile Poise"
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
        data-testid="mobile-poise-stage"
      >
        <div className={styles.hud}>
          <span className={styles.badge} data-testid="mobile-poise-level">
            LEVEL {level}
          </span>
          <span className={styles.badge} data-testid="mobile-poise-timer">
            ⏱ {timeRemaining}s
          </span>
        </div>

        <div
          className={styles.holdBarTrack}
          data-testid="mobile-poise-hold"
          data-hold-progress={holdProgress.toFixed(2)}
          data-target-torque={targetTorque}
        >
          <div className={styles.holdBand} />
          <div ref={needleElementRef} className={styles.holdNeedle} />
          <div
            className={styles.holdBarFill}
            style={{ width: `${Math.round(holdProgress * 100)}%` }}
          />
        </div>

        <div ref={rodElementRef} className={styles.rod} />

        {roundHooks.map((hook, index) => (
          <div
            key={hook.id}
            ref={(el) => {
              if (el) hookElementsRef.current.set(hook.id, el);
              else hookElementsRef.current.delete(hook.id);
            }}
            className={`${styles.hook} ${selectedHookIndex === index ? styles.hookSelected : ""}`}
            data-testid={`mobile-poise-hook-${index}`}
            data-offset={hook.offsetUnits}
          />
        ))}

        {roundCharms.map((charm, index) => (
          <div
            key={charm.id}
            ref={(el) => {
              if (el) charmElementsRef.current.set(charm.id, el);
              else charmElementsRef.current.delete(charm.id);
            }}
            className={styles.charm}
            data-testid={`mobile-poise-charm-${index}`}
            data-mass={charm.mass}
          />
        ))}

        <div className={styles.hint}>
          おもりをドラッグしてフックに掛け、棒を水平(ゲージ中央)に収めたまま持ちこたえよう。矢印キーでフックを選び、数字キーでトレイのおもりを掛け、Backspaceで外せる。
        </div>

        {isOver && (
          <div className={styles.gameOver} data-testid="mobile-poise-gameover">
            <div className={styles.gameOverTitle}>風に落とされた…</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="mobile-poise-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
