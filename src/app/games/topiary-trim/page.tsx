import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { TopiaryTrimGame } from "./TopiaryTrimGame";

const meta = getGameBySlug("topiary-trim");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Topiary Trim"} | ai-game`,
  description: meta?.description,
};

export default function TopiaryTrimPage() {
  return <TopiaryTrimGame />;
}
