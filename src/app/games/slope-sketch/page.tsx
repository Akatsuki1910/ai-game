import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { SlopeSketchGame } from "./SlopeSketchGame";

const meta = getGameBySlug("slope-sketch");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Slope Sketch"} | ai-game`,
  description: meta?.description,
};

export default function SlopeSketchPage() {
  return <SlopeSketchGame />;
}
