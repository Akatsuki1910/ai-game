import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { BellowsForgeGame } from "./BellowsForgeGame";

const meta = getGameBySlug("bellows-forge");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Bellows Forge"} | ai-game`,
  description: meta?.description,
};

export default function BellowsForgePage() {
  return <BellowsForgeGame />;
}
