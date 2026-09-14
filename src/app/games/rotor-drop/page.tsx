import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { RotorDropGame } from "./RotorDropGame";

const meta = getGameBySlug("rotor-drop");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Rotor Drop"} | ai-game`,
  description: meta?.description,
};

export default function RotorDropPage() {
  return <RotorDropGame />;
}
