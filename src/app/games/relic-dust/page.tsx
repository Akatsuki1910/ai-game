import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { RelicDustGame } from "./RelicDustGame";

const meta = getGameBySlug("relic-dust");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Relic Dust"} | ai-game`,
  description: meta?.description,
};

export default function RelicDustPage() {
  return <RelicDustGame />;
}
