import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { MothLanternGame } from "./MothLanternGame";

const meta = getGameBySlug("moth-lantern");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Moth Lantern"} | ai-game`,
  description: meta?.description,
};

export default function MothLanternPage() {
  return <MothLanternGame />;
}
