import { games } from "./games";
import type { GameMeta } from "./types";

export type { GameControls, GameDimension, GameEngine, GameMeta } from "./types";

/** 新しい順（createdAt 降順）で全ゲームを返す。トップページの一覧表示に使う。 */
export function getAllGames(): GameMeta[] {
  return [...games].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
  );
}

export function getGameBySlug(slug: string): GameMeta | undefined {
  return games.find((game) => game.slug === slug);
}
