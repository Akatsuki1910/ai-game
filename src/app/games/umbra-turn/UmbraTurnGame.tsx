"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import { CRYSTAL_POINTS, type Point2D, UmbraTurnWorld, type Vec3 } from "./engine/world";
import styles from "./UmbraTurnGame.module.scss";

/** ドラッグ1pxあたりのヨー/ピッチ回転量(ラジアン)。 */
const DRAG_YAW_SENSITIVITY = 0.012;
const DRAG_PITCH_SENSITIVITY = 0.012;
/** キーボード長押し時の回転速度(ラジアン/秒)。 */
const KEY_ROTATE_RADIANS_PER_SECOND = 1.6;

const CRYSTAL_FACES: readonly [number, number, number][] = [
  [0, 2, 3],
  [0, 3, 4],
  [0, 4, 5],
  [0, 5, 2],
  [1, 3, 2],
  [1, 4, 3],
  [1, 5, 4],
  [1, 2, 5],
];

const FLOOR_RADIUS = 2.6;
const CRYSTAL_HEIGHT_ABOVE_FLOOR = 1.05;

function buildCrystalGeometry(points: readonly Vec3[]): THREE.BufferGeometry {
  const positions = new Float32Array(CRYSTAL_FACES.length * 3 * 3);
  let offset = 0;
  for (const [a, b, c] of CRYSTAL_FACES) {
    for (const index of [a, b, c]) {
      const point = points[index];
      positions[offset++] = point.x;
      positions[offset++] = point.y;
      positions[offset++] = point.z;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function buildSilhouetteGeometry(points: readonly Point2D[]): THREE.BufferGeometry | null {
  if (points.length < 3) return null;
  const shape = new THREE.Shape(points.map((point) => new THREE.Vector2(point.x, point.z)));
  return new THREE.ShapeGeometry(shape);
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
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

export function UmbraTurnGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const canvasHostRef = useRef<HTMLDivElement | null>(null);

  const worldRef = useRef<UmbraTurnWorld | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  const [score, setScore] = useState(0);
  const [round, setRound] = useState(1);
  const [lives, setLives] = useState(3);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [matchQuality, setMatchQuality] = useState(0);
  const [holdRatio, setHoldRatio] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isOver, setIsOver] = useState(false);

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

    const world = new UmbraTurnWorld();
    worldRef.current = world;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0c14);
    scene.fog = new THREE.Fog(0x0b0c14, 6, 14);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 3.6, 4.4);
    camera.lookAt(0, 0.6, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    rendererRef.current = renderer;
    host.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const keyLight = new THREE.DirectionalLight(0xbfe9ff, 1.15);
    keyLight.position.set(2.4, 4.5, 2.2);
    scene.add(keyLight);
    const rimLight = new THREE.PointLight(0x7cf5c4, 0.6, 8);
    rimLight.position.set(-1.8, 1.4, -1.6);
    scene.add(rimLight);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(FLOOR_RADIUS, 48),
      new THREE.MeshStandardMaterial({ color: 0x14161d, roughness: 0.95 }),
    );
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    for (const ringRadius of [1.6, 2.2]) {
      const ringPoints: THREE.Vector3[] = [];
      const segments = 64;
      for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        ringPoints.push(
          new THREE.Vector3(Math.cos(angle) * ringRadius, 0.002, Math.sin(angle) * ringRadius),
        );
      }
      const ringGeometry = new THREE.BufferGeometry().setFromPoints(ringPoints);
      const ring = new THREE.Line(
        ringGeometry,
        new THREE.LineBasicMaterial({ color: 0x2b2f3a, transparent: true, opacity: 0.6 }),
      );
      scene.add(ring);
    }

    const crystalMaterial = new THREE.MeshStandardMaterial({
      color: 0x9fe8ff,
      metalness: 0.2,
      roughness: 0.25,
      flatShading: true,
      emissive: new THREE.Color(0x7cf5c4),
      emissiveIntensity: 0,
    });
    const crystalMesh = new THREE.Mesh(buildCrystalGeometry(CRYSTAL_POINTS), crystalMaterial);
    scene.add(crystalMesh);

    const targetMaterial = new THREE.MeshBasicMaterial({
      color: 0x6ee7ff,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const targetMesh = new THREE.Mesh(new THREE.BufferGeometry(), targetMaterial);
    targetMesh.rotation.x = Math.PI / 2;
    targetMesh.position.y = 0.01;
    scene.add(targetMesh);

    const liveMaterial = new THREE.MeshBasicMaterial({
      color: 0xffb454,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const liveMesh = new THREE.Mesh(new THREE.BufferGeometry(), liveMaterial);
    liveMesh.rotation.x = Math.PI / 2;
    liveMesh.position.y = 0.02;
    scene.add(liveMesh);

    const updateTargetMesh = () => {
      const geometry = buildSilhouetteGeometry(world.getTargetSilhouette());
      if (!geometry) return;
      targetMesh.geometry.dispose();
      targetMesh.geometry = geometry;
    };
    const updateLiveMesh = () => {
      const geometry = buildSilhouetteGeometry(world.getLiveSilhouette());
      if (!geometry) return;
      liveMesh.geometry.dispose();
      liveMesh.geometry = geometry;
    };
    updateTargetMesh();
    updateLiveMesh();

    let dragPointerId: number | null = null;
    let lastDragX = 0;
    let lastDragY = 0;

    const input = new InputManager(renderer.domElement);
    inputRef.current = input;
    input.addListener({
      onPointerDown: (pointer) => {
        if (dragPointerId !== null) return;
        dragPointerId = pointer.id;
        lastDragX = pointer.x;
        lastDragY = pointer.y;
      },
      onPointerMove: (pointer) => {
        if (pointer.id !== dragPointerId) return;
        const deltaX = pointer.x - lastDragX;
        const deltaY = pointer.y - lastDragY;
        lastDragX = pointer.x;
        lastDragY = pointer.y;
        world.rotateBy(deltaX * DRAG_YAW_SENSITIVITY, deltaY * DRAG_PITCH_SENSITIVITY);
      },
      onPointerUp: (pointer) => {
        if (pointer.id === dragPointerId) dragPointerId = null;
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

    let lastRound = world.round;

    const loop = new GameLoop((deltaSeconds) => {
      let yawInput = 0;
      if (input.isKeyDown("arrowleft") || input.isKeyDown("a")) yawInput -= 1;
      if (input.isKeyDown("arrowright") || input.isKeyDown("d")) yawInput += 1;
      let pitchInput = 0;
      if (input.isKeyDown("arrowup") || input.isKeyDown("w")) pitchInput -= 1;
      if (input.isKeyDown("arrowdown") || input.isKeyDown("s")) pitchInput += 1;
      if (yawInput !== 0 || pitchInput !== 0) {
        world.rotateBy(
          yawInput * KEY_ROTATE_RADIANS_PER_SECOND * deltaSeconds,
          pitchInput * KEY_ROTATE_RADIANS_PER_SECOND * deltaSeconds,
        );
      }

      world.step(deltaSeconds);

      if (world.round !== lastRound) {
        lastRound = world.round;
        updateTargetMesh();
      }
      updateLiveMesh();

      const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), world.yaw);
      const qPitch = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 0, 0),
        world.pitch,
      );
      crystalMesh.quaternion.copy(qPitch.multiply(qYaw));
      crystalMesh.position.y = CRYSTAL_HEIGHT_ABOVE_FLOOR;

      const holdFraction = world.holdDuration > 0 ? world.holdProgress / world.holdDuration : 0;
      crystalMaterial.emissiveIntensity = holdFraction * 0.9;

      setScore(world.score);
      setRound(world.round);
      setLives(world.lives);
      setTimeRemaining(world.timeRemaining);
      setMatchQuality(world.matchQuality);
      setHoldRatio(holdFraction);
      if (world.isOver) setIsOver(true);

      renderer.render(scene, camera);
    }, 0.1);

    loopRef.current = loop;
    loop.start();

    return () => {
      loopRef.current?.stop();
      loopRef.current = null;
      inputRef.current?.dispose();
      inputRef.current = null;
      disposeObject(crystalMesh);
      disposeObject(targetMesh);
      disposeObject(liveMesh);
      disposeObject(floor);
      renderer.dispose();
      if (host.contains(renderer.domElement)) host.removeChild(renderer.domElement);
      rendererRef.current = null;
      cameraRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (size.width === 0 || size.height === 0) return;
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (!renderer || !camera) return;

    renderer.setSize(size.width, size.height, false);
    camera.aspect = size.width / size.height;
    camera.updateProjectionMatrix();
  }, [size.width, size.height]);

  return (
    <GameShell
      title="Umbra Turn"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
      pauseHint="タップ / Space キーで再開"
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="umbra-turn-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="umbra-turn-canvas" />
        <div className={styles.hud}>
          <span className={styles.round} data-testid="umbra-turn-round">
            ROUND {round}
          </span>
          <span className={styles.lives} data-testid="umbra-turn-lives">
            {"◆".repeat(Math.max(0, lives))}
          </span>
          <span className={styles.timer} data-testid="umbra-turn-timer">
            {Math.ceil(Math.max(0, timeRemaining))}s
          </span>
        </div>
        <div className={styles.matchPanel}>
          <div className={styles.matchRow}>
            <span>一致度</span>
            <span data-testid="umbra-turn-match">{Math.round(matchQuality * 100)}%</span>
          </div>
          <div className={styles.focusTrack}>
            <div
              className={styles.focusFill}
              style={{ width: `${Math.round(holdRatio * 100)}%` }}
            />
          </div>
          <div className={styles.focusLabel} data-testid="umbra-turn-focus">
            集中 {Math.round(holdRatio * 100)}%
          </div>
        </div>
        <div className={styles.hint}>
          ドラッグで水晶を回転させ(左右=ヨー、上下=ピッチ)、床のシアン色の目標シルエットにオレンジ色の
          自分の影をぴったり重ねて保持しよう。一致度が十分なまま集中ゲージが満ちるとロック成功。
          制限時間内にロックできないとライフが減り、進むほど時間は短く判定は厳しくなる。
        </div>
        {isOver && (
          <div className={styles.gameOver} data-testid="umbra-turn-gameover">
            <div className={styles.gameOverTitle}>影合わせ失敗…</div>
            <div className={styles.gameOverScore}>
              SCORE {Math.floor(score).toLocaleString("ja-JP")}
            </div>
            <div className={styles.gameOverSub}>到達ラウンド {round}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="umbra-turn-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
