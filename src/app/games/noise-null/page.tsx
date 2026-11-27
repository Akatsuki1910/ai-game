import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { NoiseNullGame } from "./NoiseNullGame";

const meta = getGameBySlug("noise-null");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Noise Null"} | ai-game`,
  description: meta?.description,
};

export default function NoiseNullPage() {
  return <NoiseNullGame />;
}
