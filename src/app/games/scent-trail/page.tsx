import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { ScentTrailGame } from "./ScentTrailGame";

const meta = getGameBySlug("scent-trail");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Scent Trail"} | ai-game`,
  description: meta?.description,
};

export default function ScentTrailPage() {
  return <ScentTrailGame />;
}
