"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import {
  type Obstacle,
  type ObstacleResolvedEvent,
  type PatchCollectedEvent,
  PowderRushWorld,
} from "./engine/world";
import styles from "./PowderRushGame.module.scss";

interface Popup {
  id: number;
  leftPercent: number;
  text: string;
  kind: "grow" | "crush" | "hit";
}

let nextPopupId = 1;

// このゲームの座標系は他の2D/3Dゲーム同様、画面の実ピクセルサイズ(width/height)を
// そのままシーンの単位として使う。ボール半径も16〜46という「ピクセル相当」のスケールなので、
// カメラのオフセットもそれに見合う大きさにしないと、カメラがボールにめり込んで何も映らなくなる。
const CAMERA_HEIGHT_ABOVE_BALL = 140;
const CAMERA_BACK_DISTANCE = 220;
const CAMERA_LOOK_AHEAD = 420;
const GROUND_SIZE = 6000;
const GRID_SPACING = 150;
const ROCK_COLOR = 0x7d8794;
const TREE_TRUNK_COLOR = 0x5b3a24;
const TREE_LEAF_COLOR = 0x2f6b4a;
const PATCH_COLOR = 0xdff6ff;

function createPatchMesh(radius: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 24),
    new THREE.MeshStandardMaterial({
      color: PATCH_COLOR,
      emissive: PATCH_COLOR,
      emissiveIntensity: 0.35,
      roughness: 0.5,
      transparent: true,
      opacity: 0.85,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

function createObstacleMesh(obstacle: Obstacle): THREE.Object3D {
  if (obstacle.kind === "rock") {
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(obstacle.radius, 0),
      new THREE.MeshStandardMaterial({ color: ROCK_COLOR, roughness: 0.9, flatShading: true }),
    );
    return mesh;
  }

  const group = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(obstacle.radius * 0.18, obstacle.radius * 0.22, obstacle.radius, 8),
    new THREE.MeshStandardMaterial({ color: TREE_TRUNK_COLOR, roughness: 0.9 }),
  );
  trunk.position.y = obstacle.radius / 2;
  const leaves = new THREE.Mesh(
    new THREE.ConeGeometry(obstacle.radius * 0.9, obstacle.radius * 1.7, 9),
    new THREE.MeshStandardMaterial({ color: TREE_LEAF_COLOR, roughness: 0.85, flatShading: true }),
  );
  leaves.position.y = obstacle.radius * 1.35;
  group.add(trunk, leaves);
  return group;
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      const material = child.material;
      if (Array.isArray(material)) {
        for (const m of material) m.dispose();
      } else {
        material.dispose();
      }
    }
  });
}

export function PowderRushGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const canvasHostRef = useRef<HTMLDivElement | null>(null);

  const worldRef = useRef<PowderRushWorld | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);

  const [score, setScore] = useState(0);
  const [distance, setDistance] = useState(0);
  const [ballRadius, setBallRadius] = useState(0);
  const [combo, setCombo] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);
  const [popups, setPopups] = useState<Popup[]>([]);

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

    const world = new PowderRushWorld(1, 1);
    worldRef.current = world;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xbfe3f2);
    scene.fog = new THREE.Fog(0xbfe3f2, 400, 2200);

    const camera = new THREE.PerspectiveCamera(55, 1, 1, 4000);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    host.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.1);
    sun.position.set(300, 500, 200);
    scene.add(sun);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
      new THREE.MeshStandardMaterial({ color: 0xf4fbff, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    const grid = new THREE.GridHelper(GROUND_SIZE, GROUND_SIZE / GRID_SPACING, 0xaad4e6, 0xaad4e6);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.5;
    scene.add(grid);

    const ballMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 18),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.05 }),
    );
    scene.add(ballMesh);

    const patchMeshes = new Map<number, THREE.Mesh>();
    const obstacleMeshes = new Map<number, THREE.Object3D>();

    const toLeftPercent = (x: number): number => (world.width > 0 ? (x / world.width) * 100 : 50);

    world.onPatchCollected = (event: PatchCollectedEvent) => {
      setPopups((prev) => [
        ...prev,
        {
          id: nextPopupId++,
          leftPercent: toLeftPercent(event.x),
          text: `+${event.points}`,
          kind: "grow",
        },
      ]);
    };
    world.onObstacleResolved = (event: ObstacleResolvedEvent) => {
      setPopups((prev) => [
        ...prev,
        event.outcome === "crushed"
          ? {
              id: nextPopupId++,
              leftPercent: toLeftPercent(event.x),
              text: `CRUSH +${event.points}`,
              kind: "crush",
            }
          : {
              id: nextPopupId++,
              leftPercent: toLeftPercent(event.x),
              text: "HIT!",
              kind: "hit",
            },
      ]);
    };
    world.onMelted = () => setIsOver(true);

    const input = new InputManager(renderer.domElement);
    inputRef.current = input;
    input.addListener({
      onPointerUp: () => world.setPointerTarget(null),
      onKeyDown: (key) => {
        if (key === " ") {
          setIsPaused(loop.togglePause());
        } else if (key === "r") {
          world.reset();
          setIsOver(false);
        }
      },
    });

    let previousBallX = world.ballX;

    const loop = new GameLoop((deltaSeconds) => {
      const pointer = input.getPrimaryPointer();
      if (pointer) {
        world.setPointerTarget(pointer.x);
      } else if (input.isKeyDown("arrowleft") || input.isKeyDown("a")) {
        world.setSteeringInput(-1);
      } else if (input.isKeyDown("arrowright") || input.isKeyDown("d")) {
        world.setSteeringInput(1);
      } else {
        world.setSteeringInput(0);
      }

      world.step(deltaSeconds);

      setScore(world.score);
      setDistance(Math.floor(world.distanceTraveled));
      setBallRadius(world.ballRadius);
      setCombo(world.combo);

      const halfWidth = world.width / 2;

      const currentPatchIds = new Set(world.patches.map((p) => p.id));
      for (const [id, mesh] of patchMeshes) {
        if (!currentPatchIds.has(id)) {
          scene.remove(mesh);
          disposeObject(mesh);
          patchMeshes.delete(id);
        }
      }
      for (const patch of world.patches) {
        let mesh = patchMeshes.get(patch.id);
        if (!mesh) {
          mesh = createPatchMesh(patch.radius);
          scene.add(mesh);
          patchMeshes.set(patch.id, mesh);
        }
        mesh.position.set(patch.x - halfWidth, 0.05, -(patch.z - world.distanceTraveled));
      }

      const currentObstacleIds = new Set(world.obstacles.map((o) => o.id));
      for (const [id, mesh] of obstacleMeshes) {
        if (!currentObstacleIds.has(id)) {
          scene.remove(mesh);
          disposeObject(mesh);
          obstacleMeshes.delete(id);
        }
      }
      for (const obstacle of world.obstacles) {
        let mesh = obstacleMeshes.get(obstacle.id);
        if (!mesh) {
          mesh = createObstacleMesh(obstacle);
          scene.add(mesh);
          obstacleMeshes.set(obstacle.id, mesh);
        }
        const groundY = obstacle.kind === "rock" ? obstacle.radius * 0.6 : 0;
        mesh.position.set(obstacle.x - halfWidth, groundY, -(obstacle.z - world.distanceTraveled));
      }

      const ballWorldX = world.ballX - halfWidth;
      const deltaX = world.ballX - previousBallX;
      previousBallX = world.ballX;
      const traveled = world.speed * deltaSeconds;
      ballMesh.scale.setScalar(world.ballRadius);
      ballMesh.position.set(ballWorldX, world.ballRadius, 0);
      ballMesh.rotation.x -= traveled / Math.max(world.ballRadius, 1);
      ballMesh.rotation.z -= deltaX / Math.max(world.ballRadius, 1);

      grid.position.z = -(world.distanceTraveled % GRID_SPACING);

      camera.position.set(
        ballWorldX,
        world.ballRadius + CAMERA_HEIGHT_ABOVE_BALL,
        CAMERA_BACK_DISTANCE,
      );
      camera.lookAt(ballWorldX, world.ballRadius * 0.5, -CAMERA_LOOK_AHEAD);

      renderer.render(scene, camera);
    }, 0.1);

    loopRef.current = loop;
    loop.start();

    return () => {
      loopRef.current?.stop();
      loopRef.current = null;
      inputRef.current?.dispose();
      inputRef.current = null;
      for (const mesh of patchMeshes.values()) disposeObject(mesh);
      for (const mesh of obstacleMeshes.values()) disposeObject(mesh);
      disposeObject(ballMesh);
      disposeObject(ground);
      disposeObject(grid);
      renderer.dispose();
      if (host.contains(renderer.domElement)) host.removeChild(renderer.domElement);
    };
  }, []);

  useEffect(() => {
    if (size.width === 0 || size.height === 0) return;
    worldRef.current?.resize(size.width, size.height);
  }, [size.width, size.height]);

  return (
    <GameShell
      title="Powder Rush"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
      pauseHint="タップ / Space キーで再開"
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="powder-rush-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="powder-rush-canvas" />
        {popups.map((popup) => (
          <span
            key={popup.id}
            className={
              popup.kind === "hit"
                ? styles.popupHit
                : popup.kind === "crush"
                  ? styles.popupCrush
                  : styles.popupGrow
            }
            style={{ left: `${popup.leftPercent}%` }}
            onAnimationEnd={() =>
              setPopups((prev) => prev.filter((entry) => entry.id !== popup.id))
            }
          >
            {popup.text}
          </span>
        ))}
        <div className={styles.hud}>
          <span className={styles.distance} data-testid="powder-rush-distance">
            {distance}m
          </span>
          <span className={styles.size} data-testid="powder-rush-size">
            SIZE {ballRadius.toFixed(0)}
          </span>
          {combo >= 2 && (
            <span className={styles.combo} data-testid="powder-rush-combo">
              COMBO {combo}
            </span>
          )}
        </div>
        <div className={styles.hint}>
          ドラッグ/クリックした位置へスノーボールを動かして雪だまり(白)を巻き込み大きく育てよう。
          何もしなくても陽射しで少しずつ縮んでいく。岩は自分より十分大きければ押しつぶせるが、
          木には必ずぶつかると縮む。縮みきると終了。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="powder-rush-gameover">
            <div className={styles.gameOverTitle}>とけてしまった…</div>
            <div className={styles.gameOverScore}>
              SCORE {Math.floor(score).toLocaleString("ja-JP")}
            </div>
            <div className={styles.gameOverSub}>走行距離 {distance}m</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="powder-rush-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
