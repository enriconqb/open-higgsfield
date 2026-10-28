import type { Metadata } from "next";
import { Inter } from "next/font/google";

import { AuthShell } from "@/openhiggsfield/auth-shell";
import { AdminPanel } from "@/openhiggsfield/admin-panel";

import "@/openhiggsfield/openhiggsfield.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-ohf-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Users",
  alternates: { canonical: "/admin" },
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return (
    <AuthShell fontClassName={inter.variable} title="Users" wide>
      <AdminPanel />
    </AuthShell>
  );
}
