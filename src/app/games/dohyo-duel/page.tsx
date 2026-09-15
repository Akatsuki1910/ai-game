import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { DohyoDuelGame } from "./DohyoDuelGame";

const meta = getGameBySlug("dohyo-duel");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Dohyo Duel"} | ai-game`,
  description: meta?.description,
};

export default function DohyoDuelPage() {
  return <DohyoDuelGame />;
}
