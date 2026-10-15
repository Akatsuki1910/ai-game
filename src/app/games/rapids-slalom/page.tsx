import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { RapidsSlalomGame } from "./RapidsSlalomGame";

const meta = getGameBySlug("rapids-slalom");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Rapids Slalom"} | ai-game`,
  description: meta?.description,
};

export default function RapidsSlalomPage() {
  return <RapidsSlalomGame />;
}
