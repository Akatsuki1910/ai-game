import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { RailWeaverGame } from "./RailWeaverGame";

const meta = getGameBySlug("rail-weaver");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Rail Weaver"} | ai-game`,
  description: meta?.description,
};

export default function RailWeaverPage() {
  return <RailWeaverGame />;
}
