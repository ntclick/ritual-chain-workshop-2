import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Ritual Predict — markets that settle themselves",
    template: "%s · Ritual Predict",
  },
  description:
    "Binary prediction markets on Ritual Chain that resolve without a keeper. The Scheduler " +
    "wakes the contract, the HTTP and jq precompiles read the oracle inside a TEE, and the " +
    "pari-mutuel pool pays out.",
  openGraph: {
    title: "Ritual Predict — markets that settle themselves",
    description:
      "No keeper, no cron, no external bot. The chain wakes the contract and it settles itself.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
