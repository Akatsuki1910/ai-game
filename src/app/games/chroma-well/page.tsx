import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { ChromaWellGame } from "./ChromaWellGame";

const meta = getGameBySlug("chroma-well");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Chroma Well"} | ai-game`,
  description: meta?.description,
};

export default function ChromaWellPage() {
  return <ChromaWellGame />;
}
