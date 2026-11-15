"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import {
  type BonusEvent,
  type FlickTier,
  LANE_HALF_WIDTH,
  type SkipEvent,
  SkippingStonesWorld,
  type ThrowEndedEvent,
  TOTAL_STONES,
} from "./engine/world";
import styles from "./SkippingStonesGame.module.scss";

interface Popup {
  id: number;
  text: string;
  kind: "skip" | "bonus";
}

let nextPopupId = 1;
const WATER_COLOR = 0x0e2a3a;
const MAX_VISIBLE_DEPTH = 40;

function flickLabel(tier: FlickTier): string {
  if (tier === "perfect") return "PERFECT FLICK!";
  if (tier === "ok") return "GOOD";
  return "";
}

export function SkippingStonesGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const canvasHostRef = useRef<HTMLDivElement | null>(null);

  const worldRef = useRef<SkippingStonesWorld | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);

  const [score, setScore] = useState(0);
  const [stonesRemaining, setStonesRemaining] = useState(TOTAL_STONES);
  const [skipCount, setSkipCount] = useState(0);
  const [phase, setPhase] = useState<"aiming" | "flying">("aiming");
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);
  const [popups, setPopups] = useState<Popup[]>([]);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;

    const world = new SkippingStonesWorld(1, 1);
    worldRef.current = world;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x061018);
    scene.fog = new THREE.Fog(0x061018, 24, MAX_VISIBLE_DEPTH + 10);

    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
    camera.position.set(0, 4.2, -8.5);
    camera.lookAt(0, 1, 18);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    host.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    scene.add(new THREE.AmbientLight(0x6a8aa0, 0.65));
    const moonLight = new THREE.DirectionalLight(0xdfefff, 1.0);
    moonLight.position.set(-20, 30, -10);
    scene.add(moonLight);

    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(LANE_HALF_WIDTH * 2 + 6, MAX_VISIBLE_DEPTH + 10, 1, 1),
      new THREE.MeshStandardMaterial({
        color: WATER_COLOR,
        roughness: 0.25,
        metalness: 0.35,
      }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, 0, MAX_VISIBLE_DEPTH / 2 - 2);
    scene.add(water);

    const shore = new THREE.Mesh(
      new THREE.CircleGeometry(3.2, 24),
      new THREE.MeshStandardMaterial({ color: 0x3a3226, roughness: 0.9 }),
    );
    shore.rotation.x = -Math.PI / 2;
    shore.position.set(0, 0.01, -2.4);
    scene.add(shore);

    const stoneMesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.42, 0),
      new THREE.MeshStandardMaterial({ color: 0x8a8f99, flatShading: true, roughness: 0.6 }),
    );
    stoneMesh.scale.y = 0.55;
    scene.add(stoneMesh);

    const aimIndicator = new THREE.Mesh(
      new THREE.ConeGeometry(0.18, 1, 8),
      new THREE.MeshBasicMaterial({ color: 0x6ee7ff, transparent: true, opacity: 0.8 }),
    );
    aimIndicator.rotation.x = Math.PI / 2;
    scene.add(aimIndicator);

    const MAX_HAZARD_MESHES = 3;
    const hazardMeshes = Array.from({ length: MAX_HAZARD_MESHES }, () => {
      const mesh = new THREE.Mesh(
        new THREE.CircleGeometry(1, 16),
        new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.9 }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      scene.add(mesh);
      return mesh;
    });

    const MAX_BONUS_MESHES = 2;
    const bonusMeshes = Array.from({ length: MAX_BONUS_MESHES }, () => {
      const mesh = new THREE.Mesh(
        new THREE.CircleGeometry(1, 20),
        new THREE.MeshStandardMaterial({
          color: 0x7cf5c4,
          emissive: 0x2f9e78,
          emissiveIntensity: 0.6,
          roughness: 0.4,
        }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      scene.add(mesh);
      return mesh;
    });

    world.onSkip = (event: SkipEvent) => {
      const text = event.flickTier === "none" ? `+${event.points}` : flickLabel(event.flickTier);
      setPopups((prev) => [...prev, { id: nextPopupId++, text, kind: "skip" }]);
    };
    world.onBonus = (event: BonusEvent) => {
      setPopups((prev) => [
        ...prev,
        { id: nextPopupId++, text: `BONUS +${event.points}`, kind: "bonus" },
      ]);
    };
    world.onThrowEnded = (event: ThrowEndedEvent) => {
      setIsOver(event.isGameOver);
    };

    const input = new InputManager(renderer.domElement);
    inputRef.current = input;

    const toLateralUnits = (pixelX: number): number => {
      const ratio = world.width > 0 ? pixelX / world.width - 0.5 : 0;
      return ratio * LANE_HALF_WIDTH * 2;
    };

    input.addListener({
      onPointerDown: () => {
        if (world.phase === "flying") world.requestFlick();
      },
      onPointerMove: (pointer) => {
        if (world.phase === "aiming") {
          world.setAimFromDrag(pointer.x - pointer.startX, pointer.y - pointer.startY);
        } else if (world.phase === "flying") {
          world.setSteerTarget(toLateralUnits(pointer.x));
        }
      },
      onPointerUp: () => {
        if (world.phase === "aiming") {
          world.releaseThrow();
        } else {
          world.setSteerTarget(null);
        }
      },
      onKeyDown: (key) => {
        if (key === " ") {
          setIsPaused(loop.togglePause());
        } else if (key === "r") {
          world.reset();
          setIsOver(false);
        } else if (key === "enter") {
          if (world.phase === "aiming") world.releaseThrow();
          else world.requestFlick();
        }
      },
    });

    const loop = new GameLoop((deltaSeconds, elapsedSeconds) => {
      if (world.phase === "aiming") {
        const left = input.isKeyDown("arrowleft") || input.isKeyDown("a");
        const right = input.isKeyDown("arrowright") || input.isKeyDown("d");
        const up = input.isKeyDown("arrowup") || input.isKeyDown("w");
        const down = input.isKeyDown("arrowdown") || input.isKeyDown("s");
        if (left) world.adjustAimLateral(-deltaSeconds * 1.2);
        if (right) world.adjustAimLateral(deltaSeconds * 1.2);
        if (up) world.adjustPower(deltaSeconds * 0.6);
        if (down) world.adjustPower(-deltaSeconds * 0.6);
        world.setSteeringInput(0);
      } else {
        const left = input.isKeyDown("arrowleft") || input.isKeyDown("a");
        const right = input.isKeyDown("arrowright") || input.isKeyDown("d");
        world.setSteeringInput(right ? 1 : left ? -1 : 0);
      }

      world.step(deltaSeconds);

      setScore(Math.floor(world.score));
      setStonesRemaining(world.stonesRemaining);
      setSkipCount(world.skipCount);
      setPhase(world.phase);

      stoneMesh.position.set(world.x, 0.4 + world.airHeight, world.z);
      stoneMesh.rotation.z += deltaSeconds * (world.phase === "flying" ? 10 : 1.5);
      stoneMesh.rotation.x += deltaSeconds * 0.8;

      aimIndicator.visible = world.phase === "aiming" && !world.isOver;
      if (aimIndicator.visible) {
        const length = 1.4 + world.aimPower * 3.5;
        aimIndicator.scale.set(1, length, 1);
        aimIndicator.position.set(world.x, 0.5, length / 2);
        aimIndicator.rotation.y = -world.aimLateral * 0.5;
      }

      world.hazards.forEach((hazard, index) => {
        const mesh = hazardMeshes[index];
        if (!mesh) return;
        mesh.visible = true;
        mesh.scale.setScalar(hazard.radius);
        mesh.position.set(hazard.x, 0.03, (hazard.zStart + hazard.zEnd) / 2);
      });
      for (let i = world.hazards.length; i < hazardMeshes.length; i++) {
        hazardMeshes[i].visible = false;
      }

      world.bonusPads.forEach((pad, index) => {
        const mesh = bonusMeshes[index];
        if (!mesh) return;
        mesh.visible = true;
        mesh.scale.setScalar(pad.radius * (1 + Math.sin(elapsedSeconds * 4) * 0.08));
        mesh.position.set(pad.x, 0.04, (pad.zStart + pad.zEnd) / 2);
      });
      for (let i = world.bonusPads.length; i < bonusMeshes.length; i++) {
        bonusMeshes[i].visible = false;
      }

      renderer.render(scene, camera);
    }, 0.1);

    loopRef.current = loop;
    loop.start();

    return () => {
      loopRef.current?.stop();
      loopRef.current = null;
      inputRef.current?.dispose();
      inputRef.current = null;
      for (const mesh of [water, shore, stoneMesh, aimIndicator, ...hazardMeshes, ...bonusMeshes]) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
      renderer.dispose();
      if (host.contains(renderer.domElement)) host.removeChild(renderer.domElement);
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (size.width === 0 || size.height === 0) return;
    worldRef.current?.resize(size.width, size.height);
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (!renderer || !camera) return;

    renderer.setSize(size.width, size.height, false);
    camera.aspect = size.width / size.height;
    camera.fov = size.width < size.height ? 70 : 55;
    camera.updateProjectionMatrix();
  }, [size.width, size.height]);

  const handleTogglePause = () => {
    if (!loopRef.current) return;
    setIsPaused(loopRef.current.togglePause());
  };

  const handleRestart = () => {
    worldRef.current?.reset();
    setIsOver(false);
    if (loopRef.current?.isPaused) {
      loopRef.current.resume();
      setIsPaused(false);
    }
  };

  return (
    <GameShell
      title="Skipping Stones"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner}>
        <div ref={canvasHostRef} className={styles.canvasHost} />
        <div className={styles.popupStack}>
          {popups.map((popup) => (
            <span
              key={popup.id}
              className={popup.kind === "bonus" ? styles.popupBonus : styles.popupSkip}
              onAnimationEnd={() =>
                setPopups((prev) => prev.filter((entry) => entry.id !== popup.id))
              }
            >
              {popup.text}
            </span>
          ))}
        </div>
        <div className={styles.hud}>
          <span className={styles.stones} data-testid="skipping-stones-stones">
            {"🪨".repeat(stonesRemaining)} {stonesRemaining}
          </span>
          <span className={styles.status} data-testid="skipping-stones-status">
            {phase === "aiming" ? "ねらう" : "飛行中"}
          </span>
          {skipCount > 0 && (
            <span className={styles.combo} data-testid="skipping-stones-skip-count">
              スキップ {skipCount}
            </span>
          )}
        </div>
        <div className={styles.hint}>
          手前へドラッグして引き、離すと石を投げる。飛んでいる間はドラッグで左右に逸らして浮き草や岩を避けつつ、着水の瞬間にタップすると「はじき」が決まり跳ねが伸びる。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="skipping-stones-gameover">
            <div className={styles.gameOverTitle}>石を使い切った</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="skipping-stones-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
