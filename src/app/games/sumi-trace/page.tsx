import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { SumiTraceGame } from "./SumiTraceGame";

const meta = getGameBySlug("sumi-trace");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Sumi Trace"} | ai-game`,
  description: meta?.description,
};

export default function SumiTracePage() {
  return <SumiTraceGame />;
}
