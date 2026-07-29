import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dispečr",
  description: "AI dispečer pro řemeslníky a servisní firmy",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="cs">
      <body>{children}</body>
    </html>
  );
}
