import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { NigiriRushGame } from "./NigiriRushGame";

const meta = getGameBySlug("nigiri-rush");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Nigiri Rush"} | ai-game`,
  description: meta?.description,
};

export default function NigiriRushPage() {
  return <NigiriRushGame />;
}
