import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { EmberLoftGame } from "./EmberLoftGame";

const meta = getGameBySlug("ember-loft");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Ember Loft"} | ai-game`,
  description: meta?.description,
};

export default function EmberLoftPage() {
  return <EmberLoftGame />;
}
