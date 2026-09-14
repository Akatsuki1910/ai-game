import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { FerroBloomGame } from "./FerroBloomGame";

const meta = getGameBySlug("ferro-bloom");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Ferro Bloom"} | ai-game`,
  description: meta?.description,
};

export default function FerroBloomPage() {
  return <FerroBloomGame />;
}
