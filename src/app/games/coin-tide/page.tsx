import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { CoinTideGame } from "./CoinTideGame";

const meta = getGameBySlug("coin-tide");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Coin Tide"} | ai-game`,
  description: meta?.description,
};

export default function CoinTidePage() {
  return <CoinTideGame />;
}
