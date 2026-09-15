import type { Metadata } from "next";
import { getGameBySlug } from "@/games-registry";
import { GyroVaultGame } from "./GyroVaultGame";

const meta = getGameBySlug("gyro-vault");

export const metadata: Metadata = {
  title: `${meta?.title ?? "Gyro Vault"} | ai-game`,
  description: meta?.description,
};

export default function GyroVaultPage() {
  return <GyroVaultGame />;
}
