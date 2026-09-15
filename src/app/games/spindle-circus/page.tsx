import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { SpindleCircusGame } from "./SpindleCircusGame";

const meta = getGameBySlug("spindle-circus");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Spindle Circus"} | ai-game`,
  description: meta?.description,
};

export default function SpindleCircusPage() {
  return <SpindleCircusGame />;
}
