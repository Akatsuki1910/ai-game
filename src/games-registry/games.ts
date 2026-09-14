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
  {
    slug: "echo-diver",
    title: "Echo Diver",
    description:
      "漆黒の海底洞窟をソナーだけを頼りに進む潜水艇サバイバル。ピンッと発信すれば岩・真珠・怪物レビヤタンが一瞬見えるが、その音は怪物をその場所へ引き寄せてしまう。",
    tags: ["arcade", "survival", "stealth", "realtime"],
    dimension: "2d",
    engine: "pixi",
    createdAt: "2026-09-14",
    controls: {
      mouse: "ドラッグ/長押しした方向へ推進、クリック（タップ判定）でソナー発信",
      touch: "ドラッグ/長押しした方向へ推進、タップでソナー発信",
      keyboard: "矢印キー/WASD: 移動 / E・Enter: ソナー発信 / Space: 一時停止 / R: リセット",
    },
    status: "prototype",
  },
  {
    slug: "chroma-well",
    title: "Chroma Well",
    description:
      "3色のピグメントを混ぜてお題の色を再現する、リアルタイム調色パズル。井戸にインクを盛って混色し、蒸発する前にお題の色を維持し続けて調色を完成させろ。",
    tags: ["arcade", "puzzle", "color", "realtime"],
    dimension: "2d",
    engine: "pixi",
    createdAt: "2026-09-14",
    controls: {
      mouse: "ドラッグ/クリックで選択中のピグメントを盛る、パレットクリックで色を切替",
      touch: "ドラッグ/タップで選択中のピグメントを盛る、パレットタップで色を切替",
      keyboard: "1/2/3: 色を切替 / Space: 一時停止 / R: ラウンドをリセット",
    },
    status: "prototype",
  },
  {
    slug: "close-hauled",
    title: "Close Hauled",
    description:
      "風上のブイを目指すリアルタイム帆走レース。真正面(ノーゴーゾーン)には進めないヨットを、ジグザグ(タック)で操って刻々と揺れる風を読みながら得点を稼げ。",
    tags: ["arcade", "sailing", "physics", "realtime"],
    dimension: "2d",
    engine: "pixi",
    createdAt: "2026-09-14",
    controls: {
      mouse: "タップ/ドラッグで進みたい方角を指す",
      touch: "タップ/ドラッグで進みたい方角を指す",
      keyboard: "←→・A/D: 舵を切る / Space: 一時停止 / R: ラウンドをリセット",
    },
    status: "prototype",
  },
  {
    slug: "grapple-arc",
    title: "Grapple Arc",
    description:
      "ロープにつかまって振り子の勢いだけで進み続ける、リアルタイム・グラップリングアクション。長押しでアンカーに掴まり、放して飛び、次のアンカーへ着地できるかは自分のタイミング次第。谷底に落ちたら終わり。",
    tags: ["arcade", "physics", "action", "realtime"],
    dimension: "2d",
    engine: "pixi",
    createdAt: "2026-09-14",
    controls: {
      mouse: "長押しでロープに掴まる、離すと放たれる",
      touch: "長押しでロープに掴まる、離すと放たれる",
      keyboard: "↑ / W: 長押しで掴まる / Space: 一時停止 / R: リセット",
    },
    status: "prototype",
  },
  {
    slug: "ferro-bloom",
    title: "Ferro Bloom",
    description:
      "砂鉄状の粒子を磁石で操るリアルタイム造形パズル。ドラッグで引き寄せ、タップで斥力に切り替えて押し広げ、粒子をリングの中に集めて満たし続けよう。",
    tags: ["arcade", "puzzle", "physics", "realtime"],
    dimension: "2d",
    engine: "pixi",
    createdAt: "2026-09-14",
    controls: {
      mouse: "ドラッグ/長押しで磁石を移動、タップで引力⇔斥力を切替",
      touch: "ドラッグ/長押しで磁石を移動、タップで引力⇔斥力を切替",
      keyboard: "矢印キー/WASD: 磁石を移動 / 1: 引力 / 2: 斥力 / Space: 一時停止 / R: リセット",
    },
    status: "prototype",
  },
  {
    slug: "high-wire",
    title: "High Wire",
    description:
      "風にあおられながら綱の上を渡り続けるリアルタイム・バランスアクション。傾いた方向と逆に体重をかけて踏みとどまり、道中のジェムを拾いながらどこまで渡り切れるか勝負しろ。風は時間とともに強くなる。",
    tags: ["arcade", "balance", "physics", "realtime"],
    dimension: "2d",
    engine: "pixi",
    createdAt: "2026-09-14",
    controls: {
      mouse: "画面の左右どちらかを長押しして体重をかける",
      touch: "画面の左右どちらかを長押しして体重をかける",
      keyboard: "←→・A/D: 長押しで体重をかける / Space: 一時停止 / R: リセット",
    },
    status: "prototype",
  },
  {
    slug: "rotor-drop",
    title: "Rotor Drop",
    description:
      "回転する釘のリングでマーブルを弾く、リアルタイム・ロータリーピンボール。左右長押しでリングを回してギャップを狙い定め、落ちてくるマーブルを中央のゴールへ導け。連続成功でコンボボーナス。",
    tags: ["arcade", "physics", "realtime"],
    dimension: "2d",
    engine: "pixi",
    createdAt: "2026-09-14",
    controls: {
      mouse: "画面の左右どちらかを長押ししてリングを回転",
      touch: "画面の左右どちらかを長押ししてリングを回転",
      keyboard: "←→・A/D: 長押しでリングを回転 / Space: 一時停止 / R: リセット",
    },
    status: "prototype",
  },
  {
    slug: "tide-keep",
    title: "Tide Keep",
    description:
      "満ちてくる潮から中央の砦を守り続けるリアルタイム築城サバイバル。ドラッグ/長押しで浜に砂を盛り、押し寄せる波が来る前に砦を要求高さまで保て。潮は徐々に満ち、波は次第に速く高くなる。",
    tags: ["arcade", "survival", "physics", "realtime"],
    dimension: "2d",
    engine: "pixi",
    createdAt: "2026-09-14",
    controls: {
      mouse: "ドラッグ/長押しで狙った場所に砂を盛る",
      touch: "ドラッグ/長押しで狙った場所に砂を盛る",
      keyboard: "←→・A/D: 長押しでショベルを移動しながら盛る / Space: 一時停止 / R: リセット",
    },
    status: "prototype",
  },
];
