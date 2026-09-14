import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { GravityHerdGame } from "./GravityHerdGame";

const meta = getGameBySlug("gravity-herd");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Gravity Herd"} | ai-game`,
  description: meta?.description,
};

export default function GravityHerdPage() {
  return <GravityHerdGame />;
}
