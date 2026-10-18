import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { PagodaStackGame } from "./PagodaStackGame";

const meta = getGameBySlug("pagoda-stack");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Pagoda Stack"} | ai-game`,
  description: meta?.description,
};

export default function PagodaStackPage() {
  return <PagodaStackGame />;
}
