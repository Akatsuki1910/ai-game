import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { CairnBalanceGame } from "./CairnBalanceGame";

const meta = getGameBySlug("cairn-balance");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Cairn Balance"} | ai-game`,
  description: meta?.description,
};

export default function CairnBalancePage() {
  return <CairnBalanceGame />;
}
