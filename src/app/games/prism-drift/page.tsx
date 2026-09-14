import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { PrismDriftGame } from "./PrismDriftGame";

const meta = getGameBySlug("prism-drift");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Prism Drift"} | ai-game`,
  description: meta?.description,
};

export default function PrismDriftPage() {
  return <PrismDriftGame />;
}
