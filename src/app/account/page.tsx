import type { Metadata } from "next";
import { Inter } from "next/font/google";

import { ApiTokensPanel } from "@/openhiggsfield/api-tokens-panel";
import { AuthShell } from "@/openhiggsfield/auth-shell";
import { ChangePasswordForm } from "@/openhiggsfield/change-password-form";

import "@/openhiggsfield/openhiggsfield.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-ohf-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Account",
  alternates: { canonical: "/account" },
  robots: { index: false, follow: false },
};

export default function AccountPage() {
  return (
    <AuthShell fontClassName={inter.variable} title="Account">
      <ChangePasswordForm />
      <ApiTokensPanel />
    </AuthShell>
  );
}
