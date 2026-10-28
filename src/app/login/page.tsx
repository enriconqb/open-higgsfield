import type { Metadata } from "next";
import { Inter } from "next/font/google";

import { AuthShell } from "@/openhiggsfield/auth-shell";
import { LoginForm } from "@/openhiggsfield/login-form";

import "@/openhiggsfield/openhiggsfield.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-ohf-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Sign in",
  alternates: { canonical: "/login" },
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return (
    <AuthShell fontClassName={inter.variable} title="Sign in">
      <LoginForm />
    </AuthShell>
  );
}
