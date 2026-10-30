import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SharePreview } from "@/openhiggsfield/share-preview";
import { readPublicShare } from "@/share/actions";

import "@/openhiggsfield/openhiggsfield.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Preview",
  robots: { index: false, follow: false },
};

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const share = await readPublicShare(token);
  if (!share) notFound();
  return <SharePreview token={share.token} kind={share.kind} count={share.count} facts={share.facts} />;
}
