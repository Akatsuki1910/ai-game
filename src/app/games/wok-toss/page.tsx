import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { WokTossGame } from "./WokTossGame";

const meta = getGameBySlug("wok-toss");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Wok Toss"} | ai-game`,
  description: meta?.description,
};

export default function WokTossPage() {
  return <WokTossGame />;
}
