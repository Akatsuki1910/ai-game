import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { TruffleTrailGame } from "./TruffleTrailGame";

const meta = getGameBySlug("truffle-trail");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Truffle Trail"} | ai-game`,
  description: meta?.description,
};

export default function TruffleTrailPage() {
  return <TruffleTrailGame />;
}
