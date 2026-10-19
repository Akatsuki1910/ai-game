import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { DominoReachGame } from "./DominoReachGame";

const meta = getGameBySlug("domino-reach");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Domino Reach"} | ai-game`,
  description: meta?.description,
};

export default function DominoReachPage() {
  return <DominoReachGame />;
}
