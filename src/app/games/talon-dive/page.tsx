import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { TalonDiveGame } from "./TalonDiveGame";

const meta = getGameBySlug("talon-dive");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Talon Dive"} | ai-game`,
  description: meta?.description,
};

export default function TalonDivePage() {
  return <TalonDiveGame />;
}
