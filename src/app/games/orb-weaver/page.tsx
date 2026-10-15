import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { OrbWeaverGame } from "./OrbWeaverGame";

const meta = getGameBySlug("orb-weaver");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Orb Weaver"} | ai-game`,
  description: meta?.description,
};

export default function OrbWeaverPage() {
  return <OrbWeaverGame />;
}
