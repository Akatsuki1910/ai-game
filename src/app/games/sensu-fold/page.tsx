import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { SensuFoldGame } from "./SensuFoldGame";

const meta = getGameBySlug("sensu-fold");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Sensu Fold"} | ai-game`,
  description: meta?.description,
};

export default function SensuFoldPage() {
  return <SensuFoldGame />;
}
