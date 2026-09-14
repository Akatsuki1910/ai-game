import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { HighWireGame } from "./HighWireGame";

const meta = getGameBySlug("high-wire");

export const metadata: Metadata = {
  title: `${meta?.title ?? "High Wire"} | ai-game`,
  description: meta?.description,
};

export default function HighWirePage() {
  return <HighWireGame />;
}
