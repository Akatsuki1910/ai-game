import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { StrataDrillGame } from "./StrataDrillGame";

const meta = getGameBySlug("strata-drill");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Strata Drill"} | ai-game`,
  description: meta?.description,
};

export default function StrataDrillPage() {
  return <StrataDrillGame />;
}
