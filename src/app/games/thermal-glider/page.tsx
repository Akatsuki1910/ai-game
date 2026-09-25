import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { ThermalGliderGame } from "./ThermalGliderGame";

const meta = getGameBySlug("thermal-glider");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Thermal Glider"} | ai-game`,
  description: meta?.description,
};

export default function ThermalGliderPage() {
  return <ThermalGliderGame />;
}
