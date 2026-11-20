import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { MochiPoundGame } from "./MochiPoundGame";

const meta = getGameBySlug("mochi-pound");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Mochi Pound"} | ai-game`,
  description: meta?.description,
};

export default function MochiPoundPage() {
  return <MochiPoundGame />;
}
