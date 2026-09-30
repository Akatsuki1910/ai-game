"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GameLoop, InputManager, useElementSize } from "@/shared/engine";
import { GameShell } from "@/shared/ui";
import {
  ANGLE_MAX_DEG,
  type FoldPinnedEvent,
  INITIAL_WRINKLES,
  type RoundClearedEvent,
  SensuFoldWorld,
} from "./engine/world";
import styles from "./SensuFoldGame.module.scss";

interface Popup {
  id: number;
  text: string;
  kind: "success" | "miss" | "clear";
}

let nextPopupId = 1;

const PANEL_LENGTH = 46;
const PANEL_WIDTH = 30;
const PANEL_THICKNESS = 1.4;
const ANCHOR_LENGTH = 20;
const KEYBOARD_ANGLE_RATE_DEG_PER_SEC = 110;

const COLOR_FRONT = 0xfdf6e8;
const COLOR_FRONT_ACTIVE = 0x9ff3ff;
const COLOR_BACK = 0xdd5a4a;
const COLOR_EDGE = 0xcbb9a0;

function createPanelMaterials(): THREE.MeshStandardMaterial[] {
  const edge = new THREE.MeshStandardMaterial({
    color: COLOR_EDGE,
    roughness: 0.8,
    flatShading: true,
  });
  const front = new THREE.MeshStandardMaterial({
    color: COLOR_FRONT,
    roughness: 0.55,
    flatShading: true,
  });
  const back = new THREE.MeshStandardMaterial({
    color: COLOR_BACK,
    roughness: 0.55,
    flatShading: true,
  });
  // BoxGeometryのマテリアル配列順は [+x, -x, +y, -y, +z, -z]。
  // +y(上面)が折る前の表、-y(裏面)が180度折り返した後に見える側になる。
  return [edge, edge, front, back, edge, edge];
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function disposePanelMaterials(mesh: THREE.Mesh): void {
  const materials = mesh.material;
  if (Array.isArray(materials)) {
    for (const material of materials) material.dispose();
  } else {
    materials.dispose();
  }
}

interface FoldChain {
  pivots: THREE.Group[];
  meshes: THREE.Mesh[];
}

/**
 * アンカー(扇の要/持ち手)から始まり、パネル数ぶんの蝶番(pivot)を数珠つなぎに
 * 生成する。各 pivot は親 pivot の子として追加するため、手前のパネルを回転させると
 * その先につながる残りのパネルもまとめて追従する。
 */
function buildFoldChain(
  sheetGroup: THREE.Group,
  anchorMesh: THREE.Mesh,
  panelCount: number,
  geometry: THREE.BoxGeometry,
): FoldChain {
  for (const child of [...sheetGroup.children]) {
    if (child !== anchorMesh) sheetGroup.remove(child);
  }

  const pivots: THREE.Group[] = [];
  const meshes: THREE.Mesh[] = [];
  let parent: THREE.Object3D = sheetGroup;

  for (let i = 0; i < panelCount; i++) {
    const pivot = new THREE.Group();
    pivot.position.z = i === 0 ? ANCHOR_LENGTH : PANEL_LENGTH;
    parent.add(pivot);

    const mesh = new THREE.Mesh(geometry, createPanelMaterials());
    mesh.position.z = PANEL_LENGTH / 2;
    pivot.add(mesh);

    pivots.push(pivot);
    meshes.push(mesh);
    parent = pivot;
  }

  return { pivots, meshes };
}

export function SensuFoldGame() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const stageHeightRef = useRef(0);

  // 角度/目標/許容値は毎フレーム変化し続けるため、React state ではなく ref 経由で
  // DOM を直接書き換える。React state にすると setState がフレームごとに走り、
  // Next.js のルート遷移(低優先度のトランジション)が常に割り込まれて先へ進めなくなる
  // (実機/CI 環境でヘッダーの「一覧へ」リンクが反応しなくなる不具合があった)。
  const angleTextRef = useRef<HTMLSpanElement | null>(null);
  const targetTextRef = useRef<HTMLSpanElement | null>(null);
  const toleranceTextRef = useRef<HTMLSpanElement | null>(null);
  const gaugeBandRef = useRef<HTMLDivElement | null>(null);
  const gaugeMarkerRef = useRef<HTMLDivElement | null>(null);

  const worldRef = useRef<SensuFoldWorld | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);

  const [score, setScore] = useState(0);
  const [round, setRound] = useState(1);
  const [panelCount, setPanelCount] = useState(3);
  const [foldIndex, setFoldIndex] = useState(0);
  const [wrinkles, setWrinkles] = useState(INITIAL_WRINKLES);
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

    const world = new SensuFoldWorld();
    worldRef.current = world;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1c1f2a);
    scene.fog = new THREE.Fog(0x1c1f2a, 260, 560);

    const camera = new THREE.PerspectiveCamera(42, 1, 1, 2000);
    camera.position.set(150, 120, 96);
    camera.lookAt(10, 34, 30);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    rendererRef.current = renderer;
    host.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const keyLight = new THREE.DirectionalLight(0xfff3df, 1.1);
    keyLight.position.set(120, 200, 160);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0x9fd4ff, 0.4);
    rimLight.position.set(-120, 80, -60);
    scene.add(rimLight);

    const table = new THREE.Mesh(
      new THREE.CircleGeometry(220, 48),
      new THREE.MeshStandardMaterial({ color: 0x2a2e3a, roughness: 1 }),
    );
    table.rotation.x = -Math.PI / 2;
    table.position.y = -0.5;
    scene.add(table);

    const sheetGroup = new THREE.Group();
    scene.add(sheetGroup);

    const anchorMesh = new THREE.Mesh(
      new THREE.BoxGeometry(PANEL_WIDTH * 0.55, PANEL_THICKNESS * 1.8, ANCHOR_LENGTH),
      new THREE.MeshStandardMaterial({ color: 0x6b4a34, roughness: 0.7, flatShading: true }),
    );
    anchorMesh.position.z = ANCHOR_LENGTH / 2;
    sheetGroup.add(anchorMesh);

    const panelGeometry = new THREE.BoxGeometry(PANEL_WIDTH, PANEL_THICKNESS, PANEL_LENGTH);

    let chain = buildFoldChain(sheetGroup, anchorMesh, world.panelCount, panelGeometry);
    let chainPanelCount = world.panelCount;

    world.onFoldPinned = (event: FoldPinnedEvent) => {
      setPopups((prev) => [
        ...prev,
        {
          id: nextPopupId++,
          text: event.isSuccess ? `PIN +${event.pointsGained}` : "MISS",
          kind: event.isSuccess ? "success" : "miss",
        },
      ]);
    };
    world.onRoundCleared = (event: RoundClearedEvent) => {
      setPopups((prev) => [
        ...prev,
        { id: nextPopupId++, text: `扇が完成! ラウンド${event.round}へ`, kind: "clear" },
      ]);
    };
    world.onGameOver = () => setIsOver(true);

    const input = new InputManager(renderer.domElement);
    inputRef.current = input;
    input.addListener({
      onPointerUp: () => {
        world.pin();
      },
      onKeyDown: (key) => {
        if (key === " ") {
          setIsPaused(loop.togglePause());
        } else if (key === "r") {
          world.reset();
          setIsOver(false);
        } else if (key === "enter") {
          world.pin();
        }
      },
    });

    const loop = new GameLoop((deltaSeconds) => {
      const pointer = input.getPrimaryPointer();
      const stageHeight = stageHeightRef.current;
      if (pointer && stageHeight > 0) {
        const ratio = 1 - Math.min(Math.max(pointer.y / stageHeight, 0), 1);
        world.setAngleRatio(ratio);
      } else {
        let direction = 0;
        if (input.isKeyDown("arrowup") || input.isKeyDown("w")) direction = 1;
        else if (input.isKeyDown("arrowdown") || input.isKeyDown("s")) direction = -1;
        if (direction !== 0) {
          world.adjustAngle(direction * KEYBOARD_ANGLE_RATE_DEG_PER_SEC * deltaSeconds);
        }
      }

      world.step(deltaSeconds);

      if (world.panelCount !== chainPanelCount) {
        for (const mesh of chain.meshes) disposePanelMaterials(mesh);
        chain = buildFoldChain(sheetGroup, anchorMesh, world.panelCount, panelGeometry);
        chainPanelCount = world.panelCount;
      }

      for (let i = 0; i < chain.pivots.length; i++) {
        const angleDeg =
          i < world.foldIndex
            ? (world.completedAngles[i] ?? 0)
            : i === world.foldIndex
              ? world.currentAngleDeg
              : 0;
        chain.pivots[i].rotation.x = -THREE.MathUtils.degToRad(angleDeg);

        const panelMaterials = chain.meshes[i].material as THREE.MeshStandardMaterial[];
        panelMaterials[2].color.set(i === world.foldIndex ? COLOR_FRONT_ACTIVE : COLOR_FRONT);
      }

      setScore(world.score);
      setRound(world.round);
      setPanelCount(world.panelCount);
      setFoldIndex(world.foldIndex);
      setWrinkles(world.wrinkles);

      if (angleTextRef.current)
        angleTextRef.current.textContent = `角度 ${Math.round(world.currentAngleDeg)}°`;
      if (targetTextRef.current)
        targetTextRef.current.textContent = `目標 ${Math.round(world.targetCenterDeg)}°`;
      if (toleranceTextRef.current) {
        toleranceTextRef.current.textContent = `許容 ±${Math.round(world.toleranceDeg)}°`;
      }
      const bandStartPercent = clampPercent(
        ((world.targetCenterDeg - world.toleranceDeg) / ANGLE_MAX_DEG) * 100,
      );
      const bandEndPercent = clampPercent(
        ((world.targetCenterDeg + world.toleranceDeg) / ANGLE_MAX_DEG) * 100,
      );
      const markerPercent = clampPercent((world.currentAngleDeg / ANGLE_MAX_DEG) * 100);
      if (gaugeBandRef.current) {
        gaugeBandRef.current.style.left = `${bandStartPercent}%`;
        gaugeBandRef.current.style.width = `${bandEndPercent - bandStartPercent}%`;
      }
      if (gaugeMarkerRef.current) {
        gaugeMarkerRef.current.style.left = `${markerPercent}%`;
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
      for (const mesh of chain.meshes) disposePanelMaterials(mesh);
      panelGeometry.dispose();
      (anchorMesh.material as THREE.Material).dispose();
      anchorMesh.geometry.dispose();
      (table.material as THREE.Material).dispose();
      table.geometry.dispose();
      renderer.dispose();
      if (host.contains(renderer.domElement)) host.removeChild(renderer.domElement);
      cameraRef.current = null;
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (size.width === 0 || size.height === 0) return;
    stageHeightRef.current = size.height;
    const camera = cameraRef.current;
    if (camera) {
      camera.aspect = size.width / size.height;
      camera.updateProjectionMatrix();
    }
    // 第3引数 false で canvas の inline style を書き換えない。CSS 側の width/height:100%
    // と競合すると、ResizeObserver が発火し続けてレイアウトが不安定になる
    // (gravity-herd の実装と同じ回避策)。
    rendererRef.current?.setSize(size.width, size.height, false);
  }, [size.width, size.height]);

  return (
    <GameShell
      title="Sensu Fold"
      score={score}
      isPaused={isPaused}
      onTogglePause={handleTogglePause}
      pauseHint="タップ / Space キーで再開"
    >
      <div ref={stageRef} className={styles.stageInner} data-testid="sensu-fold-stage">
        <div ref={canvasHostRef} className={styles.canvasHost} data-testid="sensu-fold-canvas" />

        <div className={styles.hud}>
          <span className={styles.round} data-testid="sensu-fold-round">
            ROUND {round}
          </span>
          <span className={styles.progress} data-testid="sensu-fold-progress">
            {foldIndex}/{panelCount} 枚
          </span>
          <span className={styles.wrinkles} data-testid="sensu-fold-wrinkles">
            {"❤".repeat(wrinkles)}
            {"♡".repeat(Math.max(0, INITIAL_WRINKLES - wrinkles))}
          </span>
        </div>

        <div className={styles.gaugePanel} data-testid="sensu-fold-gauge">
          <div className={styles.gaugeReadouts}>
            <span ref={angleTextRef} data-testid="sensu-fold-angle">
              角度 0°
            </span>
            <span ref={targetTextRef} data-testid="sensu-fold-target">
              目標 90°
            </span>
            <span ref={toleranceTextRef} data-testid="sensu-fold-tolerance">
              許容 ±22°
            </span>
          </div>
          <div className={styles.gaugeTrack}>
            <div ref={gaugeBandRef} className={styles.gaugeBand} />
            <div ref={gaugeMarkerRef} className={styles.gaugeMarker} />
          </div>
        </div>

        {popups.map((popup) => (
          <span
            key={popup.id}
            className={
              popup.kind === "success"
                ? styles.popupSuccess
                : popup.kind === "clear"
                  ? styles.popupClear
                  : styles.popupMiss
            }
            onAnimationEnd={() =>
              setPopups((prev) => prev.filter((entry) => entry.id !== popup.id))
            }
          >
            {popup.text}
          </span>
        ))}

        <div className={styles.hint}>
          ポインタ/指を上下に動かして折り角度を合わせ、クリック/タップ/Enterでピン留め。揺れ動く
          水色の帯(目標)に重なった状態で留めると成功。外すと紙が傷んでハートが減り、その折り目は
          0度からやり直しになる。全部折り終えると次のラウンドへ(パネルが増え、帯は細く速くなる)。
        </div>

        {isOver && (
          <div className={styles.gameOver} data-testid="sensu-fold-gameover">
            <div className={styles.gameOverTitle}>紙が破れてしまった…</div>
            <div className={styles.gameOverScore}>
              SCORE {Math.floor(score).toLocaleString("ja-JP")}
            </div>
            <div className={styles.gameOverSub}>到達ラウンド {round}</div>
            <button
              type="button"
              className={styles.restartButton}
              onClick={handleRestart}
              data-testid="sensu-fold-restart"
            >
              もう一度あそぶ
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
