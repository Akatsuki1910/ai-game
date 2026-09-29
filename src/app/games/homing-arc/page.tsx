import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { HomingArcGame } from "./HomingArcGame";

const meta = getGameBySlug("homing-arc");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Homing Arc"} | ai-game`,
  description: meta?.description,
};

export default function HomingArcPage() {
  return <HomingArcGame />;
}
