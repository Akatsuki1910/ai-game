import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { KoiClimbGame } from "./KoiClimbGame";

const meta = getGameBySlug("koi-climb");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Koi Climb"} | ai-game`,
  description: meta?.description,
};

export default function KoiClimbPage() {
  return <KoiClimbGame />;
}
