import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { CorniceWatchGame } from "./CorniceWatchGame";

const meta = getGameBySlug("cornice-watch");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Cornice Watch"} | ai-game`,
  description: meta?.description,
};

export default function CorniceWatchPage() {
  return <CorniceWatchGame />;
}
