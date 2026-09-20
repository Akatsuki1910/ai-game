"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import {
  type GrabEvent,
  HAZARD_KIND,
  LANE_COUNT,
  type Lane,
  LIVES_MAX,
  type MissEvent,
  NigiriWorld,
  type OrderableKind,
  SUSHI_KINDS,
  type SushiKind,
} from "./engine/world";
import styles from "./NigiriRushGame.module.scss";

const KIND_HEX = {
  tuna: 0xe9503f,
  salmon: 0xff9e6d,
  egg: 0xffd966,
  cucumber: 0x5fbf6b,
  wasabi: 0xb6ff3c,
} as const satisfies Record<SushiKind, number>;

const KIND_CSS = {
  tuna: "#e9503f",
  salmon: "#ff9e6d",
  egg: "#ffd966",
  cucumber: "#5fbf6b",
  wasabi: "#b6ff3c",
} as const satisfies Record<SushiKind, string>;

const KIND_LABEL = {
  tuna: "まぐろ",
  salmon: "サーモン",
  egg: "たまご",
  cucumber: "きゅうり",
  wasabi: "わさび",
} as const satisfies Record<SushiKind, string>;

const LANE_PICKUP_X_RATIO = 0.27;
const LANE_SPAWN_X_RATIO = 0.93;
const URGENT_COLOR = 0xff6b6b;
const URGENT_THRESHOLD = 0.3;
const TRACK_COLOR = 0x2b2f3a;
const DASH_SPACING = 30;
const DASH_SCROLL_SPEED = 46;
const POPUP_LIFETIME = 0.85;

interface LaneStatus {
  index: number;
  state: Lane["state"];
  kind: SushiKind | null;
}

interface FloatingPopup {
  text: Text;
  age: number;
}

function rowCenterY(index: number, height: number): number {
  return height * ((index + 0.5) / LANE_COUNT);
}

function rowBounds(index: number, height: number): { top: number; height: number } {
  const rowHeight = height / LANE_COUNT;
  return { top: rowHeight * index, height: rowHeight };
}

function laneItemX(lane: Lane, width: number): number | null {
  if (lane.state !== "active" || lane.kind === null || lane.duration <= 0) return null;
  const progress = Math.min(1, Math.max(0, 1 - lane.timer / lane.duration));
  const spawnX = width * LANE_SPAWN_X_RATIO;
  const pickupX = width * LANE_PICKUP_X_RATIO;
  return spawnX - progress * (spawnX - pickupX);
}

function itemRadius(width: number, height: number): number {
  const shortest = Math.min(width, height);
  return Math.min(26, Math.max(14, shortest * 0.05));
}

function drawSushiShape(graphics: Graphics, kind: SushiKind, x: number, y: number, radius: number) {
  const color = KIND_HEX[kind];
  if (kind === HAZARD_KIND) {
    const spikes = 8;
    graphics.moveTo(x + radius, y);
    for (let i = 1; i <= spikes; i++) {
      const angle = (i / spikes) * Math.PI * 2;
      const r = i % 2 === 0 ? radius : radius * 0.62;
      graphics.lineTo(x + Math.cos(angle) * r, y + Math.sin(angle) * r);
    }
    graphics
      .closePath()
      .fill({ color, alpha: 0.95 })
      .stroke({ width: 2, color: 0xffffff, alpha: 0.6 });
    return;
  }
  graphics
    .circle(x, y, radius)
    .fill({ color, alpha: 0.95 })
    .stroke({ width: 2, color: 0xffffff, alpha: 0.75 });
}

export function NigiriRushGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(LIVES_MAX);
  const [laneStatuses, setLaneStatuses] = useState<LaneStatus[]>([]);
  const [target, setTarget] = useState<OrderableKind>(SUSHI_KINDS[0]);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<NigiriWorld | null>(null);
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
    setTarget(world.target);
    setIsOver(false);
    if (loopRef.current?.isPaused) {
      loopRef.current.resume();
      setIsPaused(false);
    }
  }, []);

  const handleGrab = useCallback((laneIndex: number) => {
    worldRef.current?.attemptGrab(laneIndex);
  }, []);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    let disposed = false;

    const app = new Application();
    const world = new NigiriWorld();
    worldRef.current = world;
    setTarget(world.target);

    const trackGraphics = new Graphics();
    const itemGraphics = new Graphics();
    const popupHost = new Container();
    const floatingPopups: FloatingPopup[] = [];
    let laneSignature = "";

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

    world.onGrab = ({ result, laneIndex, points }: GrabEvent) => {
      const { width, height } = sizeRef.current;
      if (width === 0 || height === 0) return;
      const x = width * LANE_PICKUP_X_RATIO;
      const y = rowCenterY(laneIndex, height) - itemRadius(width, height) - 14;
      if (result === "correct") {
        spawnPopup(`+${points}`, 0x7cf5c4, x, y);
      } else if (result === "wrongItem") {
        spawnPopup("違うネタ!", URGENT_COLOR, x, y);
      } else if (result === "hazard") {
        spawnPopup("わさび!", URGENT_COLOR, x, y);
      }
    };
    world.onMiss = ({ laneIndex, kind }: MissEvent) => {
      const { width, height } = sizeRef.current;
      if (width === 0 || height === 0) return;
      const x = width * LANE_PICKUP_X_RATIO;
      const y = rowCenterY(laneIndex, height) - itemRadius(width, height) - 14;
      spawnPopup(`取り逃し(${KIND_LABEL[kind]})`, URGENT_COLOR, x, y);
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
      app.stage.addChild(trackGraphics, itemGraphics, popupHost);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds, elapsedSeconds) => {
        world.step(deltaSeconds);

        setScore(world.score);
        setLives(world.lives);
        setTarget(world.target);
        if (world.isOver) setIsOver(true);

        const signature = world.lanes.map((lane) => `${lane.state}:${lane.kind}`).join(",");
        if (signature !== laneSignature) {
          laneSignature = signature;
          setLaneStatuses(
            world.lanes.map((lane) => ({ index: lane.index, state: lane.state, kind: lane.kind })),
          );
        }

        const { width, height } = sizeRef.current;
        if (width > 0 && height > 0) {
          const radius = itemRadius(width, height);
          const pickupX = width * LANE_PICKUP_X_RATIO;

          trackGraphics.clear();
          for (let index = 0; index < LANE_COUNT; index++) {
            const y = rowCenterY(index, height);
            const bounds = rowBounds(index, height);
            trackGraphics
              .moveTo(8, y)
              .lineTo(width - 8, y)
              .stroke({ width: 2, color: TRACK_COLOR, alpha: 0.5 });

            const scrollOffset = (elapsedSeconds * DASH_SCROLL_SPEED) % DASH_SPACING;
            for (let x = pickupX + DASH_SPACING; x < width - 8; x += DASH_SPACING) {
              const dashX = x - scrollOffset;
              if (dashX < pickupX || dashX > width - 8) continue;
              trackGraphics.rect(dashX - 1, y - 5, 2, 10).fill({ color: TRACK_COLOR, alpha: 0.7 });
            }

            trackGraphics
              .moveTo(pickupX, bounds.top + bounds.height * 0.18)
              .lineTo(pickupX, bounds.top + bounds.height * 0.82)
              .stroke({ width: 3, color: 0xffffff, alpha: 0.35 });
          }

          itemGraphics.clear();
          for (const lane of world.lanes) {
            if (lane.state !== "active" || lane.kind === null) continue;
            const x = laneItemX(lane, width);
            if (x === null) continue;
            const y = rowCenterY(lane.index, height);

            const ratio = lane.duration > 0 ? Math.max(0, lane.timer / lane.duration) : 0;
            const ringColor = ratio < URGENT_THRESHOLD ? URGENT_COLOR : 0xffffff;
            itemGraphics
              .circle(x, y, radius + 7)
              .stroke({ width: 3, color: TRACK_COLOR, alpha: 0.4 });
            if (ratio > 0) {
              const startAngle = -Math.PI / 2;
              const endAngle = startAngle + Math.PI * 2 * ratio;
              itemGraphics
                .moveTo(
                  x + Math.cos(startAngle) * (radius + 7),
                  y + Math.sin(startAngle) * (radius + 7),
                )
                .arc(x, y, radius + 7, startAngle, endAngle)
                .stroke({ width: 3, color: ringColor, alpha: 0.9 });
            }

            drawSushiShape(itemGraphics, lane.kind, x, y, radius);
          }

          for (let i = floatingPopups.length - 1; i >= 0; i--) {
            const entry = floatingPopups[i];
            entry.age += deltaSeconds;
            entry.text.position.y -= deltaSeconds * 24;
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
        onKeyDown: (key) => {
          if (loop.isPaused && key !== " ") return;
          if (key === " ") {
            setIsPaused(loop.togglePause());
            return;
          }
          if (key === "r") {
            world.reset();
            setTarget(world.target);
            setIsOver(false);
            return;
          }
          if (/^[1-3]$/.test(key)) {
            world.attemptGrab(Number(key) - 1);
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
      title="Nigiri Rush"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="nigiri-rush-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="nigiri-rush-canvas" />
        <div className={styles.hud}>
          <span className={styles.lives} data-testid="nigiri-rush-lives" data-lives={lives}>
            ライフ {lives} / {LIVES_MAX}
          </span>
        </div>
        <div className={styles.orderPanel}>
          <span className={styles.orderLabel}>注文</span>
          <span
            className={styles.orderChip}
            data-testid="nigiri-rush-target"
            data-kind={target}
            style={{ backgroundColor: KIND_CSS[target] }}
          >
            {KIND_LABEL[target]}
          </span>
        </div>
        <div className={styles.hint}>
          注文と同じネタが流れてきたレーンをタップして取る。わさびに触れる・違うネタを取る・注文を取り逃すとライフが減る。キーボードは1〜3でレーンを取る。
        </div>
        <div className={styles.lanes} data-testid="nigiri-rush-lanes">
          {laneStatuses.map((lane) => (
            <div key={lane.index} className={styles.laneRow}>
              <button
                type="button"
                className={styles.laneButton}
                data-testid={`nigiri-rush-lane-${lane.index}`}
                data-state={lane.state}
                data-kind={lane.kind ?? ""}
                onClick={() => handleGrab(lane.index)}
                style={
                  lane.state === "active" && lane.kind
                    ? { borderColor: KIND_CSS[lane.kind] }
                    : undefined
                }
              >
                {lane.state === "active" && lane.kind ? KIND_LABEL[lane.kind] : "取る"}
              </button>
            </div>
          ))}
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="nigiri-rush-gameover">
            <div className={styles.gameOverTitle}>営業終了</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="nigiri-rush-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
