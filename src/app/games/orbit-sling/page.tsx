import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { OrbitSlingGame } from "./OrbitSlingGame";

const meta = getGameBySlug("orbit-sling");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Orbit Sling"} | ai-game`,
  description: meta?.description,
};

export default function OrbitSlingPage() {
  return <OrbitSlingGame />;
}
