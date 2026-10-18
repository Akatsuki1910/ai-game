import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { KanaTrailGame } from "./KanaTrailGame";

const meta = getGameBySlug("kana-trail");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Kana Trail"} | ai-game`,
  description: meta?.description,
};

export default function KanaTrailPage() {
  return <KanaTrailGame />;
}
