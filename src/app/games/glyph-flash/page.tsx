import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { GlyphFlashGame } from "./GlyphFlashGame";

const meta = getGameBySlug("glyph-flash");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Glyph Flash"} | ai-game`,
  description: meta?.description,
};

export default function GlyphFlashPage() {
  return <GlyphFlashGame />;
}
