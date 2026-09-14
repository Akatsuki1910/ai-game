import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { LoomWeaveGame } from "./LoomWeaveGame";

const meta = getGameBySlug("loom-weave");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Loom Weave"} | ai-game`,
  description: meta?.description,
};

export default function LoomWeavePage() {
  return <LoomWeaveGame />;
}
