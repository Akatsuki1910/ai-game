import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { SporeSurgeGame } from "./SporeSurgeGame";

const meta = getGameBySlug("spore-surge");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Spore Surge"} | ai-game`,
  description: meta?.description,
};

export default function SporeSurgePage() {
  return <SporeSurgeGame />;
}
