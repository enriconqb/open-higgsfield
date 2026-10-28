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
