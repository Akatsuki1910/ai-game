import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { BottleFlipGame } from "./BottleFlipGame";

const meta = getGameBySlug("bottle-flip");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Bottle Flip"} | ai-game`,
  description: meta?.description,
};

export default function BottleFlipPage() {
  return <BottleFlipGame />;
}
