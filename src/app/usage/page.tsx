import type { Metadata } from "next";
import { Hanken_Grotesk, JetBrains_Mono, Newsreader } from "next/font/google";

import { UsagePanel } from "@/openhiggsfield/usage-panel";

import "@/openhiggsfield/openhiggsfield.css";

const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-usage-display",
  display: "swap",
});

const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-usage-body",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-usage-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Usage",
  alternates: { canonical: "/usage" },
  robots: { index: false, follow: false },
};

export default function UsagePage() {
  return (
    <div className={`ohf ohf-usage-page ${newsreader.variable} ${hanken.variable} ${jetbrains.variable}`}>
      <UsagePanel />
    </div>
  );
}
