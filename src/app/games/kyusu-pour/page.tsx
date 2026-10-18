import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { KyusuPourGame } from "./KyusuPourGame";

const meta = getGameBySlug("kyusu-pour");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Kyusu Pour"} | ai-game`,
  description: meta?.description,
};

export default function KyusuPourPage() {
  return <KyusuPourGame />;
}
