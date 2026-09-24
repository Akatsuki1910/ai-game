"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerState } from "@/shared/engine";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import styles from "./EmberWardGame.module.scss";
import { EmberWardWorld, SHRINE_MAX_HP } from "./engine/world";

const EMBER_COLOR = 0xff6b4a;
const EMBER_WARDED_COLOR = 0xffe066;
const WARD_COLOR = 0x6ee7ff;
const SHRINE_SAFE_COLOR = 0x7cf5c4;
const SHRINE_DANGER_COLOR = 0xff6b6b;
const FLASH_COLOR = 0xff3355;
const FLASH_DECAY_PER_SECOND = 1.6;
const FLASH_HIT_ALPHA = 0.4;

const LEFT_KEYS = ["arrowleft", "a"];
const RIGHT_KEYS = ["arrowright", "d"];
const UP_KEYS = ["arrowup", "w"];
const DOWN_KEYS = ["arrowdown", "s"];

interface FloatingPopup {
  text: Text;
  age: number;
}

const POPUP_LIFETIME = 0.9;

function anyKeyDown(input: InputManager, keys: string[]): boolean {
  return keys.some((key) => input.isKeyDown(key));
}

export function EmberWardGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [shrineHp, setShrineHp] = useState(SHRINE_MAX_HP);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<EmberWardWorld | null>(null);
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
    const world = new EmberWardWorld(1, 1);
    worldRef.current = world;

    const shrineGraphics = new Graphics();
    const wardGraphics = new Graphics();
    const emberGraphics = new Graphics();
    const cursorGraphics = new Graphics();
    const flashGraphics = new Graphics();
    const popupContainer = new Container();
    const floatingPopups: FloatingPopup[] = [];
    const activeDrags = new Map<number, PointerState>();
    let flashAlpha = 0;

    world.onEmberWarded = ({ x, y, points, combo: comboAtHit }) => {
      const label = comboAtHit > 1 ? `+${points} COMBO x${comboAtHit}` : `+${points}`;
      const text = new Text({
        text: label,
        style: { fill: 0xffe066, fontSize: 16, fontWeight: "700" },
      });
      text.anchor.set(0.5, 1);
      text.position.set(x, y);
      popupContainer.addChild(text);
      floatingPopups.push({ text, age: 0 });
    };

    world.onShrineHit = ({ x }) => {
      flashAlpha = FLASH_HIT_ALPHA;
      const text = new Text({
        text: "-1",
        style: { fill: 0xff6b6b, fontSize: 20, fontWeight: "800" },
      });
      text.anchor.set(0.5, 1);
      text.position.set(x, world.shrineLineY);
      popupContainer.addChild(text);
      floatingPopups.push({ text, age: 0 });
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x080a12,
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
        shrineGraphics,
        wardGraphics,
        cursorGraphics,
        emberGraphics,
        popupContainer,
        flashGraphics,
      );
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        const dx = (anyKeyDown(input, RIGHT_KEYS) ? 1 : 0) - (anyKeyDown(input, LEFT_KEYS) ? 1 : 0);
        const dy = (anyKeyDown(input, DOWN_KEYS) ? 1 : 0) - (anyKeyDown(input, UP_KEYS) ? 1 : 0);
        if (dx !== 0 || dy !== 0) world.moveKeyboardCursor(dx, dy, deltaSeconds);

        world.step(deltaSeconds);
        setScore(world.score);
        setCombo(world.combo);
        setShrineHp(world.shrineHp);
        if (world.isOver) setIsOver(true);

        const hpRatio = world.shrineHp / SHRINE_MAX_HP;
        const shrineColor = hpRatio > 0.4 ? SHRINE_SAFE_COLOR : SHRINE_DANGER_COLOR;
        shrineGraphics
          .clear()
          .rect(0, world.shrineLineY, world.width, world.height - world.shrineLineY)
          .fill({ color: shrineColor, alpha: 0.08 })
          .moveTo(0, world.shrineLineY)
          .lineTo(world.width, world.shrineLineY)
          .stroke({ width: 2, color: shrineColor, alpha: 0.5 + hpRatio * 0.4 });

        wardGraphics.clear();
        for (const ward of world.wards) {
          const alpha = Math.max(0, 1 - ward.age / ward.ttl);
          wardGraphics
            .moveTo(ward.x1, ward.y1)
            .lineTo(ward.x2, ward.y2)
            .stroke({ width: 6, color: WARD_COLOR, alpha: alpha * 0.35 });
          wardGraphics
            .moveTo(ward.x1, ward.y1)
            .lineTo(ward.x2, ward.y2)
            .stroke({ width: 2.5, color: 0xffffff, alpha: alpha * 0.9 });
        }
        for (const [, pointer] of activeDrags) {
          wardGraphics
            .moveTo(pointer.startX, pointer.startY)
            .lineTo(pointer.x, pointer.y)
            .stroke({ width: 2, color: WARD_COLOR, alpha: 0.5 });
        }

        emberGraphics.clear();
        for (const ember of world.embers) {
          emberGraphics
            .circle(ember.x, ember.y, ember.radius)
            .fill({ color: ember.isWarded ? EMBER_WARDED_COLOR : EMBER_COLOR, alpha: 0.92 })
            .stroke({ width: 1.5, color: 0xffffff, alpha: 0.35 });
        }

        cursorGraphics.clear();
        cursorGraphics
          .circle(world.keyboardCursor.x, world.keyboardCursor.y, 6)
          .stroke({ width: 1.5, color: WARD_COLOR, alpha: 0.35 });

        flashAlpha = Math.max(0, flashAlpha - deltaSeconds * FLASH_DECAY_PER_SECOND);
        flashGraphics.clear();
        if (flashAlpha > 0) {
          flashGraphics.rect(0, 0, world.width, world.height).fill({
            color: FLASH_COLOR,
            alpha: flashAlpha,
          });
        }

        for (let i = floatingPopups.length - 1; i >= 0; i--) {
          const entry = floatingPopups[i];
          entry.age += deltaSeconds;
          entry.text.position.y -= deltaSeconds * 30;
          entry.text.alpha = Math.max(0, 1 - entry.age / POPUP_LIFETIME);
          if (entry.age >= POPUP_LIFETIME) {
            popupContainer.removeChild(entry.text);
            entry.text.destroy();
            floatingPopups.splice(i, 1);
          }
        }
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => {
          activeDrags.set(pointer.id, pointer);
        },
        onPointerMove: (pointer) => {
          if (activeDrags.has(pointer.id)) activeDrags.set(pointer.id, pointer);
        },
        onPointerUp: (pointer) => {
          activeDrags.delete(pointer.id);
          world.addWard(pointer.startX, pointer.startY, pointer.x, pointer.y);
        },
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
          } else if (key === "r") {
            world.reset();
            setIsOver(false);
          } else if (key === "enter") {
            world.placeKeyboardWard();
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

  return (
    <GameShell
      title="Ember Ward"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="ember-ward-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="ember-ward-canvas" />
        <div className={styles.hud}>
          <span className={styles.hp} data-testid="ember-ward-hp">
            社 {shrineHp}/{SHRINE_MAX_HP}
          </span>
          <span className={styles.combo} data-testid="ember-ward-combo">
            COMBO x{combo}
          </span>
        </div>
        <div className={styles.hint}>
          ドラッグで結界の線を描き、降ってくる火の粉を弾き返せ。結界は数秒で消える。社に火の粉が届くとライフが減る。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="ember-ward-gameover">
            <div className={styles.gameOverTitle}>社が焼け落ちた</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="ember-ward-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
