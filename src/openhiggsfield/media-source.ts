import { withBasePath } from "@/base-path";

import type { RunRecord } from "./history";

/* The gallery shows a result from the provider's CDN while that link still
   answers, and falls back to the copy archived on this server once it stops:
   provider links are signed and expire, the archive does not.

   Both kinds are listed: an image may load from the CDN just as a video may.
   Drop "image" here to keep images on the archived copy. */
const CDN_FIRST: readonly RunRecord["kind"][] = ["video", "image"];

export type MediaSources = {
  /** Where the browser should try first. */
  primary: string;
  /** The archived copy, present only when primary is a provider link. */
  fallback: string | null;
};

/** CDN first while it lasts, the archived copy otherwise. */
export function sourcesForUrls(input: {
  kind: RunRecord["kind"];
  url: string;
  remoteUrl?: string;
}): MediaSources {
  const local = input.url ? withBasePath(input.url) : "";
  const remote = input.remoteUrl ?? "";
  const cdn = CDN_FIRST.includes(input.kind) && /^https:\/\//i.test(remote) ? remote : null;
  if (!cdn) return { primary: local, fallback: null };
  return { primary: cdn, fallback: local || null };
}

export function sourcesFor(record: RunRecord, index: number): MediaSources {
  return sourcesForUrls({
    kind: record.kind,
    url: record.urls[index] ?? "",
    remoteUrl: record.remoteUrls?.[index] ?? "",
  });
}
