import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { WheelThrowGame } from "./WheelThrowGame";

const meta = getGameBySlug("wheel-throw");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Wheel Throw"} | ai-game`,
  description: meta?.description,
};

export default function WheelThrowPage() {
  return <WheelThrowGame />;
}
