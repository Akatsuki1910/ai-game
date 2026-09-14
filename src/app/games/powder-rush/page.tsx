import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { PowderRushGame } from "./PowderRushGame";

const meta = getGameBySlug("powder-rush");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Powder Rush"} | ai-game`,
  description: meta?.description,
};

export default function PowderRushPage() {
  return <PowderRushGame />;
}
