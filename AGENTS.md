<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# ai-game プロジェクトについて

「作り続けるプロトタイプWebゲーム集」。1つの Next.js (App Router) プロジェクトの中に
ゲームをどんどん追加していくリポジトリです。**完成度より本数とアイデアの面白さを優先**します。
以降このリポジトリで作業するときは、以下のルールに従ってください。

## 技術スタック

- Next.js 16 (App Router) + TypeScript + SCSS（CSS Modules）
- Lint / Format: Biome（ESLint/Prettierは使わない。`next lint` はNext16で廃止済み）
- 2D: [pixi.js](https://pixijs.com/) v8
- 3D: [three.js](https://threejs.org/)
- GLSL: pixi.js の `Filter` / `GlProgram` 経由、または three.js の `ShaderMaterial` で自由に使ってよい
- パッケージマネージャ: npm

Next.js 16 は破壊的変更が多いバージョンです。書き方に迷ったら
`node_modules/next/dist/docs/` 配下の同梱ドキュメントを読んでください（このファイル冒頭の
`nextjs-agent-rules` ブロック参照）。特に **`params` / `searchParams` は Promise（`await`
必須）**、Turbopackがデフォルト、`next lint` 廃止、といった点は要注意です。

## ディレクトリ構成

```
src/
  app/
    layout.tsx            # ルートレイアウト（フォント読み込みはしない。globals.scssのみ）
    page.tsx               # トップページ（ゲーム一覧。games-registry から自動生成）
    globals.scss
    games/
      <slug>/               # ゲーム1本 = 1ディレクトリ。ルーティングは /games/<slug>
        page.tsx            # サーバーコンポーネント。metadataを games-registry から生成して
                             #   クライアントコンポーネントを描画するだけの薄いラッパー
        <GameName>Game.tsx  # "use client"。pixi.js/three.jsの初期化・ゲームループ・入力を束ねる本体
        <GameName>Game.module.scss
        engine/             # そのゲーム専用のロジック（物理・盤面・シェーダーなど）
          world.ts
          ...
  games-registry/
    types.ts               # GameMeta 型定義
    games.ts                # ★ゲームを追加したらここに1件追記する★
    index.ts                # getAllGames() / getGameBySlug() をエクスポート
  shared/
    engine/                 # 全ゲーム共通のロジック層（Reactにもpixi/threeにも依存しない部分は極力Reactにも依存させない）
      GameLoop.ts            # requestAnimationFrame のラッパー。pause/resume/delta clamp付き
      useElementSize.ts      # ResizeObserverでステージのCSSサイズを取得するフック
      input/
        InputManager.ts      # マウス/タッチ/ペン(PointerEvent)とキーボードを統一APIで扱う
      index.ts                # 上記のバレルエクスポート。ゲーム側は `@/shared/engine` から import する
    ui/
      GameShell.tsx           # 戻る導線・タイトル・スコア・一時停止ボタン/オーバーレイの共通シェル
      GameShell.module.scss
      index.ts
    styles/
      _variables.scss         # 色・余白・ブレークポイントなどのデザイントークン
      _mixins.scss            # mobile()/tablet-down()/touch-safe() などのミキシン
```

## ゲームの追加手順

1. **ディレクトリを作る**: `src/app/games/<slug>/` （`<slug>` はkebab-case。英語の短い名前）
2. **ページを実装する**:
   - `page.tsx`: サーバーコンポーネント。`getGameBySlug("<slug>")` から `metadata` (title/description) を組み立て、
     クライアントコンポーネントをレンダリングするだけにする（既存の `games/prism-drift/page.tsx` を参照）。
   - `<GameName>Game.tsx`: `"use client"`。ゲーム本体。下記の共通モジュールを使う。
   - ゲーム固有のロジックは `engine/` サブディレクトリに逃がし、Reactやpixi/threeへの依存を最小限にすると
     テスト・調整がしやすい（`games/prism-drift/engine/world.ts` が参考例）。
3. **レジストリに登録する**: `src/games-registry/games.ts` の `games` 配列に1件追加する。
   `slug` はディレクトリ名と一致させること。これだけでトップページの一覧に自動で出る
   （一覧側のコードは変更不要）。
4. **確認する**:
   ```bash
   npm run lint    # biome check .
   npm run build   # next build（型チェックも含む）
   npm run dev     # 実際にブラウザ（PC幅・スマホ幅の両方）で操作して確認する
   ```
   dev サーバーは `.claude/launch.json` の `ai-game-dev` 設定で起動できる。

### GameMeta（レジストリの1件）の書き方

`src/games-registry/types.ts` を参照。特に迷いやすい項目:

- `dimension`: `"2d"` (pixi.js) か `"3d"` (three.js)。DOM/CSSだけのミニゲームなら `engine: "dom"` も可。
- `createdAt`: `YYYY-MM-DD`。一覧の新着順ソートに使われる。
- `controls`: `mouse` / `touch` / `keyboard` のうち実際に使うものだけ日本語で1行ずつ書く。
  一覧には出ないが、ゲーム画面内のヒント文言などと一致させておくと親切。
- `status`: 今のところ全部 `"prototype"` 固定でよい。

## 共通モジュールの使い方

- **ゲームループ**: `new GameLoop((deltaSeconds, elapsedSeconds) => { ... }, maxDeltaSeconds?)` を作り
  `.start()` する。タブが非アクティブな間は `deltaSeconds` が `maxDeltaSeconds`（既定0.1秒）でクランプされるため、
  巻き戻ってきたときに物理が破綻しない。`.pause()` / `.resume()` / `.togglePause()` で一時停止を扱う。
- **リサイズ対応**: `useElementSize<HTMLDivElement>()` でステージ用divのCSSピクセルサイズを取得し、
  そのサイズをゲーム側のワールド/レンダラーに反映する（pixi.jsなら `Application.init({ resizeTo: hostElement })`
  で canvas 自体は自動追従させつつ、ゲームロジック側の座標系は `useElementSize` の値で更新するのが素直）。
- **入力の抽象化**: `new InputManager(canvasElement)` を作り `addListener({ onPointerDown, onPointerMove,
  onPointerUp, onKeyDown, onKeyUp })` を登録する。`PointerEvent` を使っているためマウス・タッチ・ペンは
  自動的に同じ `PointerState`（ローカル座標・pointerId・isPrimary等）に正規化される。ジェスチャ判定
  （タップ/ドラッグの区別など）は各ゲーム側で `startX/startY` との距離から組み立てる
  （`prism-drift` の実装を参照）。使い終わったら必ず `.dispose()` する。
- **共通UIシェル**: `<GameShell title score isPaused onTogglePause>{children}</GameShell>` が
  戻る導線・タイトル・スコア表示・一時停止ボタンとオーバーレイを提供する。`children` に
  canvasをマウントするdivなどを渡す。スコアやポーズを使わないゲームはそれぞれ省略可能。

## 命名規則

- ゲームのURLスラッグ・ディレクトリ名: `kebab-case`（例: `prism-drift`）
- Reactコンポーネント/ファイル: `PascalCase.tsx`（例: `PrismDriftGame.tsx`）
- CSS Modulesのクラス名: `camelCase`（Biomeの対象外だが慣習として統一する）
- 共通モジュールは `shared/engine` と `shared/ui` の2系統のみ。増やす場合も
  「Reactに依存しないロジック」と「UI」で分ける方針を崩さない。

## コーディング規約 / 品質チェック

- Lintは **Biome** のみ（`npm run lint` / 自動修正は `npm run lint:fix`）。ESLintやPrettierの設定は追加しない。
- `.scss` / `.css` は Biome の対象外（`biome.json` の `files.includes` で除外済み）。SCSSの構文チェックは
  `next build` 時のコンパイルエラーで代用する。
- スタイルは基本 SCSS Modules（`*.module.scss`）。色や余白は `shared/styles/_variables.scss` の
  トークンを `@use "....../shared/styles/variables" as v;` で読み込んで使う（相対パス。Sass側は
  tsconfigのpathエイリアスを解決できないため `@/` は使えない）。
- TypeScriptの `@/*` エイリアス（`src/*` を指す）はTS/TSXファイルからのみ使用する。
- コメントは「なぜ」を書く場合のみ。自明な処理へのコメントは書かない。
- 新しい依存を追加したら `package.json` に反映されているか確認し、本当に必要なものだけ入れる。

## 既知のハマりどころ（pixi.js v8 カスタムGLSLフィルタ）

`Filter` + `GlProgram.from` で自作シェーダーを書く場合、`uInputSize` のような共通ユニフォームを
フラグメントシェーダー側で使うときは **`uniform highp vec4 uInputSize;` のように明示的に `highp` を
付けないと頂点シェーダー側との精度不一致でリンクエラーになる**（`pixi.js/lib/filters/defaults/displacement/displacement.frag`
が実例）。

さらに、`texture()` で入力テクスチャをオフセットサンプリングして光彩(ブルーム)を作る場合、
**対象コンテナのバウンディングボックスが小さい/細い（線1本など）と、`padding` を付けても
狙った量のグローが乗らずほぼ見えなくなることがある**（`vTextureCoord` の有効範囲やクランプの都合）。
背景全体を覆う演出など、**フィルタ対象の矩形をステージと同サイズにして `uTexture` を一切サンプリングせず
`vTextureCoord` と時間経過(`uTime`)だけで色を作る**（`games/prism-drift/engine/backgroundFilter.ts` が実例）
方が安定して確実に見える。細い図形への後光表現をやりたい場合は、Pixi標準の `BlurFilter` +
`blendMode: "add"` の組み合わせを先に試すこと。

## やってはいけないこと

- **既存のゲームを壊さない**。`shared/` を変更するときは、既存の全ゲーム（現状: prism-drift）が
  `npm run build` を通ることを必ず確認する。破壊的変更が必要なら、まず全ゲームの呼び出し側を追従させる。
- 既存ゲームの `slug`（URL）を後から変えない。リンク切れの原因になる。
- `next lint` や ESLint を追加しない（Biomeに一本化する）。
- `--no-verify` 等でチェックをスキップしない。lint/buildが通らない状態でコミットしない。
- 凝りすぎない。1本のゲームに何日もかけない。プロトタイプとして「動く・面白い」を最優先し、
  演出やバランス調整はやりすぎない。
- ゲームごとに新しいライブラリを気軽に増やさない。2D=pixi.js、3D=three.js、状態管理やユーティリティは
  基本Reactの標準機能で足りる範囲に留める。

## 運用メモ（スケジュール実行について）

このプロジェクトは「定期的に1本ずつゲームを追加していく」運用を想定している。実行主体（人間 or
自動実行エージェント）が変わっても迷わないよう、この AGENTS.md を常に最新に保つこと。
実際のスケジューリング（cron等での定期起動設定）は本ドキュメントの範囲外で、別途設定する。

