import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { HoldingPatternGame } from "./HoldingPatternGame";

const meta = getGameBySlug("holding-pattern");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Holding Pattern"} | ai-game`,
  description: meta?.description,
};

export default function HoldingPatternPage() {
  return <HoldingPatternGame />;
}
