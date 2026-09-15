import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { KendamaSwingGame } from "./KendamaSwingGame";

const meta = getGameBySlug("kendama-swing");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Kendama Swing"} | ai-game`,
  description: meta?.description,
};

export default function KendamaSwingPage() {
  return <KendamaSwingGame />;
}
