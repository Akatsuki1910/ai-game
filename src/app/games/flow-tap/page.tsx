import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { FlowTapGame } from "./FlowTapGame";

const meta = getGameBySlug("flow-tap");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Flow Tap"} | ai-game`,
  description: meta?.description,
};

export default function FlowTapPage() {
  return <FlowTapGame />;
}
