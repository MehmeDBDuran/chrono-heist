import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CHRONO HEIST // PARADOX PROTOCOL",
  description:
    "4-Loop Time-Displacement Heist & PvP Paradox Breaker on Polygon ($UDAO)",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
