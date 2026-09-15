import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { SwitchboardShiftGame } from "./SwitchboardShiftGame";

const meta = getGameBySlug("switchboard-shift");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Switchboard Shift"} | ai-game`,
  description: meta?.description,
};

export default function SwitchboardShiftPage() {
  return <SwitchboardShiftGame />;
}
