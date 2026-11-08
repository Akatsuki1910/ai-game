"use client";

import { Application, Graphics } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import { HaneRallyWorld, START_LIVES } from "./engine/world";
import styles from "./HaneRallyGame.module.scss";

const PADDLE_KEY_SPEED = 560; // px/s
const GROUND_COLOR = 0xd98c4a;
const SKY_TOP_COLOR = 0xfff3e0;
const PADDLE_FACE_COLOR = 0xd1495b;
const PADDLE_RIM_COLOR = 0xf4c95d;
const PADDLE_HANDLE_COLOR = 0x5a3b28;
const SHUTTLE_CORK_COLOR = 0x5a3b28;
const SHUTTLE_FEATHER_COLOR = 0xfdf6ec;

export function HaneRallyGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const [score, setScore] = useState(0);
  const [rally, setRally] = useState(0);
  const [bestRally, setBestRally] = useState(0);
  const [lives, setLives] = useState(START_LIVES);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<HaneRallyWorld | null>(null);
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
    setScore(0);
    setRally(0);
    setBestRally(0);
    setLives(START_LIVES);
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
    const world = new HaneRallyWorld(1, 1);
    worldRef.current = world;

    const groundGraphics = new Graphics();
    const paddleGraphics = new Graphics();
    const shuttleGraphics = new Graphics();
    let drawnGroundWidth = -1;
    let drawnGroundHeight = -1;

    world.onHit = ({ rally: currentRally, isNewBest }) => {
      setRally(currentRally);
      if (isNewBest) setBestRally(currentRally);
    };
    world.onMiss = ({ livesRemaining }) => {
      setRally(0);
      setLives(livesRemaining);
    };

    (async () => {
      await app.init({
        resizeTo: host,
        backgroundColor: SKY_TOP_COLOR,
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
      app.stage.addChild(groundGraphics, paddleGraphics, shuttleGraphics);
      appRef.current = app;

      const input = new InputManager(app.canvas);
      inputRef.current = input;

      const loop = new GameLoop((deltaSeconds) => {
        let dx = 0;
        let dy = 0;
        if (input.isKeyDown("arrowleft") || input.isKeyDown("a")) dx -= 1;
        if (input.isKeyDown("arrowright") || input.isKeyDown("d")) dx += 1;
        if (input.isKeyDown("arrowup") || input.isKeyDown("w")) dy -= 1;
        if (input.isKeyDown("arrowdown") || input.isKeyDown("s")) dy += 1;
        if (dx !== 0 || dy !== 0) {
          world.movePaddleBy(
            dx * PADDLE_KEY_SPEED * deltaSeconds,
            dy * PADDLE_KEY_SPEED * deltaSeconds,
          );
        }

        world.step(deltaSeconds);
        setScore(world.score);
        if (world.isOver) setIsOver(true);

        if (drawnGroundWidth !== world.width || drawnGroundHeight !== world.height) {
          drawnGroundWidth = world.width;
          drawnGroundHeight = world.height;
          const groundTop = world.height * 0.9;
          groundGraphics
            .clear()
            .rect(0, groundTop, world.width, world.height - groundTop)
            .fill({ color: GROUND_COLOR, alpha: 0.55 });
        }

        const { paddle } = world;
        paddleGraphics.clear();
        paddleGraphics
          .moveTo(paddle.x, paddle.y + paddle.radius * 0.1)
          .lineTo(paddle.x + paddle.radius * 0.5, paddle.y + paddle.radius * 1.9)
          .stroke({ width: 8, color: PADDLE_HANDLE_COLOR });
        paddleGraphics
          .ellipse(paddle.x, paddle.y, paddle.radius, paddle.radius * 0.78)
          .fill({ color: PADDLE_FACE_COLOR })
          .stroke({ width: 4, color: PADDLE_RIM_COLOR });

        const { shuttle } = world;
        shuttleGraphics.clear();
        const featherCount = 6;
        for (let i = 0; i < featherCount; i++) {
          const angle = (i / featherCount) * Math.PI * 2;
          const tipX = shuttle.x + Math.cos(angle) * shuttle.radius * 1.8;
          const tipY = shuttle.y - shuttle.radius * 0.6 + Math.sin(angle) * shuttle.radius * 1.8;
          shuttleGraphics
            .moveTo(shuttle.x, shuttle.y - shuttle.radius * 0.3)
            .lineTo(tipX, tipY)
            .stroke({ width: 2, color: SHUTTLE_FEATHER_COLOR, alpha: 0.9 });
        }
        shuttleGraphics
          .circle(shuttle.x, shuttle.y, shuttle.radius * 0.55)
          .fill({ color: SHUTTLE_CORK_COLOR });
      }, 0.1);

      input.addListener({
        onPointerDown: (pointer) => {
          world.setPaddlePosition(pointer.x, pointer.y);
        },
        onPointerMove: (pointer) => {
          world.setPaddlePosition(pointer.x, pointer.y);
        },
        onKeyDown: (key) => {
          if (key === " ") {
            setIsPaused(loop.togglePause());
          } else if (key === "r") {
            world.reset();
            setIsOver(false);
            setScore(0);
            setRally(0);
            setBestRally(0);
            setLives(START_LIVES);
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
      title="Hane Rally"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="hane-rally-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="hane-rally-canvas" />
        <div className={styles.hud}>
          <span className={styles.lives} data-testid="hane-rally-lives">
            {"♥".repeat(lives)}
            {"♡".repeat(Math.max(0, START_LIVES - lives))}
          </span>
          <span className={styles.rally} data-testid="hane-rally-rally">
            RALLY {rally}
          </span>
          <span className={styles.best} data-testid="hane-rally-best">
            BEST {bestRally}
          </span>
        </div>
        <div className={styles.hint}>
          ドラッグ/スワイプで羽子板を動かし、落ちてくる羽根を打ち返そう。打ち返すほど風が強まる。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="hane-rally-gameover">
            <div className={styles.gameOverTitle}>ラリー終了</div>
            <div className={styles.gameOverScore}>打ち返し数 {score.toLocaleString("ja-JP")}</div>
            <div className={styles.gameOverBest}>
              ベストラリー {bestRally.toLocaleString("ja-JP")}
            </div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="hane-rally-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
