import type { Metadata } from "next";
import { Inter } from "next/font/google";

import { AuthShell } from "@/openhiggsfield/auth-shell";
import { TemplatesPanel } from "@/openhiggsfield/templates-panel";

import "@/openhiggsfield/openhiggsfield.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-ohf-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Prompt templates",
  alternates: { canonical: "/templates" },
  robots: { index: false, follow: false },
};

export default function TemplatesPage() {
  return (
    <AuthShell fontClassName={inter.variable} title="Prompt templates" wide>
      <TemplatesPanel />
    </AuthShell>
  );
}
