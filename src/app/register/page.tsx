import type { Metadata } from "next";
import { Inter } from "next/font/google";

import { AuthShell } from "@/openhiggsfield/auth-shell";
import { RegisterForm } from "@/openhiggsfield/register-form";

import "@/openhiggsfield/openhiggsfield.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-ohf-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Request access",
  alternates: { canonical: "/register" },
  robots: { index: false, follow: false },
};

export default function RegisterPage() {
  return (
    <AuthShell fontClassName={inter.variable} title="Request access">
      <RegisterForm />
    </AuthShell>
  );
}
