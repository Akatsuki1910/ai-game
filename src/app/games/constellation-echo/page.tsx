import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { ConstellationEchoGame } from "./ConstellationEchoGame";

const meta = getGameBySlug("constellation-echo");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Constellation Echo"} | ai-game`,
  description: meta?.description,
};

export default function ConstellationEchoPage() {
  return <ConstellationEchoGame />;
}
