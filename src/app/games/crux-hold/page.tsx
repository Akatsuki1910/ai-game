import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { CruxHoldGame } from "./CruxHoldGame";

const meta = getGameBySlug("crux-hold");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Crux Hold"} | ai-game`,
  description: meta?.description,
};

export default function CruxHoldPage() {
  return <CruxHoldGame />;
}
