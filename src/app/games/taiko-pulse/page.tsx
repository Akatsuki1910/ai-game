import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { TaikoPulseGame } from "./TaikoPulseGame";

const meta = getGameBySlug("taiko-pulse");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Taiko Pulse"} | ai-game`,
  description: meta?.description,
};

export default function TaikoPulsePage() {
  return <TaikoPulseGame />;
}
