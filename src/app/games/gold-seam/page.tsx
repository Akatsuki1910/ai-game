import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { GoldSeamGame } from "./GoldSeamGame";

const meta = getGameBySlug("gold-seam");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Gold Seam"} | ai-game`,
  description: meta?.description,
};

export default function GoldSeamPage() {
  return <GoldSeamGame />;
}
