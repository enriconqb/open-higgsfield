/** True only when COOKIE_SECURE=true. Unset or false keeps cookies on plain HTTP (LAN). */
export function cookieSecure(): boolean {
  return process.env.COOKIE_SECURE?.trim().toLowerCase() === "true";
}
