import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { FlailWardGame } from "./FlailWardGame";

const meta = getGameBySlug("flail-ward");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Flail Ward"} | ai-game`,
  description: meta?.description,
};

export default function FlailWardPage() {
  return <FlailWardGame />;
}
