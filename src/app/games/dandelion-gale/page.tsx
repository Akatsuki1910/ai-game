import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { DandelionGaleGame } from "./DandelionGaleGame";

const meta = getGameBySlug("dandelion-gale");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Dandelion Gale"} | ai-game`,
  description: meta?.description,
};

export default function DandelionGalePage() {
  return <DandelionGaleGame />;
}
