"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import {
  type ConnectEvent,
  type JackColor,
  LIVES_MAX,
  SLOT_COUNT,
  type SourceState,
  SwitchboardWorld,
  type TimeoutEvent,
} from "./engine/world";
import styles from "./SwitchboardShiftGame.module.scss";

const JACK_HEX = {
  azure: 0x5ec8ff,
  amber: 0xffb454,
  violet: 0xb98bff,
  mint: 0x6ee7b8,
  rose: 0xff6b9d,
} as const satisfies Record<JackColor, number>;

const JACK_CSS = {
  azure: "#5ec8ff",
  amber: "#ffb454",
  violet: "#b98bff",
  mint: "#6ee7b8",
  rose: "#ff6b9d",
} as const satisfies Record<JackColor, string>;

const JACK_LABEL = {
  azure: "青",
  amber: "橙",
  violet: "紫",
  mint: "緑",
  rose: "桃",
} as const satisfies Record<JackColor, string>;

const STATE_LABEL = {
  idle: "待機",
  live: "呼出中",
  cooldown: "冷却中",
} as const satisfies Record<SourceState, string>;

const SOURCE_X_RATIO = 0.22;
const DEST_X_RATIO = 0.78;
const TOP_Y_RATIO = 0.16;
const BOTTOM_Y_RATIO = 0.86;
const HIT_PADDING = 16;
const URGENT_COLOR = 0xff6b6b;
const URGENT_THRESHOLD = 0.3;
const RING_TRACK_COLOR = 0x2b2f3a;
const POPUP_LIFETIME = 0.9;
const CABLE_FLASH_LIFETIME = 0.35;

interface JackPosition {
  x: number;
  y: number;
}

function jackRadius(width: number, height: number): number {
  const shortest = Math.min(width, height);
  return Math.min(30, Math.max(16, shortest * 0.045));
}

function jackPosition(
  side: "source" | "destination",
  index: number,
  width: number,
  height: number,
): JackPosition {
  const x = width * (side === "source" ? SOURCE_X_RATIO : DEST_X_RATIO);
  const y = height * (TOP_Y_RATIO + (index * (BOTTOM_Y_RATIO - TOP_Y_RATIO)) / (SLOT_COUNT - 1));
  return { x, y };
}

function findLiveSourceAt(
  world: SwitchboardWorld,
  x: number,
  y: number,
  width: number,
  height: number,
): number | null {
  const radius = jackRadius(width, height) + HIT_PADDING;
  for (const jack of world.sourceJacks) {
    if (jack.state !== "live") continue;
    const pos = jackPosition("source", jack.index, width, height);
    if (Math.hypot(pos.x - x, pos.y - y) <= radius) return jack.index;
  }
  return null;
}

function findDestinationAt(
  world: SwitchboardWorld,
  x: number,
  y: number,
  width: number,
  height: number,
): number | null {
  const radius = jackRadius(width, height) + HIT_PADDING;
  for (const jack of world.destinationJacks) {
    const pos = jackPosition("destination", jack.index, width, height);
    if (Math.hypot(pos.x - x, pos.y - y) <= radius) return jack.index;
  }
  return null;
}

interface DragState {
  sourceIndex: number;
  x: number;
  y: number;
}

interface CableFlash {
  sourceIndex: number;
  destinationIndex: number;
  color: JackColor;
  age: number;
}

interface FloatingPopup {
  text: Text;
  age: number;
}

interface SourceStatus {
  index: number;
  color: JackColor;
  state: SourceState;
}

export function SwitchboardShiftGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(LIVES_MAX);
  const [sourceStatuses, setSourceStatuses] = useState<SourceStatus[]>([]);
  const [destinationColors, setDestinationColors] = useState<readonly JackColor[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<SwitchboardWorld | null>(null);
  const appRef = useRef<Application | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const sizeRef = useRef({ width: 0, height: 0 });

  const handleTogglePause = useCallback(() => {
    if (!loopRef.current) return;
    setIsPaused(loopRef.current.togglePause());
  }, []);

  const handleRestart = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    world.reset();
    setDestinationColors(world.destinationJacks.map((jack) => jack.color));
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
    const world = new SwitchboardWorld();
    worldRef.current = world;
    setDestinationColors(world.destinationJacks.map((jack) => jack.color));

    const destinationGraphics = new Graphics();
    const sourceGraphics = new Graphics();
    const cableGraphics = new Graphics();
    const popupHost = new Container();
    const floatingPopups: FloatingPopup[] = [];
    const cableFlashes: CableFlash[] = [];
    const draggingByPointer = new Map<number, DragState>();
    let heldSourceIndex: number | null = null;
    let sourceSignature = "";

    const spawnPopup = (label: string, color: number, x: number, y: number): void => {
      const text = new Text({
        text: label,
        style: { fill: color, fontSize: 16, fontWeight: "700" },
      });
      text.anchor.set(0.5, 0.5);
      text.position.set(x, y);
      popupHost.addChild(text);
      floatingPopups.push({ text, age: 0 });
    };

    world.onConnect = ({ result, sourceIndex, destinationIndex, points }: ConnectEvent) => {
      const { width, height } = sizeRef.current;
      if (width === 0 || height === 0) return;
      const destPos = jackPosition("destination", destinationIndex, width, height);
      if (result === "correct") {
        spawnPopup(
          `+${points}`,
          JACK_HEX[world.sourceJacks[sourceIndex].color],
          destPos.x,
          destPos.y,
        );
        cableFlashes.push({
          sourceIndex,
          destinationIndex,
          color: world.sourceJacks[sourceIndex].color,
          age: 0,
        });
      } else if (result === "wrong") {
        spawnPopup("誤接続", URGENT_COLOR, destPos.x, destPos.y);
      }
    };
    world.onTimeout = ({ sourceIndex }: TimeoutEvent) => {
      const { width, height } = sizeRef.current;
      if (width === 0 || height === 0) return;
      const pos = jackPosition("source", sourceIndex, width, height);
      spawnPopup("応答なし", URGENT_COLOR, pos.x, pos.y - jackRadius(width, height) - 14);
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x0a0b12,
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
      app.stage.addChild(destinationGraphics, cableGraphics, sourceGraphics, popupHost);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        world.step(deltaSeconds);

        setScore(world.score);
        setLives(world.lives);
        if (world.isOver) setIsOver(true);

        const signature = world.sourceJacks.map((jack) => jack.state).join(",");
        if (signature !== sourceSignature) {
          sourceSignature = signature;
          setSourceStatuses(
            world.sourceJacks.map((jack) => ({
              index: jack.index,
              color: jack.color,
              state: jack.state,
            })),
          );
        }

        const { width, height } = sizeRef.current;
        if (width > 0 && height > 0) {
          const radius = jackRadius(width, height);

          destinationGraphics.clear();
          for (const jack of world.destinationJacks) {
            const pos = jackPosition("destination", jack.index, width, height);
            destinationGraphics
              .circle(pos.x, pos.y, radius)
              .fill({ color: JACK_HEX[jack.color], alpha: 0.9 })
              .stroke({ width: 2, color: 0xffffff, alpha: 0.5 });
          }

          sourceGraphics.clear();
          for (const jack of world.sourceJacks) {
            const pos = jackPosition("source", jack.index, width, height);
            if (jack.state === "live") {
              const ratio = jack.duration > 0 ? Math.max(0, jack.timer / jack.duration) : 0;
              const ringColor = ratio < URGENT_THRESHOLD ? URGENT_COLOR : 0xffffff;
              sourceGraphics
                .circle(pos.x, pos.y, radius + 8)
                .stroke({ width: 4, color: RING_TRACK_COLOR, alpha: 0.4 });
              if (ratio > 0) {
                const startAngle = -Math.PI / 2;
                const endAngle = startAngle + Math.PI * 2 * ratio;
                sourceGraphics
                  .moveTo(
                    pos.x + Math.cos(startAngle) * (radius + 8),
                    pos.y + Math.sin(startAngle) * (radius + 8),
                  )
                  .arc(pos.x, pos.y, radius + 8, startAngle, endAngle)
                  .stroke({ width: 4, color: ringColor, alpha: 0.9 });
              }
              sourceGraphics
                .circle(pos.x, pos.y, radius)
                .fill({ color: JACK_HEX[jack.color], alpha: 0.95 })
                .stroke({ width: 2, color: 0xffffff, alpha: 0.85 });
            } else if (jack.state === "cooldown") {
              sourceGraphics
                .circle(pos.x, pos.y, radius)
                .fill({ color: 0x2b2f3a, alpha: 0.6 })
                .stroke({ width: 2, color: JACK_HEX[jack.color], alpha: 0.35 });
            } else {
              sourceGraphics
                .circle(pos.x, pos.y, radius)
                .fill({ color: JACK_HEX[jack.color], alpha: 0.25 })
                .stroke({ width: 2, color: 0xffffff, alpha: 0.25 });
            }
            if (heldSourceIndex === jack.index) {
              sourceGraphics
                .circle(pos.x, pos.y, radius + 14)
                .stroke({ width: 3, color: 0xffffff, alpha: 0.8 });
            }
          }

          cableGraphics.clear();
          for (const drag of draggingByPointer.values()) {
            const jack = world.sourceJacks[drag.sourceIndex];
            if (jack?.state !== "live") continue;
            const from = jackPosition("source", drag.sourceIndex, width, height);
            cableGraphics
              .moveTo(from.x, from.y)
              .lineTo(drag.x, drag.y)
              .stroke({ width: 4, color: JACK_HEX[jack.color], alpha: 0.85 });
            cableGraphics
              .circle(drag.x, drag.y, 6)
              .fill({ color: JACK_HEX[jack.color], alpha: 0.9 });
          }
          for (let i = cableFlashes.length - 1; i >= 0; i--) {
            const flash = cableFlashes[i];
            flash.age += deltaSeconds;
            if (flash.age >= CABLE_FLASH_LIFETIME) {
              cableFlashes.splice(i, 1);
              continue;
            }
            const alpha = Math.max(0, 1 - flash.age / CABLE_FLASH_LIFETIME);
            const from = jackPosition("source", flash.sourceIndex, width, height);
            const to = jackPosition("destination", flash.destinationIndex, width, height);
            cableGraphics
              .moveTo(from.x, from.y)
              .lineTo(to.x, to.y)
              .stroke({ width: 5, color: JACK_HEX[flash.color], alpha: alpha * 0.9 });
          }

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
        }
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => {
          const { width, height } = sizeRef.current;
          if (width === 0 || height === 0) return;
          const sourceIndex = findLiveSourceAt(world, pointer.x, pointer.y, width, height);
          if (sourceIndex !== null) {
            draggingByPointer.set(pointer.id, { sourceIndex, x: pointer.x, y: pointer.y });
            heldSourceIndex = null;
          }
        },
        onPointerMove: (pointer) => {
          const drag = draggingByPointer.get(pointer.id);
          if (!drag) return;
          drag.x = pointer.x;
          drag.y = pointer.y;
        },
        onPointerUp: (pointer) => {
          const drag = draggingByPointer.get(pointer.id);
          draggingByPointer.delete(pointer.id);
          if (!drag) return;
          const { width, height } = sizeRef.current;
          if (width === 0 || height === 0) return;
          const destinationIndex = findDestinationAt(world, pointer.x, pointer.y, width, height);
          if (destinationIndex !== null) {
            world.attemptConnect(drag.sourceIndex, destinationIndex);
          }
        },
        onKeyDown: (key) => {
          if (loop.isPaused && key !== " ") return;
          if (key === " ") {
            setIsPaused(loop.togglePause());
            return;
          }
          if (key === "r") {
            world.reset();
            setDestinationColors(world.destinationJacks.map((jack) => jack.color));
            heldSourceIndex = null;
            setIsOver(false);
            return;
          }
          if (/^[1-5]$/.test(key)) {
            const index = Number(key) - 1;
            if (heldSourceIndex === null) {
              if (world.sourceJacks[index]?.state === "live") heldSourceIndex = index;
            } else if (heldSourceIndex === index) {
              heldSourceIndex = null;
            } else {
              world.attemptConnect(heldSourceIndex, index);
              heldSourceIndex = null;
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
    sizeRef.current = { width: size.width, height: size.height };
  }, [size.width, size.height]);

  return (
    <GameShell
      title="Switchboard Shift"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="switchboard-shift-stage">
        <div
          ref={canvasHostRef}
          className={styles.canvasHost}
          data-testid="switchboard-shift-canvas"
        />
        <div className={styles.hud}>
          <span className={styles.lives} data-testid="switchboard-shift-lives" data-lives={lives}>
            ライフ {lives} / {LIVES_MAX}
          </span>
        </div>
        <div className={styles.hint}>
          光った発信ジャックからドラッグし、同じ色の受信ジャックへ繋いで接続。放置や誤接続はライフを削る。キーボードは1〜5で発信ジャックを持ち、もう一度1〜5で相手へ接続。
        </div>
        <div className={styles.panel}>
          <div className={styles.panelRow} data-testid="switchboard-shift-sources">
            <span className={styles.panelLabel}>発信</span>
            {sourceStatuses.map((status) => (
              <span
                key={status.index}
                className={styles.lamp}
                data-testid={`switchboard-shift-source-${status.index}`}
                data-color={status.color}
                data-state={status.state}
                data-index={status.index}
                style={{ backgroundColor: JACK_CSS[status.color] }}
                title={`発信${status.index + 1}: ${JACK_LABEL[status.color]} (${STATE_LABEL[status.state]})`}
              />
            ))}
          </div>
          <div className={styles.panelRow} data-testid="switchboard-shift-destinations">
            <span className={styles.panelLabel}>受信</span>
            {destinationColors.map((color, index) => (
              <span
                key={color}
                className={styles.lamp}
                data-testid={`switchboard-shift-destination-${index}`}
                data-color={color}
                data-index={index}
                style={{ backgroundColor: JACK_CSS[color] }}
                title={`受信${index + 1}: ${JACK_LABEL[color]}`}
              />
            ))}
          </div>
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="switchboard-shift-gameover">
            <div className={styles.gameOverTitle}>シフト終了</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="switchboard-shift-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
