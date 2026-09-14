import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { CloseHauledGame } from "./CloseHauledGame";

const meta = getGameBySlug("close-hauled");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Close Hauled"} | ai-game`,
  description: meta?.description,
};

export default function CloseHauledPage() {
  return <CloseHauledGame />;
}
