import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { BatonSyncGame } from "./BatonSyncGame";

const meta = getGameBySlug("baton-sync");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Baton Sync"} | ai-game`,
  description: meta?.description,
};

export default function BatonSyncPage() {
  return <BatonSyncGame />;
}
