import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { ShaftDispatchGame } from "./ShaftDispatchGame";

const meta = getGameBySlug("shaft-dispatch");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Shaft Dispatch"} | ai-game`,
  description: meta?.description,
};

export default function ShaftDispatchPage() {
  return <ShaftDispatchGame />;
}
