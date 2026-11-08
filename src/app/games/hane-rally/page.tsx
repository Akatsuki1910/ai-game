import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { HaneRallyGame } from "./HaneRallyGame";

const meta = getGameBySlug("hane-rally");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Hane Rally"} | ai-game`,
  description: meta?.description,
};

export default function HaneRallyPage() {
  return <HaneRallyGame />;
}
