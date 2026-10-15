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
  {
    slug: "powder-rush",
    title: "Powder Rush",
    description:
      "雪山を転がり落ちながら育つスノーボールのリアルタイム3Dサバイバル。新雪を巻き込んで大きくなり、小岩は十分育てば押しつぶせるが、木には必ずぶつかると縮む。何もしなくても陽射しで少しずつ縮み、縮みきると終了。",
    tags: ["arcade", "survival", "physics", "3d", "realtime"],
    dimension: "3d",
    engine: "three",
    createdAt: "2026-09-14",
    controls: {
      mouse: "ドラッグ/クリックした位置へスノーボールを移動",
      touch: "ドラッグした位置へスノーボールを移動",
      keyboard: "←→・A/D: 左右移動 / Space: 一時停止 / R: リセット",
    },
    status: "prototype",
  },
  {
    slug: "pulse-lock",
    title: "Pulse Lock",
    description:
      "回転する複数のタンブラーを、指針がターゲットゾーンに重なった瞬間にタップして解錠するリアルタイム・ロックピッキング。外すとライフが減り、解錠しきるたびにロックは増えて速く狭くなっていく。",
    tags: ["arcade", "timing", "precision", "realtime"],
    dimension: "2d",
    engine: "pixi",
    createdAt: "2026-09-14",
    controls: {
      mouse: "クリックで、狙ったリングのターゲットゾーンに指針が重なった瞬間に解錠",
      touch: "タップで、狙ったリングのターゲットゾーンに指針が重なった瞬間に解錠",
      keyboard: "Enter: 解錠を試みる / Space: 一時停止 / R: リセット",
    },
    status: "prototype",
  },
  {
    slug: "wheel-throw",
    title: "Wheel Throw",
    description:
      "回転するろくろの上で粘土を挽くリアルタイム陶芸パズル。水色の点線のお手本に壁の太さを近づけ、水分が尽きるか自分で仕上げて採点しよう。中心まで押し込みすぎると壁が崩れて0点になる。",
    tags: ["arcade", "puzzle", "craft", "realtime"],
    dimension: "2d",
    engine: "pixi",
    createdAt: "2026-09-14",
    controls: {
      mouse: "ドラッグで壁の太さを狙った位置へ押し出す、ボタンクリックで仕上げる",
      touch: "ドラッグで壁の太さを狙った位置へ押し出す、タップで仕上げる",
      keyboard:
        "矢印キー/WASD: 高さ選択+押し引き / Enter: 仕上げる / Space: 一時停止 / R: リセット",
    },
    status: "prototype",
  },
  {
    slug: "loom-weave",
    title: "Loom Weave",
    description:
      "刻々と示される糸色をリングが閉じきる前に選び続ける、リアルタイム機織りリズムパズル。外すたびに生地が傷んで耐久が減り、テンポは織るほど速くなる。目標の段数まで織り切れるか。",
    tags: ["arcade", "rhythm", "puzzle", "realtime"],
    dimension: "2d",
    engine: "pixi",
    createdAt: "2026-09-14",
    controls: {
      mouse: "クリックで指示された色のボタンを選ぶ",
      touch: "タップで指示された色のボタンを選ぶ",
      keyboard: "1: 藍 / 2: 金 / 3: 緋 / Space: 一時停止 / R: リセット",
    },
    status: "prototype",
  },
  {
    slug: "firefly-sync",
    title: "Firefly Sync",
    description:
      "暮れゆく草原でホタルの明滅を仲間の合唱へ導くリアルタイム同期パズル。タップで放つ光のパルスが群れの合意位相へ個体を引き寄せ、秩序変数を押し上げる。合唱計が満ちる前に日が沈むと夜が終わる。",
    tags: ["arcade", "puzzle", "sync", "realtime"],
    dimension: "2d",
    engine: "pixi",
    createdAt: "2026-09-14",
    controls: {
      mouse: "クリックで画面内にパルスを送る(エネルギーが必要)",
      touch: "タップで画面内にパルスを送る(エネルギーが必要)",
      keyboard: "Enter: 中央にパルスを送る / Space: 一時停止 / R: リセット",
    },
    status: "prototype",
  },
  {
    slug: "kite-duel",
    title: "Kite Duel",
    description:
      "凧糸で相手の凧糸を切り裂く、風祭りの凧合戦アクション。錨から伸びる自分の凧を旋回させて漂うライバルの凧糸に重ね、素早く揺さぶって断ち切ろう。風が絶えず糸を揺らすので気を抜くと逃げられる。",
    tags: ["arcade", "action", "realtime", "festival"],
    dimension: "2d",
    engine: "pixi",
    createdAt: "2026-09-15",
    controls: {
      mouse: "ドラッグで凧の向きを操作、相手の凧糸に重ねて素早く揺さぶり切る",
      touch: "ドラッグで凧の向きを操作、相手の凧糸に重ねて素早く揺さぶり切る",
      keyboard: "矢印キー/AD: 凧の向きを旋回 / Space: 一時停止 / R: ラウンドをリセット",
    },
    status: "prototype",
  },
  {
    slug: "switchboard-shift",
    title: "Switchboard Shift",
    description:
      "次々と鳴る回線を捌くリアルタイム交換手パズル。光る発信ジャックから同じ色の受信ジャックへケーブルをドラッグして繋ぎ、タイムアウトする前に接続せよ。誤接続や放置はライフを削り、鳴る回線は次第に増えて忙しくなる。",
    tags: ["arcade", "puzzle", "timing", "realtime"],
    dimension: "2d",
    engine: "pixi",
    createdAt: "2026-09-15",
    controls: {
      mouse: "光っている発信ジャックからドラッグし、同じ色の受信ジャックの上で放して接続",
      touch: "光っている発信ジャックからドラッグし、同じ色の受信ジャックの上で放して接続",
      keyboard:
        "1〜5: 発信ジャックを選択してケーブルを持つ、再度1〜5で相手ジャックへ接続 / Space: 一時停止 / R: リセット",
    },
    status: "prototype",
  },
  {
    slug: "gyro-vault",
    title: "Gyro Vault",
    description:
      "盤面を傾けてボールを転がすリアルタイム金庫破りパズル。落とし穴を避けながらチェックポイントを踏み、奥の宝石ゴールへたどり着け。ゴールするたびに次の金庫室はより複雑になる。",
    tags: ["arcade", "puzzle", "physics", "realtime"],
    dimension: "2d",
    engine: "pixi",
    createdAt: "2026-09-15",
    controls: {
      mouse: "ドラッグした方向・距離で盤面を傾ける",
      touch: "ドラッグした方向・距離で盤面を傾ける",
      keyboard: "矢印キー/WASD: 盤面を傾ける / Space: 一時停止 / R: リセット",
    },
    status: "prototype",
  },
  {
    slug: "grain-scale",
    title: "Grain Scale",
    description:
      "天秤の両皿に降り注ぐ砂を注ぎ分け、目標の重さで釣り合わせ続けるリアルタイム・バランスパズル。砂を落とす壺をドラッグして左右に動かし、傾きすぎて砂がこぼれる前に両皿を目標の帯へ収めよう。",
    tags: ["arcade", "balance", "puzzle", "realtime"],
    dimension: "2d",
    engine: "pixi",
    createdAt: "2026-09-15",
    controls: {
      mouse: "ドラッグで砂を注ぐ壺を左右に移動",
      touch: "ドラッグで壺を左右に移動",
      keyboard: "矢印キー/AD: 壺を移動 / Space: 一時停止 / R: ラウンドをリセット",
    },
    status: "prototype",
  },
  {
    slug: "frost-curl",
    title: "Frost Curl",
    description:
      "氷上でストーンを滑らせるリアルタイム・カーリング物理パズル。ドラッグで引いて離すと逆方向へ投球し、飛行中は長押しでスイープして摩擦とカールを抑えられる。ホグラインを越えないとバーン、エンドを重ねるほどガードが増えて狙いにくくなる。",
    tags: ["arcade", "physics", "curling", "realtime"],
    dimension: "2d",
    engine: "pixi",
    createdAt: "2026-09-15",
    controls: {
      mouse: "ドラッグして引っ張り離すと投球、飛行中は長押しでスイープ",
      touch: "ドラッグして引っ張り離すと投球、飛行中は長押しでスイープ",
      keyboard:
        "矢印キー: 角度/パワー調整 / Enter: 投球 / Sキー長押し: スイープ / 1・2: カール方向 / Space: 一時停止 / R: リセット",
    },
    status: "prototype",
  },
  {
    slug: "spindle-circus",
    title: "Spindle Circus",
    description:
      "5本の柱で回る皿を落とす前にタップしてスピンをかけ直し続けるリアルタイム皿回しジャグリング。ぎりぎりで回すほど高得点だが、目を離すと皿は落ちてライフが減る。柱は次々増え、ぐらつく速さも徐々に上がる。",
    tags: ["arcade", "juggling", "timing", "realtime"],
    dimension: "2d",
    engine: "pixi",
    createdAt: "2026-09-15",
    controls: {
      mouse: "回っている柱をクリックしてスピンをかけ直す",
      touch: "回っている柱をタップしてスピンをかけ直す",
      keyboard: "1〜5: 対応する柱にスピンをかけ直す / Space: 一時停止 / R: リセット",
    },
    status: "prototype",
  },
  {
    slug: "gold-seam",
    title: "Gold Seam",
    description:
      "割れた器を金継ぎで直すリアルタイム集中力パズル。ひびの始点からポインタを離さずになぞり続けて金を継ごう。経路を外れると金粉が無駄になり、尽きると器は割れてしまう。",
    tags: ["arcade", "puzzle", "precision", "craft", "realtime"],
    dimension: "2d",
    engine: "pixi",
    createdAt: "2026-09-15",
    controls: {
      mouse: "ドラッグでひびの始点からポインタを進め、なぞって金を継ぐ",
      touch: "ドラッグでひびの始点からポインタを進め、なぞって金を継ぐ",
      keyboard: "Space: 一時停止 / R: リセット",
    },
    status: "prototype",
  },
  {
    slug: "signal-lantern",
    title: "Signal Lantern",
    description:
      "灯台の光の長さを読んで打ち返す、モールス信号風リアルタイム・タイミングパズル。短い点滅(点)には短く、長い点滅(線)には長くレバーを握って応答しよう。ラウンドを重ねるほど信号数が増え、応答の制限時間も縮む。",
    tags: ["arcade", "timing", "rhythm", "realtime"],
    dimension: "2d",
    engine: "pixi",
    createdAt: "2026-09-15",
    controls: {
      mouse: "画面を長押しして離す(長押し時間で点/線を選ぶ)",
      touch: "画面を長押しして離す(長押し時間で点/線を選ぶ)",
      keyboard: "Enterキー長押しで応答 / Space: 一時停止 / R: リセット",
    },
    status: "prototype",
  },
  {
    slug: "kendama-swing",
    title: "Kendama Swing",
    description:
      "紐でつながった玉をカップで操るリアルタイム剣玉アクション。カップをドラッグして玉を振り上げ、受け口に飛び込んだ瞬間にキャッチしてコンボを繋ごう。キャッチするほど受け口は狭く玉は速くなり、床に落とすとライフが減る。",
    tags: ["arcade", "physics", "timing", "realtime"],
    dimension: "2d",
    engine: "pixi",
    createdAt: "2026-09-15",
    controls: {
      mouse: "ドラッグ/長押しでカップを移動",
      touch: "ドラッグ/長押しでカップを移動",
      keyboard: "矢印キー/WASD: カップを移動 / Space: 一時停止 / R: リセット",
    },
    status: "prototype",
  },
  {
    slug: "dohyo-duel",
    title: "Dohyo Duel",
    description:
      "土俵の中央でせめぎ合うリアルタイム押し相撲。長押しでためて離すと押し込め、相手の突き直後に押し返すと会心の反撃になる。ため中に突かれると大きく崩されるので駆け引きが重要。土俵の外まで押し切れば勝ち、3敗で本日の取組終了。",
    tags: ["arcade", "action", "timing", "realtime"],
    dimension: "2d",
    engine: "pixi",
    createdAt: "2026-09-15",
    controls: {
      mouse: "長押しでため、離すと押し込む",
      touch: "長押しでため、離すと押し込む",
      keyboard: "Enter: 長押しでため、離すと押し込む / Space: 一時停止 / R: リセット",
    },
    status: "prototype",
  },
  {
    slug: "topiary-trim",
    title: "Topiary Trim",
    description:
      "円形の目標シルエットからはみ出す前に枝を刈り込み続けるリアルタイム剪定パズル。放射状に伸びる枝をタップ/クリックで剪定し、はみ出したまま放置すると枝が折れて体力が減る。刈り込むほど充填率が上がりスコアが伸びる。",
    tags: ["arcade", "puzzle", "precision", "realtime"],
    dimension: "2d",
    engine: "pixi",
    createdAt: "2026-09-15",
    controls: {
      mouse: "はみ出した枝をクリックして剪定",
      touch: "はみ出した枝をタップして剪定",
      keyboard:
        "矢印キー/AD: シアーを回転 / Enter: シアーの位置で剪定 / Space: 一時停止 / R: リセット",
    },
    status: "prototype",
  },
  {
    slug: "shadow-cast",
    title: "Shadow Cast",
    description:
      "光源とスクリーンの間で人形を操り、壁に映る影の位置と大きさをお題にぴったり重ねて保ち続けるリアルタイム影絵パズル。光源に近づくほど影は大きく映るが、左右に動かせる幅は狭くなる。重ねるほどお題は厳しく速くなる。",
    tags: ["arcade", "puzzle", "light", "realtime"],
    dimension: "2d",
    engine: "pixi",
    createdAt: "2026-09-15",
    controls: {
      mouse: "ドラッグで人形を移動(上下で光源からの距離、左右で位置)",
      touch: "ドラッグで人形を移動(上下で光源からの距離、左右で位置)",
      keyboard: "矢印キー/WASD: 人形を移動 / Space: 一時停止 / R: リセット",
    },
    status: "prototype",
  },
  {
    slug: "bellows-forge",
    title: "Bellows Forge",
    description:
      "温度帯を保ちながら金属を打つリアルタイム鍛冶パズル。左を長押しして送風し、ゲージの目標帯に温度が入ったら右をタップして打とう。帯を外すと品質が減り、送風しすぎて振り切ると焦げついて減点される。",
    tags: ["arcade", "puzzle", "craft", "realtime"],
    dimension: "2d",
    engine: "pixi",
    createdAt: "2026-09-15",
    controls: {
      mouse: "左側を長押しで送風、右側をクリックで打つ",
      touch: "左側を長押しで送風、右側をタップで打つ",
      keyboard: "W/↑: 長押しで送風 / S・↓・Enter: 打つ / Space: 一時停止 / R: リセット",
    },
    status: "prototype",
  },
  {
    slug: "dandelion-gale",
    title: "Dandelion Gale",
    description:
      "綿毛の種を風で操るリアルタイム・サバイバルパズル。ドラッグ/長押しした位置から吹く風で種を反対側へ押し、点在する花畑へ届け続けよう。降ってくる雨粒に当たるとライフが減り、コンボが増えるほど雨は激しくなる。",
    tags: ["arcade", "survival", "physics", "realtime"],
    dimension: "2d",
    engine: "pixi",
    createdAt: "2026-09-15",
    controls: {
      mouse: "ドラッグ/長押しした位置から風を送り、種を反対側へ押し出す",
      touch: "ドラッグ/長押しした位置から風を送り、種を反対側へ押し出す",
      keyboard: "矢印キー/WASD: 押し出す方向を指定 / Space: 一時停止 / R: リセット",
    },
    status: "prototype",
  },
  {
    slug: "constellation-echo",
    title: "Constellation Echo",
    description:
      "星座の光る順番を覚えて同じ順にタップし直すリアルタイム記憶パズル。星をつなぐ光の軌跡を一度だけ見せてもらえるので、消える前に順路を頭に焼き付けよう。クリアするたびに手順は1つずつ長くなる。",
    tags: ["arcade", "puzzle", "memory", "realtime"],
    dimension: "2d",
    engine: "pixi",
    createdAt: "2026-09-15",
    controls: {
      mouse: "光った順に星をクリックして選ぶ",
      touch: "光った順に星をタップして選ぶ",
      keyboard: "1〜8: 対応する星を選択 / Space: 一時停止 / R: リセット",
    },
    status: "prototype",
  },
  {
    slug: "talon-dive",
    title: "Talon Dive",
    description:
      "巣とライバルの鷹の間で獲物を狩り続けるリアルタイム狩猟シミュレーター。ドラッグした方向へ隼を滑空させて逃げる獲物を仕留めよう。巣の外ではスタミナが減り続け、尽きる前に戻らないと力尽きる。ライバルに先を越されるとストリークが切れる。",
    tags: ["arcade", "hunting", "physics", "realtime"],
    dimension: "2d",
    engine: "pixi",
    createdAt: "2026-09-22",
    controls: {
      mouse: "ドラッグ/長押しした方向へ隼を滑空させる",
      touch: "ドラッグ/長押しした方向へ隼を滑空させる",
      keyboard: "矢印キー/WASD: 滑空方向を指定 / Space: 一時停止 / R: リセット",
    },
    status: "prototype",
  },
  {
    slug: "thermal-glider",
    title: "Thermal Glider",
    description:
      "紙飛行機で上昇気流(サーマル)を捕まえながら飛び続けるリアルタイム3Dグライダー。左右で旋回、上下で昇降しながらオレンジ色のサーマルに入って高度を稼ごう。何もしなければ重力で沈み、鳥にぶつかると高度が大きく減って0になると墜落する。",
    tags: ["arcade", "flight", "physics", "3d", "realtime"],
    dimension: "3d",
    engine: "three",
    createdAt: "2026-09-25",
    controls: {
      mouse: "ドラッグ/長押しした位置へ旋回、上下位置で昇降を操作",
      touch: "ドラッグ/長押しした位置へ旋回、上下位置で昇降を操作",
      keyboard: "矢印キー/WASD: 旋回(左右)・昇降(上下) / Space: 一時停止 / R: リセット",
    },
    status: "prototype",
  },
  {
    slug: "shredder-line",
    title: "Shredder Line",
    description:
      "ベルトコンベアを流れるスクラップを同じ色のシュートへ仕分け続けるリアルタイム工場パズル。ドラッグで掴んでシュートへ投入し、シュレッダーに届く前に捌き切れ。捌くほどベルトは速く、出現間隔も短くなる。",
    tags: ["arcade", "sorting", "industrial", "realtime"],
    dimension: "2d",
    engine: "pixi",
    createdAt: "2026-10-01",
    controls: {
      mouse: "ドラッグでスクラップを掴み、同じ色のシュートの上で離して投入",
      touch: "ドラッグでスクラップを掴み、同じ色のシュートの上で離して投入",
      keyboard:
        "1〜3: 最も危険なスクラップを対応するシュートへ即投入 / Space: 一時停止 / R: リセット",
    },
    status: "prototype",
  },
  {
    slug: "senko-spark",
    title: "Senko Spark",
    description:
      "線香花火の火球をできるだけ揺らさずに持ち続けるリアルタイム集中力パズル。持ち手を素早く動かすと火球が離れて不安定になり、安定度が尽きると火球が落ちて終わる。漂う火花をタップで掬うとボーナスだが、掬う反動で火球が跳ねるリスクもある。",
    tags: ["arcade", "precision", "balance", "realtime"],
    dimension: "2d",
    engine: "pixi",
    createdAt: "2026-10-09",
    controls: {
      mouse: "ドラッグ/長押しで持ち手を動かす、動かさずタップで近くの火花を掬う",
      touch: "ドラッグ/長押しで持ち手を動かす、動かさずタップで近くの火花を掬う",
      keyboard: "矢印キー/WASD: 持ち手を移動 / Enter: 火花を掬う / Space: 一時停止 / R: リセット",
    },
    status: "prototype",
  },
  {
    slug: "blackout-ferry",
    title: "Blackout Ferry",
    description:
      "夜の海峡をサーチライトから隠れながら渡るリアルタイム潜入ボート。回転するサーチライトに照らされ続けると疑心度が満ちて拿捕されてしまう。ブーストで速く渡れるが、照らされたときのリスクも増す。渡り切るたびに次の航海はサーチライトが増える。",
    tags: ["arcade", "stealth", "realtime", "night"],
    dimension: "2d",
    engine: "pixi",
    createdAt: "2026-09-19",
    controls: {
      mouse: "ドラッグ/クリックした位置へ舟を左右に操舵、ボタン長押しでブースト",
      touch: "ドラッグ/タップした位置へ舟を左右に操舵、ボタン長押しでブースト",
      keyboard: "矢印キー/AD: 操舵 / Shift長押し: ブースト / Space: 一時停止 / R: リセット",
    },
    status: "prototype",
  },
  {
    slug: "rapids-slalom",
    title: "Rapids Slalom",
    description:
      "急流を下るリアルタイム・スラロームカヤック。緑のゲートはそのまま、赤のゲートはブレース(パドルで身構える)しながら通過し、流れてくる岩を避けよう。コンボが伸びるほど流れは速く、ゲートの隙間は狭くなる。",
    tags: ["arcade", "sports", "physics", "realtime"],
    dimension: "2d",
    engine: "pixi",
    createdAt: "2026-09-27",
    controls: {
      mouse: "ドラッグ/クリックした位置へ操舵。クリックでブレースも発動",
      touch: "ドラッグ/タップした位置へ操舵。タップでブレースも発動",
      keyboard: "矢印キー/AD: 操舵 / Enter: ブレース発動 / Space: 一時停止 / R: リセット",
    },
    status: "prototype",
  },
  {
    slug: "ember-loft",
    title: "Ember Loft",
    description:
      "バーナーの熱で高度を操るリアルタイム熱気球サバイバル。低層・中層・高層で強さの変わる風を読んで追い風の層へ移り、雲や鳥を避けながら上昇気流のオーブを集めよう。熱を失って地面に触れると即座に墜落する。",
    tags: ["arcade", "survival", "physics", "realtime"],
    dimension: "2d",
    engine: "pixi",
    createdAt: "2026-09-26",
    controls: {
      mouse: "画面を長押しでバーナー点火(上昇)、離すと冷えて下降",
      touch: "画面を長押しでバーナー点火(上昇)、離すと冷えて下降",
      keyboard: "↑・W: 長押しでバーナー点火 / Space: 一時停止 / R: リセット",
    },
    status: "prototype",
  },
  {
    slug: "sensu-fold",
    title: "Sensu Fold",
    description:
      "紙の扇(せんす)を1枚ずつ折りたたむリアルタイム折り紙パズル。上下の動きで折り角度を合わせ、揺れ動くターゲット帯に重なったところでピン留めしよう。外すと紙が傷み、畳み終えるほど扇は長く目標帯は細く速くなる。",
    tags: ["arcade", "puzzle", "precision", "craft", "3d", "realtime"],
    dimension: "3d",
    engine: "three",
    createdAt: "2026-09-30",
    controls: {
      mouse: "ポインタを上下に動かして折り角度を調整、クリックでその角度にピン留め",
      touch: "ドラッグして折り角度を調整、指を離すとその角度にピン留め",
      keyboard: "↑↓・W/S: 折り角度を調整 / Enter: ピン留め / Space: 一時停止 / R: リセット",
    },
    status: "prototype",
  },
  {
    slug: "flail-ward",
    title: "Flail Ward",
    description:
      "鎖につながったフレイル(鉄球)を振り回して中央のコアを守るリアルタイム防衛パズル。ポインタの方向へバネ物理で追従する鉄球で、四方から迫るメテオを弾き返せ。コアに当たるとライフが減り、時間とともにメテオは増え速くなる。",
    tags: ["arcade", "physics", "defense", "realtime"],
    dimension: "2d",
    engine: "pixi",
    createdAt: "2026-10-04",
    controls: {
      mouse: "ドラッグ/長押しでフレイルをポインタの方向へ振り回す",
      touch: "ドラッグ/長押しでフレイルをポインタの方向へ振り回す",
      keyboard: "矢印キー/A・D: フレイルを回転 / Space: 一時停止 / R: リセット",
    },
    status: "prototype",
  },
  {
    slug: "orb-weaver",
    title: "Orb Weaver",
    description:
      "巣を守る蜘蛛となり、糸を伝って中心へ迫る虫を捕獲圏のタイミングで弾き落とすリアルタイム反射神経パズル。中心まで到達されると糸が破れ、補修するまでその糸では虫を捕らえられなくなる。",
    tags: ["arcade", "reflex", "precision", "realtime"],
    dimension: "2d",
    engine: "pixi",
    createdAt: "2026-10-07",
    controls: {
      mouse: "クリックで糸を選び、虫が光る捕獲圏に入った瞬間に弾く。破れた糸は長押しで補修",
      touch: "タップで糸を選び、虫が光る捕獲圏に入った瞬間に弾く。破れた糸は長押しで補修",
      keyboard: "1〜6: 対応する糸を選択・捕獲(長押しで補修) / Space: 一時停止 / R: リセット",
    },
    status: "prototype",
  },
  {
    slug: "prize-crane",
    title: "Prize Crane",
    description:
      "レール上のクレーンを操るリアルタイム・クレーンゲーム。狙いを定めて降ろし、つかんだ景品を振り落とさないよう搬出口まで運んで獲得しよう。アテンプトは限られており、獲得を重ねるほどつかめる許容は狭く、動きも速くなる。",
    tags: ["arcade", "precision", "crane", "realtime"],
    dimension: "2d",
    engine: "pixi",
    createdAt: "2026-10-02",
    controls: {
      mouse: "ドラッグでクレーンを左右に移動、ボタンクリックで降ろす/置く",
      touch: "ドラッグでクレーンを左右に移動、ボタンタップで降ろす/置く",
      keyboard: "←→・A/D: クレーンを移動 / Enter: 降ろす・置く / Space: 一時停止 / R: リセット",
    },
    status: "prototype",
  },
  {
    slug: "rapids-weave",
    title: "Rapids Weave",
    description:
      "急流を下り続けるリアルタイム・カヤックウィーヴィング。左右に傾けて岩と岸を避け、ブイの間を通り抜けてコンボを稼げ。流れは時間とともに速くなり、川幅も次第に狭くなる。",
    tags: ["arcade", "survival", "physics", "realtime"],
    dimension: "2d",
    engine: "pixi",
    createdAt: "2026-10-05",
    controls: {
      mouse: "ドラッグ/長押しした位置へカヤックを傾けて操舵",
      touch: "ドラッグ/長押しした位置へカヤックを傾けて操舵",
      keyboard: "矢印キー/AD: 長押しで左右に傾ける / Space: 一時停止 / R: リセット",
    },
    status: "prototype",
  },
  {
    slug: "rail-weaver",
    title: "Rail Weaver",
    description:
      "峡谷を渡るトロッコの前方に途切れたレールが現れ続けるリアルタイム補修パズル。近づいたら画面をタップして板を渡し、板の在庫が尽きたり補修が遅れたりすると脱線する。進むほどトロッコは速くなり、レールの切れ目も頻発する。",
    tags: ["arcade", "survival", "timing", "realtime"],
    dimension: "2d",
    engine: "pixi",
    createdAt: "2026-10-03",
    controls: {
      mouse: "キャンバスをクリックして最も近いレールの切れ目に板を渡す",
      touch: "キャンバスをタップして最も近いレールの切れ目に板を渡す",
      keyboard: "Enter: 板を渡す / Space: 一時停止 / R: リセット",
    },
    status: "prototype",
  },
  {
    slug: "glass-turn",
    title: "Glass Turn",
    description:
      "炉から取り出した玉を膨らませて狙った大きさに仕上げるリアルタイム吹きガラス工芸パズル。長押しで送風しながら左右に振って転がし、歪みを抑えつつ目標の帯で仕上げよう。膨らませすぎれば割れ、転がし忘れれば歪んで崩れる。",
    tags: ["arcade", "puzzle", "craft", "realtime"],
    dimension: "2d",
    engine: "pixi",
    createdAt: "2026-10-11",
    controls: {
      mouse: "長押しで送風(膨らむ)、押しながら左右に振って転がす、ボタンクリックで仕上げる",
      touch: "長押しで送風(膨らむ)、押しながら左右に振って転がす、タップで仕上げる",
      keyboard: "Enter長押し: 送風 / ←→・AD: 転がす / F: 仕上げる / Space: 一時停止 / R: リセット",
    },
    status: "prototype",
  },
  {
    slug: "holding-pattern",
    title: "Holding Pattern",
    description:
      "計器のない管制塔から複数の機体を誘導するリアルタイム航空管制パズル。機体をドラッグで選び、滑走路の先に立つビーコンまで狙いを引き延ばして方位を揃え、着陸させ続けよう。機体同士を接近させすぎず、燃料が尽きる前に導けるかが勝負。",
    tags: ["arcade", "simulation", "routing", "realtime"],
    dimension: "2d",
    engine: "pixi",
    createdAt: "2026-10-10",
    controls: {
      mouse: "機体をドラッグして選択し、狙いたい方角まで引き延ばして方位を設定",
      touch: "機体をドラッグして選択し、狙いたい方角まで引き延ばして方位を設定",
      keyboard:
        "N: 最も燃料が少ない機体を選択 / ←→・A・D: 選択機の方位を回転 / Space: 一時停止 / R: リセット",
    },
    status: "prototype",
  },
  {
    slug: "cornice-watch",
    title: "Cornice Watch",
    description:
      "山の斜面に積もる雪を人為的に崩し続けて麓の集落を雪崩から守るリアルタイム防災シミュレーター。レーンをタップして予防的に雪を落とせるが、際どく溜め込んでからの解放は高得点な代わりに隣のレーンへ飛び火する。放置してレーンが満杯になると集落に直撃してダメージが入る。",
    tags: ["arcade", "management", "survival", "realtime"],
    dimension: "2d",
    engine: "pixi",
    createdAt: "2026-09-23",
    controls: {
      mouse: "レーンをクリックして人為的に雪を崩す",
      touch: "レーンをタップして人為的に雪を崩す",
      keyboard: "1〜6: 対応するレーンを崩す / Space: 一時停止 / R: リセット",
    },
    status: "prototype",
  },
  {
    slug: "nigiri-rush",
    title: "Nigiri Rush",
    description:
      "回転寿司のレーンから注文と同じネタだけを狙って取るリアルタイム仕分けパズル。注文はネタを取るたびに変わり、違うネタを取る・わさびに触れる・注文を取り逃すといずれもライフが減る。連続成功で流れは速く忙しくなる。",
    tags: ["arcade", "puzzle", "timing", "realtime"],
    dimension: "2d",
    engine: "pixi",
    createdAt: "2026-09-20",
    controls: {
      mouse: "注文と同じネタがあるレーンのボタンをクリックして取る",
      touch: "注文と同じネタがあるレーンのボタンをタップして取る",
      keyboard: "1〜3: 対応するレーンを取る / Space: 一時停止 / R: リセット",
    },
    status: "prototype",
  },
];
