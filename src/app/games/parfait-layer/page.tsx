import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { ParfaitLayerGame } from "./ParfaitLayerGame";

const meta = getGameBySlug("parfait-layer");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Parfait Layer"} | ai-game`,
  description: meta?.description,
};

export default function ParfaitLayerPage() {
  return <ParfaitLayerGame />;
}
