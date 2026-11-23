import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { KirigamiSnowGame } from "./KirigamiSnowGame";

const meta = getGameBySlug("kirigami-snow");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Kirigami Snow"} | ai-game`,
  description: meta?.description,
};

export default function KirigamiSnowPage() {
  return <KirigamiSnowGame />;
}
