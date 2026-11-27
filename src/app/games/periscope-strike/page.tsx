import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { PeriscopeStrikeGame } from "./PeriscopeStrikeGame";

const meta = getGameBySlug("periscope-strike");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Periscope Strike"} | ai-game`,
  description: meta?.description,
};

export default function PeriscopeStrikePage() {
  return <PeriscopeStrikeGame />;
}
