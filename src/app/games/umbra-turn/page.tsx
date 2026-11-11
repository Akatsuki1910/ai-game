import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { UmbraTurnGame } from "./UmbraTurnGame";

const meta = getGameBySlug("umbra-turn");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Umbra Turn"} | ai-game`,
  description: meta?.description,
};

export default function UmbraTurnPage() {
  return <UmbraTurnGame />;
}
