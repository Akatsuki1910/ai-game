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
];
