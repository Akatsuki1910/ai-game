import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { KiteDuelGame } from "./KiteDuelGame";

const meta = getGameBySlug("kite-duel");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Kite Duel"} | ai-game`,
  description: meta?.description,
};

export default function KiteDuelPage() {
  return <KiteDuelGame />;
}
