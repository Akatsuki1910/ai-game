import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { KarutaDashGame } from "./KarutaDashGame";

const meta = getGameBySlug("karuta-dash");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Karuta Dash"} | ai-game`,
  description: meta?.description,
};

export default function KarutaDashPage() {
  return <KarutaDashGame />;
}
