import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { EchoDiverGame } from "./EchoDiverGame";

const meta = getGameBySlug("echo-diver");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Echo Diver"} | ai-game`,
  description: meta?.description,
};

export default function EchoDiverPage() {
  return <EchoDiverGame />;
}
