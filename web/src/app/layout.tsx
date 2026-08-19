import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Ritual Predict",
  description:
    "A self-resolving binary prediction market on Ritual Chain. No keeper, no cron, no external bot.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
