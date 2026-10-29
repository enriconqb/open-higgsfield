import type { Metadata } from "next";
import { Inter } from "next/font/google";

import { ApiTokensPanel } from "@/openhiggsfield/api-tokens-panel";
import { AuthShell } from "@/openhiggsfield/auth-shell";

import "@/openhiggsfield/openhiggsfield.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-ohf-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "API tokens",
  alternates: { canonical: "/tokens" },
  robots: { index: false, follow: false },
};

export default function TokensPage() {
  return (
    <AuthShell fontClassName={inter.variable} title="API tokens" wide>
      <ApiTokensPanel />
    </AuthShell>
  );
}
