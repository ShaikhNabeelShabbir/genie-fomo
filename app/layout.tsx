import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "genie-fomo — trader lookup",
  description: "Type a fomo trader name, get their wallet and every EVM transfer across Ethereum, BSC, Base and Robinhood Chain.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
