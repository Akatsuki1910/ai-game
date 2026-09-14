import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { GrappleArcGame } from "./GrappleArcGame";

const meta = getGameBySlug("grapple-arc");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Grapple Arc"} | ai-game`,
  description: meta?.description,
};

export default function GrappleArcPage() {
  return <GrappleArcGame />;
}
