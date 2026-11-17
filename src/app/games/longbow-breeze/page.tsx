import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { LongbowBreezeGame } from "./LongbowBreezeGame";

const meta = getGameBySlug("longbow-breeze");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Longbow Breeze"} | ai-game`,
  description: meta?.description,
};

export default function LongbowBreezePage() {
  return <LongbowBreezeGame />;
}
