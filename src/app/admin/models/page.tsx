import type { Metadata } from "next";
import { Inter } from "next/font/google";

import { AuthShell } from "@/openhiggsfield/auth-shell";
import { ModelAdminPanel } from "@/openhiggsfield/model-admin-panel";

import "@/openhiggsfield/openhiggsfield.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-ohf-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Model management",
  alternates: { canonical: "/admin/models" },
  robots: { index: false, follow: false },
};

export default function ModelAdminPage() {
  return (
    <AuthShell fontClassName={inter.variable} title="Model management" wide>
      <ModelAdminPanel />
    </AuthShell>
  );
}
