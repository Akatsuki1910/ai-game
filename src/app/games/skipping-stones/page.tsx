import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { SkippingStonesGame } from "./SkippingStonesGame";

const meta = getGameBySlug("skipping-stones");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Skipping Stones"} | ai-game`,
  description: meta?.description,
};

export default function SkippingStonesPage() {
  return <SkippingStonesGame />;
}
