import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { BeigomaDuelGame } from "./BeigomaDuelGame";

const meta = getGameBySlug("beigoma-duel");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Beigoma Duel"} | ai-game`,
  description: meta?.description,
};

export default function BeigomaDuelPage() {
  return <BeigomaDuelGame />;
}
