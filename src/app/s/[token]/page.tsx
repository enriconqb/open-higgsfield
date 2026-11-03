import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { configuredBasePath } from "@/base-path";
import { SharePreview } from "@/openhiggsfield/share-preview";
import { readPublicShare } from "@/share/actions";
import { SITE_NAME, SITE_URL } from "@/site";

import "@/openhiggsfield/openhiggsfield.css";

export const dynamic = "force-dynamic";

const SHARE_TITLE = "Vicend VTA AI";
const SHARE_DESCRIPTION = "Video Image Generator";

function publicOrigin(headerStore: Headers): string {
  const configured = SITE_URL.replace(/\/+$/, "");
  if (!/localhost|127\.0\.0\.1/.test(configured)) return configured;
  const host = (headerStore.get("x-forwarded-host") ?? headerStore.get("host") ?? "").split(",")[0]?.trim();
  if (!host || /localhost|127\.0\.0\.1/.test(host)) return configured;
  const proto = (headerStore.get("x-forwarded-proto") ?? "https").split(",")[0]?.trim() || "https";
  return `${proto}://${host}`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const origin = publicOrigin(await headers());
  const image = `${origin}${configuredBasePath()}/share-banner.jpg`;
  const url = `${origin}${configuredBasePath()}/s/${token}`;
  const banner = {
    url: image,
    width: 1024,
    height: 576,
    type: "image/jpeg" as const,
    alt: `${SHARE_TITLE} — ${SHARE_DESCRIPTION}`,
  };
  return {
    title: SHARE_TITLE,
    description: SHARE_DESCRIPTION,
    robots: { index: false, follow: false },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title: SHARE_TITLE,
      description: SHARE_DESCRIPTION,
      url,
      images: [banner],
    },
    twitter: {
      card: "summary_large_image",
      title: SHARE_TITLE,
      description: SHARE_DESCRIPTION,
      images: [banner],
    },
  };
}

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const share = await readPublicShare(token);
  if (!share) notFound();
  return <SharePreview token={share.token} kind={share.kind} count={share.count} facts={share.facts} />;
}
