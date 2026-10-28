import type { Metadata } from "next";
import { Inter } from "next/font/google";

import { AuthShell } from "@/openhiggsfield/auth-shell";
import { UsagePanel } from "@/openhiggsfield/usage-panel";

import "@/openhiggsfield/openhiggsfield.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-ohf-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Usage",
  alternates: { canonical: "/usage" },
  robots: { index: false, follow: false },
};

export default function UsagePage() {
  return (
    <AuthShell fontClassName={inter.variable} title="Usage" wide>
      <UsagePanel />
    </AuthShell>
  );
}
