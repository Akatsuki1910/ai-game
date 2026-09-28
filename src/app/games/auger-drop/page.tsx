import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { AugerDropGame } from "./AugerDropGame";

const meta = getGameBySlug("auger-drop");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Auger Drop"} | ai-game`,
  description: meta?.description,
};

export default function AugerDropPage() {
  return <AugerDropGame />;
}
