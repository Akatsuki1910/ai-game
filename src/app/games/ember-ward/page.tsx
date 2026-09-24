import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { EmberWardGame } from "./EmberWardGame";

const meta = getGameBySlug("ember-ward");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Ember Ward"} | ai-game`,
  description: meta?.description,
};

export default function EmberWardPage() {
  return <EmberWardGame />;
}
