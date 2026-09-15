import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { SignalLanternGame } from "./SignalLanternGame";

const meta = getGameBySlug("signal-lantern");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Signal Lantern"} | ai-game`,
  description: meta?.description,
};

export default function SignalLanternPage() {
  return <SignalLanternGame />;
}
