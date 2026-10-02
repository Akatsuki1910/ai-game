import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { PrizeCraneGame } from "./PrizeCraneGame";

const meta = getGameBySlug("prize-crane");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Prize Crane"} | ai-game`,
  description: meta?.description,
};

export default function PrizeCranePage() {
  return <PrizeCraneGame />;
}
