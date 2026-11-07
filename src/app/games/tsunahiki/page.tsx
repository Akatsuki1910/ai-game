import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { TsunahikiGame } from "./TsunahikiGame";

const meta = getGameBySlug("tsunahiki");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Tsunahiki"} | ai-game`,
  description: meta?.description,
};

export default function TsunahikiPage() {
  return <TsunahikiGame />;
}
