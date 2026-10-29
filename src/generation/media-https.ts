/* One switch decides whether this deployment can give a generation provider an
   address it fetches itself. `NEXT_PUBLIC_` is the spelling that reaches both
   bundles — the server signs such an address, and the studio decides whether to
   prefer a provider CDN link instead. `PUBLIC_MEDIA_HTTPS` is still honoured so
   a deployment that set it before this module existed keeps working.

   Keep this module free of node: imports; the asset picker imports it. */

const OFF = new Set(["", "0", "false", "no", "off"]);

export function mediaHttpsEnabled(): boolean {
  const raw = (process.env.NEXT_PUBLIC_MEDIA_HTTPS ?? process.env.PUBLIC_MEDIA_HTTPS ?? "")
    .trim()
    .toLowerCase();
  return !OFF.has(raw);
}

/** A provider fetches video and audio itself and refuses a data URL for them.
    With the flag on this server signs its own address, and that wins because
    the archived copy never expires; with the flag off the provider's own CDN
    link is the only form it will still accept for a clip that is on disk. */
export function preferCdnForVideo(input: {
  remoteUrl?: string;
  mediaHttps?: boolean;
}): string | null {
  const enabled = input.mediaHttps ?? mediaHttpsEnabled();
  if (enabled) return null;
  const remote = input.remoteUrl ?? "";
  return /^https:\/\//i.test(remote) ? remote : null;
}
