import { configuredBasePath } from "@/base-path";

const UPLOAD = /\/uploads\/[0-9a-f-]{36}/i;

/** Prefer the on-disk archive. A provider https URL is the fallback. */
export function shareableUrl(urls: string[], remoteUrls: string[] = []): string {
  return (
    urls.find((url) => UPLOAD.test(url)) ??
    remoteUrls.find((url) => url.startsWith("https://")) ??
    urls.find((url) => url.startsWith("https://")) ??
    ""
  );
}

export function sharePageUrl(token: string): string {
  const path = `/s/${token}`;
  if (typeof window === "undefined") return `${configuredBasePath()}${path}`;
  return `${window.location.origin}${configuredBasePath()}${path}`;
}
