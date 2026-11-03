import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { GravitySnapGame } from "./GravitySnapGame";

const meta = getGameBySlug("gravity-snap");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Gravity Snap"} | ai-game`,
  description: meta?.description,
};

export default function GravitySnapPage() {
  return <GravitySnapGame />;
}
