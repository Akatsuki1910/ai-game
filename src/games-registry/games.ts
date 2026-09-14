import type { GameMeta } from "./types";

/**
 * 全ゲームのメタ情報。トップページの一覧はここから自動生成される。
 *
 * ゲームを追加する手順:
 * 1. `src/app/games/<slug>/` にページを実装する
 * 2. このリストに1件追加する（slug は 2. のディレクトリ名と一致させる）
 * 3. これだけでトップページの一覧に自動的に出る
 *
 * 詳細は CLAUDE.md の「ゲームの追加手順」を参照。
 */
export const games: GameMeta[] = [
  {
    slug: "prism-drift",
    title: "Prism Drift",
    description:
      "ドリフトする的をレーザーとプリズムで狙う、リアルタイム光学パズル。プリズムをドラッグして光を分岐・反射させ、揺れ動くターゲットを撃ち続けろ。",
    tags: ["arcade", "puzzle", "realtime", "light"],
    dimension: "2d",
    engine: "pixi",
    createdAt: "2026-09-14",
    controls: {
      mouse: "ドラッグでプリズムを移動、クリックで種類を切り替え",
      touch: "ドラッグでプリズムを移動、タップで種類を切り替え",
      keyboard: "Space: 一時停止 / R: ラウンドをリセット",
    },
    status: "prototype",
  },
  {
    slug: "orbit-sling",
    title: "Orbit Sling",
    description:
      "惑星の重力でコメットの軌道を曲げるスリングショット・ゴルフ。パッドから引っ張って発射し、漂うリングを次々通過してコンボを稼げ。",
    tags: ["arcade", "physics", "gravity", "realtime"],
    dimension: "2d",
    engine: "pixi",
    createdAt: "2026-09-14",
    controls: {
      mouse: "ドラッグして引っ張り、離すと逆方向へ発射",
      touch: "ドラッグして引っ張り、離すと逆方向へ発射",
      keyboard: "←→: 角度調整 / ↑↓: パワー調整 / Enter: 発射 / Space: 一時停止",
    },
    status: "prototype",
  },
  {
    slug: "gravity-herd",
    title: "Gravity Herd",
    description:
      "重力の井戸を操って漂う彗星を中央のリングへ誘導する3Dアークシミュレーター。太陽の重力で軌道を回る彗星を、ドラッグで生む引力で丁寧に手なずけよう。アステロイドに当てるとコンボが切れる。",
    tags: ["arcade", "physics", "3d", "space"],
    dimension: "3d",
    engine: "three",
    createdAt: "2026-09-14",
    controls: {
      mouse: "ドラッグ（クリック押しっぱなし）で重力の井戸を移動",
      touch: "指でドラッグして重力の井戸を移動",
      keyboard: "Space: 一時停止 / R: ラウンドをリセット",
    },
    status: "prototype",
  },
  {
    slug: "grid-breach",
    title: "Grid Breach",
    description:
      "回路基板を陣取るテリトリー・アクション。自陣から軌跡を伸ばして外周を囲み、パトロールするセキュリティ・スパークに触れられる前に自陣へ戻って制圧せよ。75%制圧でクリア。",
    tags: ["arcade", "territory", "action", "realtime"],
    dimension: "2d",
    engine: "pixi",
    createdAt: "2026-09-14",
    controls: {
      mouse: "ドラッグした方向へ進路を変更",
      touch: "ドラッグした方向へ進路を変更",
      keyboard: "矢印キー/WASD: 進路変更 / Space: 一時停止 / R: リセット",
    },
    status: "prototype",
  },
];
