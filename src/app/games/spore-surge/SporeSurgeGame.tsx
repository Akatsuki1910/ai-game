"use client";

import { Application, Graphics } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import { SporeSurgeWorld, type UpgradeId, type UpgradeOption } from "./engine/world";
import styles from "./SporeSurgeGame.module.scss";

export function SporeSurgeGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [level, setLevel] = useState(1);
  const [kills, setKills] = useState(0);
  const [hp, setHp] = useState(100);
  const [maxHp, setMaxHp] = useState(100);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);
  const [isChoosingUpgrade, setIsChoosingUpgrade] = useState(false);
  const [upgradeOptions, setUpgradeOptions] = useState<readonly UpgradeOption[]>([]);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<SporeSurgeWorld | null>(null);
  const appRef = useRef<Application | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const isChoosingUpgradeRef = useRef(false);
  const upgradeOptionsRef = useRef<readonly UpgradeOption[]>([]);
  const isPointerActiveRef = useRef(false);

  const handleTogglePause = useCallback(() => {
    if (!loopRef.current) return;
    setIsPaused(loopRef.current.togglePause());
  }, []);

  const handleRestart = useCallback(() => {
    worldRef.current?.reset();
    isChoosingUpgradeRef.current = false;
    upgradeOptionsRef.current = [];
    setIsOver(false);
    setIsChoosingUpgrade(false);
    setUpgradeOptions([]);
    if (loopRef.current?.isPaused) {
      loopRef.current.resume();
      setIsPaused(false);
    }
  }, []);

  const handleChooseUpgrade = useCallback((id: UpgradeId) => {
    worldRef.current?.chooseUpgrade(id);
    isChoosingUpgradeRef.current = false;
    upgradeOptionsRef.current = [];
    setIsChoosingUpgrade(false);
    setUpgradeOptions([]);
  }, []);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    let disposed = false;

    const app = new Application();
    const world = new SporeSurgeWorld(1, 1);
    worldRef.current = world;

    world.onLevelUp = ({ options }) => {
      isChoosingUpgradeRef.current = true;
      upgradeOptionsRef.current = options;
      setIsChoosingUpgrade(true);
      setUpgradeOptions(options);
    };

    const backgroundGraphics = new Graphics();
    const pollenGraphics = new Graphics();
    const enemyGraphics = new Graphics();
    const projectileGraphics = new Graphics();
    const playerGraphics = new Graphics();
    let drawnBackgroundWidth = -1;
    let drawnBackgroundHeight = -1;

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: 0x060a07,
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
        backgroundGraphics,
        pollenGraphics,
        enemyGraphics,
        projectileGraphics,
        playerGraphics,
      );
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        const left = input.isKeyDown("arrowleft") || input.isKeyDown("a");
        const right = input.isKeyDown("arrowright") || input.isKeyDown("d");
        const up = input.isKeyDown("arrowup") || input.isKeyDown("w");
        const down = input.isKeyDown("arrowdown") || input.isKeyDown("s");
        world.setKeyboardDirection((right ? 1 : 0) - (left ? 1 : 0), (down ? 1 : 0) - (up ? 1 : 0));

        world.step(deltaSeconds);

        setScore(world.score);
        setLevel(world.level);
        setKills(world.kills);
        setHp(Math.ceil(world.player.hp));
        setMaxHp(world.player.maxHp);
        if (world.isOver) setIsOver(true);

        if (drawnBackgroundWidth !== world.width || drawnBackgroundHeight !== world.height) {
          drawnBackgroundWidth = world.width;
          drawnBackgroundHeight = world.height;
          backgroundGraphics
            .clear()
            .rect(0, 0, world.width, world.height)
            .fill({ color: 0x0b1f12 });
        }

        enemyGraphics.clear();
        for (const enemy of world.enemies) {
          enemyGraphics
            .circle(enemy.x, enemy.y, enemy.radius)
            .fill({ color: 0x7c3aed, alpha: 0.9 })
            .stroke({ width: 2, color: 0xffffff, alpha: 0.25 });
        }

        projectileGraphics.clear();
        for (const projectile of world.projectiles) {
          projectileGraphics
            .circle(projectile.x, projectile.y, projectile.radius)
            .fill({ color: 0xa7f3d0, alpha: 0.95 });
        }

        pollenGraphics.clear();
        for (const pollen of world.pollens) {
          pollenGraphics
            .circle(pollen.x, pollen.y, pollen.radius)
            .fill({ color: 0xffe066, alpha: 0.9 });
        }

        playerGraphics.clear();
        playerGraphics
          .circle(world.player.x, world.player.y, world.player.radius + 6)
          .stroke({ width: 2, color: 0x6ee7ff, alpha: 0.5 });
        playerGraphics
          .circle(world.player.x, world.player.y, world.player.radius)
          .fill({ color: 0x6ee7ff, alpha: 0.95 });
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => {
          isPointerActiveRef.current = true;
          world.setMoveTarget(pointer.x, pointer.y);
        },
        onPointerMove: (pointer) => {
          if (isPointerActiveRef.current) world.setMoveTarget(pointer.x, pointer.y);
        },
        onPointerUp: () => {
          isPointerActiveRef.current = false;
          world.clearMoveTarget();
        },
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
            return;
          }
          if (key === "r") {
            world.reset();
            isChoosingUpgradeRef.current = false;
            upgradeOptionsRef.current = [];
            setIsOver(false);
            setIsChoosingUpgrade(false);
            setUpgradeOptions([]);
            return;
          }
          if (!isChoosingUpgradeRef.current) return;
          const index = key === "1" ? 0 : key === "2" ? 1 : key === "3" ? 2 : -1;
          if (index < 0) return;
          const option = upgradeOptionsRef.current[index];
          if (!option) return;
          world.chooseUpgrade(option.id);
          isChoosingUpgradeRef.current = false;
          upgradeOptionsRef.current = [];
          setIsChoosingUpgrade(false);
          setUpgradeOptions([]);
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

  const hpRatio = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;

  return (
    <GameShell
      title="Spore Surge"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="spore-surge-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="spore-surge-canvas" />
        <div className={styles.hud}>
          <div className={styles.statRow} data-testid="spore-surge-hp">
            HP {hp}/{maxHp}
          </div>
          <div className={styles.hpBarTrack}>
            <div className={styles.hpBarFill} style={{ width: `${hpRatio * 100}%` }} />
          </div>
          <div className={styles.statRow} data-testid="spore-surge-level">
            LV {level}
          </div>
          <div className={styles.statRow} data-testid="spore-surge-kills">
            撃破 {kills}
          </div>
        </div>
        <div className={styles.hint}>
          ドラッグ/長押しした位置へ移動。攻撃は自動で最も近い影ダニへ飛ぶ。花粉を集めてレベルアップしたら強化を1つ選んで生き延びろ。
        </div>
        {isChoosingUpgrade && (
          <div className={styles.upgradeOverlay} data-testid="spore-surge-upgrade-overlay">
            <div className={styles.upgradeTitle}>レベルアップ！強化を1つ選べ</div>
            <div className={styles.upgradeGrid}>
              {upgradeOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={styles.upgradeCard}
                  onClick={() => handleChooseUpgrade(option.id)}
                  data-testid={`spore-surge-upgrade-option-${option.id}`}
                >
                  <span className={styles.upgradeCardLabel}>{option.label}</span>
                  <span className={styles.upgradeCardDesc}>{option.description}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {isOver && (
          <div className={styles.gameOver} data-testid="spore-surge-gameover">
            <div className={styles.gameOverTitle}>力尽きた…</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="spore-surge-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
