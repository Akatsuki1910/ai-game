import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { ShredderLineGame } from "./ShredderLineGame";

const meta = getGameBySlug("shredder-line");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Shredder Line"} | ai-game`,
  description: meta?.description,
};

export default function ShredderLinePage() {
  return <ShredderLineGame />;
}
