import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { MobilePoiseGame } from "./MobilePoiseGame";

const meta = getGameBySlug("mobile-poise");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Mobile Poise"} | ai-game`,
  description: meta?.description,
};

export default function MobilePoisePage() {
  return <MobilePoiseGame />;
}
