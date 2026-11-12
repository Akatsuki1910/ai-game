import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { MirrorGardenGame } from "./MirrorGardenGame";

const meta = getGameBySlug("mirror-garden");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Mirror Garden"} | ai-game`,
  description: meta?.description,
};

export default function MirrorGardenPage() {
  return <MirrorGardenGame />;
}
