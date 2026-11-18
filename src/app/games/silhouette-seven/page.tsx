import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { SilhouetteSevenGame } from "./SilhouetteSevenGame";

const meta = getGameBySlug("silhouette-seven");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Silhouette Seven"} | ai-game`,
  description: meta?.description,
};

export default function SilhouetteSevenPage() {
  return <SilhouetteSevenGame />;
}
