import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { TideKeepGame } from "./TideKeepGame";

const meta = getGameBySlug("tide-keep");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Tide Keep"} | ai-game`,
  description: meta?.description,
};

export default function TideKeepPage() {
  return <TideKeepGame />;
}
