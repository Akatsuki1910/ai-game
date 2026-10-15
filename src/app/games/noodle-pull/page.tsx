import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { NoodlePullGame } from "./NoodlePullGame";

const meta = getGameBySlug("noodle-pull");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Noodle Pull"} | ai-game`,
  description: meta?.description,
};

export default function NoodlePullPage() {
  return <NoodlePullGame />;
}
