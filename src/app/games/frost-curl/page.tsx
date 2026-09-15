import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { FrostCurlGame } from "./FrostCurlGame";

const meta = getGameBySlug("frost-curl");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Frost Curl"} | ai-game`,
  description: meta?.description,
};

export default function FrostCurlPage() {
  return <FrostCurlGame />;
}
