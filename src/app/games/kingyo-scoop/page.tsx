import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { KingyoScoopGame } from "./KingyoScoopGame";

const meta = getGameBySlug("kingyo-scoop");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Kingyo Scoop"} | ai-game`,
  description: meta?.description,
};

export default function KingyoScoopPage() {
  return <KingyoScoopGame />;
}
