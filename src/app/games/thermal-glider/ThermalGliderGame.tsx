"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import { type BirdHitEvent, type ThermalCaughtEvent, ThermalGliderWorld } from "./engine/world";
import styles from "./ThermalGliderGame.module.scss";

interface Popup {
  id: number;
  leftPercent: number;
  text: string;
  kind: "lift" | "hit";
}

let nextPopupId = 1;

// 高度(altitude)はワールド側で 0〜100 の抽象値として持ち、そのままシーンのY座標に使う。
// 横方向(x)は他のゲーム同様、ステージの実ピクセルサイズをそのままシーン単位に使う。
const ALTITUDE_MAX = 100;
const CAMERA_HEIGHT_ABOVE_GLIDER = 34;
const CAMERA_BACK_DISTANCE = 150;
const CAMERA_LOOK_AHEAD = 320;
const GROUND_SIZE = 6000;
const GRID_SPACING = 150;
const THERMAL_RADIUS = 70;
const GLIDER_LENGTH = 16;

function createGliderMesh(): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.ConeGeometry(GLIDER_LENGTH * 0.55, GLIDER_LENGTH * 1.6, 3),
    new THREE.MeshStandardMaterial({ color: 0xfdf6e8, roughness: 0.6, flatShading: true }),
  );
  // ConeGeometryは+Yを向くため、機首が進行方向(-Z)を向くようX軸で90度倒す。
  mesh.rotation.x = Math.PI / 2;
  return mesh;
}

function createThermalMesh(): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(THERMAL_RADIUS, THERMAL_RADIUS * 0.7, ALTITUDE_MAX, 20, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffb454,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  mesh.position.y = ALTITUDE_MAX / 2;
  return mesh;
}

function createBirdMesh(): THREE.Group {
  const group = new THREE.Group();
  const wingMaterial = new THREE.MeshStandardMaterial({
    color: 0x36404a,
    roughness: 0.8,
    flatShading: true,
  });
  const wingGeometry = new THREE.BoxGeometry(10, 0.6, 3.2);
  const leftWing = new THREE.Mesh(wingGeometry, wingMaterial);
  leftWing.position.set(-5, 0, 0);
  leftWing.name = "leftWing";
  const rightWing = new THREE.Mesh(wingGeometry, wingMaterial);
  rightWing.position.set(5, 0, 0);
  rightWing.name = "rightWing";
  const body = new THREE.Mesh(
    new THREE.ConeGeometry(1.4, 6, 6),
    new THREE.MeshStandardMaterial({ color: 0x263038, roughness: 0.8, flatShading: true }),
  );
  body.rotation.x = Math.PI / 2;
  group.add(leftWing, rightWing, body);
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

export function ThermalGliderGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const canvasHostRef = useRef<HTMLDivElement | null>(null);

  const worldRef = useRef<ThermalGliderWorld | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);

  const [score, setScore] = useState(0);
  const [distance, setDistance] = useState(0);
  const [altitude, setAltitude] = useState(0);
  const [streak, setStreak] = useState(0);
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

    const world = new ThermalGliderWorld(1, 1);
    worldRef.current = world;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x9fd4ee);
    scene.fog = new THREE.Fog(0x9fd4ee, 400, 2200);

    const camera = new THREE.PerspectiveCamera(55, 1, 1, 4000);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    host.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.05);
    sun.position.set(300, 500, 200);
    scene.add(sun);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
      new THREE.MeshStandardMaterial({ color: 0xcdeadb, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    const grid = new THREE.GridHelper(GROUND_SIZE, GROUND_SIZE / GRID_SPACING, 0x9fcbb0, 0x9fcbb0);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.45;
    scene.add(grid);

    const gliderMesh = createGliderMesh();
    scene.add(gliderMesh);

    const thermalMeshes = new Map<number, THREE.Mesh>();
    const birdMeshes = new Map<number, THREE.Group>();

    const toLeftPercent = (x: number): number => (world.width > 0 ? (x / world.width) * 100 : 50);

    world.onThermalCaught = (event: ThermalCaughtEvent) => {
      setPopups((prev) => [
        ...prev,
        {
          id: nextPopupId++,
          leftPercent: toLeftPercent(event.x),
          text: `LIFT +${event.points}`,
          kind: "lift",
        },
      ]);
    };
    world.onBirdHit = (event: BirdHitEvent) => {
      setPopups((prev) => [
        ...prev,
        { id: nextPopupId++, leftPercent: toLeftPercent(event.x), text: "HIT!", kind: "hit" },
      ]);
    };
    world.onCrashed = () => setIsOver(true);

    const input = new InputManager(renderer.domElement);
    inputRef.current = input;
    input.addListener({
      onPointerUp: () => {
        world.setPointerTarget(null);
        world.setClimbInput(0);
      },
      onKeyDown: (key) => {
        if (key === " ") {
          setIsPaused(loop.togglePause());
        } else if (key === "r") {
          world.reset();
          setIsOver(false);
        }
      },
    });

    let gliderRoll = 0;
    let gliderPitch = 0;
    let previousGliderX = world.gliderX;
    let previousAltitude = world.altitude;

    const loop = new GameLoop((deltaSeconds, elapsedSeconds) => {
      const pointer = input.getPrimaryPointer();
      if (pointer) {
        world.setPointerTarget(pointer.x);
        const halfHeight = world.height / 2;
        const climb = halfHeight > 0 ? (halfHeight - pointer.y) / halfHeight : 0;
        world.setClimbInput(climb);
      } else {
        if (input.isKeyDown("arrowleft") || input.isKeyDown("a")) {
          world.setSteeringInput(-1);
        } else if (input.isKeyDown("arrowright") || input.isKeyDown("d")) {
          world.setSteeringInput(1);
        } else {
          world.setSteeringInput(0);
        }

        if (input.isKeyDown("arrowup") || input.isKeyDown("w")) {
          world.setClimbInput(1);
        } else if (input.isKeyDown("arrowdown") || input.isKeyDown("s")) {
          world.setClimbInput(-1);
        } else {
          world.setClimbInput(0);
        }
      }

      world.step(deltaSeconds);

      setScore(world.score);
      setDistance(Math.floor(world.distanceTraveled));
      setAltitude(world.altitude);
      setStreak(world.streak);

      const halfWidth = world.width / 2;

      const currentThermalIds = new Set(world.thermals.map((t) => t.id));
      for (const [id, mesh] of thermalMeshes) {
        if (!currentThermalIds.has(id)) {
          scene.remove(mesh);
          disposeObject(mesh);
          thermalMeshes.delete(id);
        }
      }
      for (const thermal of world.thermals) {
        let mesh = thermalMeshes.get(thermal.id);
        if (!mesh) {
          mesh = createThermalMesh();
          scene.add(mesh);
          thermalMeshes.set(thermal.id, mesh);
        }
        mesh.position.x = thermal.x - halfWidth;
        mesh.position.z = -(thermal.z - world.distanceTraveled);
        const material = mesh.material as THREE.MeshBasicMaterial;
        material.opacity = 0.18 + 0.08 * Math.sin(elapsedSeconds * 3 + thermal.id);
      }

      const currentBirdIds = new Set(world.birds.map((b) => b.id));
      for (const [id, mesh] of birdMeshes) {
        if (!currentBirdIds.has(id)) {
          scene.remove(mesh);
          disposeObject(mesh);
          birdMeshes.delete(id);
        }
      }
      for (const bird of world.birds) {
        let mesh = birdMeshes.get(bird.id);
        if (!mesh) {
          mesh = createBirdMesh();
          scene.add(mesh);
          birdMeshes.set(bird.id, mesh);
        }
        mesh.position.set(bird.x - halfWidth, bird.altitude, -(bird.z - world.distanceTraveled));
        const flap = Math.sin(elapsedSeconds * 14 + bird.id) * 0.5;
        const leftWing = mesh.getObjectByName("leftWing");
        const rightWing = mesh.getObjectByName("rightWing");
        if (leftWing) leftWing.rotation.z = flap;
        if (rightWing) rightWing.rotation.z = -flap;
      }

      const gliderWorldX = world.gliderX - halfWidth;
      // 実際の移動量(横方向=旋回、高度方向=昇降)から傾きを求める。入力方式(ポインタ/キーボード)を
      // 問わず一貫した見た目のバンク/ピッチになる。
      const deltaX = world.gliderX - previousGliderX;
      const deltaAltitude = world.altitude - previousAltitude;
      previousGliderX = world.gliderX;
      previousAltitude = world.altitude;
      const targetRoll =
        deltaSeconds > 0 ? THREE.MathUtils.clamp((-deltaX / deltaSeconds) * 0.003, -0.9, 0.9) : 0;
      const targetPitch =
        deltaSeconds > 0
          ? THREE.MathUtils.clamp((deltaAltitude / deltaSeconds) * 0.03, -0.6, 0.6)
          : 0;
      gliderRoll = THREE.MathUtils.lerp(gliderRoll, targetRoll, Math.min(1, deltaSeconds * 6));
      gliderPitch = THREE.MathUtils.lerp(gliderPitch, targetPitch, Math.min(1, deltaSeconds * 6));

      gliderMesh.position.set(gliderWorldX, world.altitude, 0);
      gliderMesh.rotation.set(Math.PI / 2 + gliderPitch, 0, gliderRoll);

      grid.position.z = -(world.distanceTraveled % GRID_SPACING);

      camera.position.set(
        gliderWorldX,
        world.altitude + CAMERA_HEIGHT_ABOVE_GLIDER,
        CAMERA_BACK_DISTANCE,
      );
      camera.lookAt(gliderWorldX, world.altitude - 8, -CAMERA_LOOK_AHEAD);

      renderer.render(scene, camera);
    }, 0.1);

    loopRef.current = loop;
    loop.start();

    return () => {
      loopRef.current?.stop();
      loopRef.current = null;
      inputRef.current?.dispose();
      inputRef.current = null;
      for (const mesh of thermalMeshes.values()) disposeObject(mesh);
      for (const mesh of birdMeshes.values()) disposeObject(mesh);
      disposeObject(gliderMesh);
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
      title="Thermal Glider"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
      pauseHint="タップ / Space キーで再開"
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="thermal-glider-stage">
        <div
          ref={canvasHostRef}
          className={styles.canvasHost}
          data-testid="thermal-glider-canvas"
        />
        {popups.map((popup) => (
          <span
            key={popup.id}
            className={popup.kind === "hit" ? styles.popupHit : styles.popupLift}
            style={{ left: `${popup.leftPercent}%` }}
            onAnimationEnd={() =>
              setPopups((prev) => prev.filter((entry) => entry.id !== popup.id))
            }
          >
            {popup.text}
          </span>
        ))}
        <div className={styles.hud}>
          <span className={styles.distance} data-testid="thermal-glider-distance">
            {distance}m
          </span>
          <span className={styles.altitude} data-testid="thermal-glider-altitude">
            ALT {Math.round(altitude)}
          </span>
          {streak >= 2 && (
            <span className={styles.streak} data-testid="thermal-glider-streak">
              STREAK {streak}
            </span>
          )}
        </div>
        <div className={styles.hint}>
          ドラッグ/長押しでグライダーを操作(左右で旋回、上下で上昇/降下)。オレンジのサーマル(上昇気流)に
          入ると高度が上がる。何もしないと重力でじわじわ沈み、鳥にぶつかると高度が大きく減る。
          高度が0になると墜落。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="thermal-glider-gameover">
            <div className={styles.gameOverTitle}>墜落してしまった…</div>
            <div className={styles.gameOverScore}>
              SCORE {Math.floor(score).toLocaleString("ja-JP")}
            </div>
            <div className={styles.gameOverSub}>飛行距離 {distance}m</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="thermal-glider-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
