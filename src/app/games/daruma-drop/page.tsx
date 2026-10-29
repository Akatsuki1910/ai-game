import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { DarumaDropGame } from "./DarumaDropGame";

const meta = getGameBySlug("daruma-drop");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Daruma Drop"} | ai-game`,
  description: meta?.description,
};

export default function DarumaDropPage() {
  return <DarumaDropGame />;
}
