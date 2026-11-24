import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { SandRippleGame } from "./SandRippleGame";

const meta = getGameBySlug("sand-ripple");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Sand Ripple"} | ai-game`,
  description: meta?.description,
};

export default function SandRipplePage() {
  return <SandRippleGame />;
}
