import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { TautLineGame } from "./TautLineGame";

const meta = getGameBySlug("taut-line");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Taut Line"} | ai-game`,
  description: meta?.description,
};

export default function TautLinePage() {
  return <TautLineGame />;
}
