import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { VinylScratchGame } from "./VinylScratchGame";

const meta = getGameBySlug("vinyl-scratch");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Vinyl Scratch"} | ai-game`,
  description: meta?.description,
};

export default function VinylScratchPage() {
  return <VinylScratchGame />;
}
