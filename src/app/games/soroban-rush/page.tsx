import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { SorobanRushGame } from "./SorobanRushGame";

const meta = getGameBySlug("soroban-rush");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Soroban Rush"} | ai-game`,
  description: meta?.description,
};

export default function SorobanRushPage() {
  return <SorobanRushGame />;
}
