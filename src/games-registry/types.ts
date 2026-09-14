export type GameDimension = "2d" | "3d";

export type GameEngine = "pixi" | "three" | "dom";

export interface GameControls {
  mouse?: string;
  keyboard?: string;
  touch?: string;
}

export interface GameMeta {
  /** URLパス /games/<slug> と src/app/games/<slug> ディレクトリ名。kebab-case。 */
  slug: string;
  title: string;
  /** 一覧カードに出す1〜2文の説明。 */
  description: string;
  tags: string[];
  dimension: GameDimension;
  engine: GameEngine;
  /** ISO 8601 (YYYY-MM-DD)。追加した日。一覧の新着順ソートに使う。 */
  createdAt: string;
  controls: GameControls;
  /** すべて prototype 想定。将来 polished 等を足す余地として型だけ用意。 */
  status: "prototype";
}
