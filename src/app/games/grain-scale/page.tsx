import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { GrainScaleGame } from "./GrainScaleGame";

const meta = getGameBySlug("grain-scale");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Grain Scale"} | ai-game`,
  description: meta?.description,
};

export default function GrainScalePage() {
  return <GrainScaleGame />;
}
