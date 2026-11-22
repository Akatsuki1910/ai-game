import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { StrokeRateGame } from "./StrokeRateGame";

const meta = getGameBySlug("stroke-rate");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Stroke Rate"} | ai-game`,
  description: meta?.description,
};

export default function StrokeRatePage() {
  return <StrokeRateGame />;
}
