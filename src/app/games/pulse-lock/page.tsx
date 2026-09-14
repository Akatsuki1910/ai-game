import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { PulseLockGame } from "./PulseLockGame";

const meta = getGameBySlug("pulse-lock");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Pulse Lock"} | ai-game`,
  description: meta?.description,
};

export default function PulseLockPage() {
  return <PulseLockGame />;
}
