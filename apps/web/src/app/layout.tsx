import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Cargo Manager — Skyvalence",
  description: "Turn cargo email into accountable operational work.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
