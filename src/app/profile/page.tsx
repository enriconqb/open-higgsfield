import type { Metadata } from "next";
import { Inter } from "next/font/google";

import { AuthShell } from "@/openhiggsfield/auth-shell";
import { ProfilePanel } from "@/openhiggsfield/profile-panel";

import "@/openhiggsfield/openhiggsfield.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-ohf-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Profile",
  alternates: { canonical: "/profile" },
  robots: { index: false, follow: false },
};

export default function ProfilePage() {
  return (
    <AuthShell fontClassName={inter.variable} title="Profile">
      <ProfilePanel />
    </AuthShell>
  );
}
