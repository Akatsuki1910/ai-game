import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { FireflySyncGame } from "./FireflySyncGame";

const meta = getGameBySlug("firefly-sync");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Firefly Sync"} | ai-game`,
  description: meta?.description,
};

export default function FireflySyncPage() {
  return <FireflySyncGame />;
}
