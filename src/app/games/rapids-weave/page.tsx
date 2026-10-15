import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { RapidsWeaveGame } from "./RapidsWeaveGame";

const meta = getGameBySlug("rapids-weave");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Rapids Weave"} | ai-game`,
  description: meta?.description,
};

export default function RapidsWeavePage() {
  return <RapidsWeaveGame />;
}
