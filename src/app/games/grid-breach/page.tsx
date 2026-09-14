import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { GridBreachGame } from "./GridBreachGame";

const meta = getGameBySlug("grid-breach");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Grid Breach"} | ai-game`,
  description: meta?.description,
};

export default function GridBreachPage() {
  return <GridBreachGame />;
}
