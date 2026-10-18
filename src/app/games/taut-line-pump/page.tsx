import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { TautLinePumpGame } from "./TautLinePumpGame";

const meta = getGameBySlug("taut-line-pump");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Taut Line Pump"} | ai-game`,
  description: meta?.description,
};

export default function TautLinePumpPage() {
  return <TautLinePumpGame />;
}
