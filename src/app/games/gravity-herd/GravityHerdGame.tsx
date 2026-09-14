"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import { type CometBurnedEvent, type CometCapturedEvent, GravityHerdWorld } from "./engine/world";
import styles from "./GravityHerdGame.module.scss";

interface Popup {
  id: number;
  x: number;
  y: number;
  text: string;
  kind: "capture" | "burn";
}

let nextPopupId = 1;
const HAZARD_VISUAL_RADIUS = 16;

function hueToColor(hue: number): THREE.Color {
  return new THREE.Color().setHSL(hue / 360, 0.75, 0.6);
}

export function GravityHerdGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const canvasHostRef = useRef<HTMLDivElement | null>(null);

  const worldRef = useRef<GravityHerdWorld | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);

  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(75);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);
  const [popups, setPopups] = useState<Popup[]>([]);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;

    const world = new GravityHerdWorld(1, 1);
    worldRef.current = world;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05060a);
    scene.fog = new THREE.Fog(0x05060a, 400, 1600);

    const camera = new THREE.PerspectiveCamera(50, 1, 1, 4000);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    host.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    scene.add(new THREE.AmbientLight(0x8090ff, 0.6));
    const sunLight = new THREE.DirectionalLight(0xffffff, 1.1);
    sunLight.position.set(200, 400, 250);
    scene.add(sunLight);

    const grid = new THREE.GridHelper(2400, 48, 0x2b4a5a, 0x141a24);
    scene.add(grid);

    const collectorMesh = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.16, 12, 48),
      new THREE.MeshStandardMaterial({
        color: 0x6ee7ff,
        emissive: 0x1b6b7a,
        emissiveIntensity: 0.8,
        metalness: 0.2,
        roughness: 0.35,
      }),
    );
    collectorMesh.rotation.x = Math.PI / 2;
    scene.add(collectorMesh);

    const cometMeshes = world.comets.map((comet) => {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(comet.radius, 20, 16),
        new THREE.MeshStandardMaterial({
          color: hueToColor(comet.hue),
          emissive: hueToColor(comet.hue),
          emissiveIntensity: 0.5,
          roughness: 0.35,
          metalness: 0.1,
        }),
      );
      scene.add(mesh);
      return mesh;
    });

    const hazardMeshes = world.hazards.map(() => {
      const mesh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(HAZARD_VISUAL_RADIUS, 0),
        new THREE.MeshStandardMaterial({
          color: 0x3a1620,
          emissive: 0xff5a5a,
          emissiveIntensity: 0.45,
          roughness: 0.7,
          metalness: 0.1,
          flatShading: true,
        }),
      );
      scene.add(mesh);
      return mesh;
    });

    const wellMesh = new THREE.Mesh(
      new THREE.RingGeometry(0.7, 1, 32),
      new THREE.MeshBasicMaterial({
        color: 0xffe066,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
      }),
    );
    wellMesh.rotation.x = Math.PI / 2;
    wellMesh.visible = false;
    scene.add(wellMesh);

    const raycaster = new THREE.Raycaster();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const rayTarget = new THREE.Vector3();
    const ndc = new THREE.Vector2();

    const toGroundPoint = (px: number, py: number): { x: number; y: number } | null => {
      ndc.x = (px / Math.max(world.width, 1)) * 2 - 1;
      ndc.y = -(py / Math.max(world.height, 1)) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.ray.intersectPlane(groundPlane, rayTarget);
      if (!hit) return null;
      return { x: hit.x + world.width / 2, y: hit.z + world.height / 2 };
    };

    world.onCometCaptured = (event: CometCapturedEvent) => {
      const text = event.combo > 1 ? `+${event.points} COMBO x${event.combo}` : `+${event.points}`;
      setPopups((prev) => [
        ...prev,
        { id: nextPopupId++, x: event.x, y: event.y, text, kind: "capture" },
      ]);
    };

    world.onCometBurned = (event: CometBurnedEvent) => {
      setPopups((prev) => [
        ...prev,
        { id: nextPopupId++, x: event.x, y: event.y, text: "LOST", kind: "burn" },
      ]);
    };

    const input = new InputManager(renderer.domElement);
    inputRef.current = input;

    const applyPointer = (px: number, py: number) => {
      const ground = toGroundPoint(px, py);
      if (ground) world.setWellTarget(ground.x, ground.y);
    };

    input.addListener({
      onPointerDown: (pointer) => {
        applyPointer(pointer.x, pointer.y);
        world.setBoost(true);
      },
      onPointerMove: (pointer) => {
        applyPointer(pointer.x, pointer.y);
      },
      onPointerUp: () => {
        world.setBoost(false);
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

    const loop = new GameLoop((deltaSeconds, elapsedSeconds) => {
      world.step(deltaSeconds);
      setScore(Math.floor(world.score));
      setCombo(world.combo);
      setTimeRemaining(Math.ceil(world.timeRemaining));
      if (world.isOver) setIsOver(true);

      const cx = world.width / 2;
      const cy = world.height / 2;

      world.comets.forEach((comet, index) => {
        const mesh = cometMeshes[index];
        const bob = Math.sin(elapsedSeconds * 2.6 + comet.id) * 3;
        mesh.position.set(comet.x - cx, comet.radius * 1.4 + bob, comet.y - cy);
        (mesh.material as THREE.MeshStandardMaterial).color = hueToColor(comet.hue);
        (mesh.material as THREE.MeshStandardMaterial).emissive = hueToColor(comet.hue);
        const captureRatio = comet.dwell > 0 ? Math.min(1, comet.dwell / 0.55) : 0;
        const scale = 1 + captureRatio * 0.3;
        mesh.scale.setScalar(scale);
      });

      world.hazards.forEach((hazard, index) => {
        const mesh = hazardMeshes[index];
        mesh.position.set(hazard.x - cx, HAZARD_VISUAL_RADIUS, hazard.y - cy);
        mesh.rotation.x += deltaSeconds * 0.6;
        mesh.rotation.y += deltaSeconds * 0.4;
      });

      collectorMesh.position.set(0, 1, 0);
      collectorMesh.scale.setScalar(world.collector.radius);
      collectorMesh.rotation.z += deltaSeconds * 0.3;

      wellMesh.visible = world.boosting;
      if (world.boosting) {
        wellMesh.position.set(world.wellX - cx, 2, world.wellY - cy);
        const pulse = 14 + Math.sin(elapsedSeconds * 8) * 2;
        wellMesh.scale.setScalar(pulse);
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
      for (const mesh of [...cometMeshes, ...hazardMeshes, collectorMesh, wellMesh]) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
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
    const maxDim = Math.max(size.width, size.height);
    camera.position.set(0, maxDim * 0.62, maxDim * 0.68);
    camera.lookAt(0, 0, 0);
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
      title="Gravity Herd"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
    >
      <div ref={stageRef} className={styles.stageInner}>
        <div ref={canvasHostRef} className={styles.canvasHost} />
        {popups.map((popup) => (
          <span
            key={popup.id}
            className={popup.kind === "capture" ? styles.popupCapture : styles.popupBurn}
            style={{ left: popup.x, top: popup.y }}
            onAnimationEnd={() =>
              setPopups((prev) => prev.filter((entry) => entry.id !== popup.id))
            }
          >
            {popup.text}
          </span>
        ))}
        <div className={styles.hud}>
          <span className={styles.timer}>⏱ {timeRemaining}s</span>
          {combo > 1 && <span className={styles.combo}>COMBO x{combo}</span>}
        </div>
        <div className={styles.hint}>
          ドラッグして重力の井戸を動かし、彗星を中央のリングまで誘導しよう。赤いアステロイドに当てるとコンボが切れる。
        </div>
        {isOver && (
          <div className={styles.gameOver}>
            <div className={styles.gameOverTitle}>タイムアップ</div>
            <div className={styles.gameOverScore}>SCORE {score.toLocaleString("ja-JP")}</div>
            <button type="button" className={styles.restartButton} onClick={handleRestart}>
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
