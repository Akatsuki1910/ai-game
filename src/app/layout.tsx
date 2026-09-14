import type { Metadata, Viewport } from "next";
import "./globals.scss";

export const metadata: Metadata = {
  title: "ai-game",
  description: "作り続けるプロトタイプWebゲーム集",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
