import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { BubbleGardenGame } from "./BubbleGardenGame";

const meta = getGameBySlug("bubble-garden");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Bubble Garden"} | ai-game`,
  description: meta?.description,
};

export default function BubbleGardenPage() {
  return <BubbleGardenGame />;
}
