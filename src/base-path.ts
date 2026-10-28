/** Public URL prefix when the app is mounted below the host root, e.g. `/video-gen`.
    Empty when the app is served at `/`. Read at build time in the browser bundle. */
export function configuredBasePath(): string {
  const value = process.env.NEXT_PUBLIC_BASE_PATH?.trim() ?? "";
  if (!value || value === "/") return "";
  const withLead = value.startsWith("/") ? value : `/${value}`;
  return withLead.replace(/\/+$/, "");
}

export function apiUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${configuredBasePath()}${normalized}`;
}

/** Root-relative app paths need the mount prefix. Absolute and data URLs stay. */
export function withBasePath(url: string): string {
  if (!url.startsWith("/")) return url;
  const base = configuredBasePath();
  if (!base || url === base || url.startsWith(`${base}/`)) return url;
  return `${base}${url}`;
}
