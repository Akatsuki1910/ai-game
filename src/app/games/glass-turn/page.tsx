import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { GlassTurnGame } from "./GlassTurnGame";

const meta = getGameBySlug("glass-turn");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Glass Turn"} | ai-game`,
  description: meta?.description,
};

export default function GlassTurnPage() {
  return <GlassTurnGame />;
}
