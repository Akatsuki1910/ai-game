import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { ShadowCastGame } from "./ShadowCastGame";

const meta = getGameBySlug("shadow-cast");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Shadow Cast"} | ai-game`,
  description: meta?.description,
};

export default function ShadowCastPage() {
  return <ShadowCastGame />;
}
