import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { LanternCipherGame } from "./LanternCipherGame";

const meta = getGameBySlug("lantern-cipher");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Lantern Cipher"} | ai-game`,
  description: meta?.description,
};

export default function LanternCipherPage() {
  return <LanternCipherGame />;
}
