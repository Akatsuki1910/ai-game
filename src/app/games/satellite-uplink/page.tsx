import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { SatelliteUplinkGame } from "./SatelliteUplinkGame";

const meta = getGameBySlug("satellite-uplink");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Satellite Uplink"} | ai-game`,
  description: meta?.description,
};

export default function SatelliteUplinkPage() {
  return <SatelliteUplinkGame />;
}
