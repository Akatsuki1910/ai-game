import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { BlackoutFerryGame } from "./BlackoutFerryGame";

const meta = getGameBySlug("blackout-ferry");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Blackout Ferry"} | ai-game`,
  description: meta?.description,
};

export default function BlackoutFerryPage() {
  return <BlackoutFerryGame />;
}
