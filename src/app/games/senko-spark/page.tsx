import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { SenkoSparkGame } from "./SenkoSparkGame";

const meta = getGameBySlug("senko-spark");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Senko Spark"} | ai-game`,
  description: meta?.description,
};

export default function SenkoSparkPage() {
  return <SenkoSparkGame />;
}
