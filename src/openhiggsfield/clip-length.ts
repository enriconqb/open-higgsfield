/** Does this model edit the clip it was handed? Extend is deliberately not one:
    its duration is the added length, not the length of the result. */
export function editsClip(modelId: string): boolean {
  return /edit/i.test(modelId);
}

/** Length of a clip, read by the browser's own demuxer.
    An edit has to be told how long its output should be, and the clip being
    edited is the only sensible default: the provider's own fallback is 5 s, so
    omitting the parameter shortens a 10 s source. Resolves null when the
    metadata never arrives (dead link, unsupported container). */
export function clipSeconds(url: string, timeoutMs = 8000): Promise<number | null> {
  return new Promise((resolve) => {
    if (typeof document === "undefined" || !url) {
      resolve(null);
      return;
    }
    const probe = document.createElement("video");
    let settled = false;
    const finish = (value: number | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      probe.removeAttribute("src");
      probe.load();
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    probe.preload = "metadata";
    probe.muted = true;
    probe.addEventListener(
      "loadedmetadata",
      () => {
        const seconds = probe.duration;
        finish(Number.isFinite(seconds) && seconds > 0 ? seconds : null);
      },
      { once: true },
    );
    probe.addEventListener("error", () => finish(null), { once: true });
    probe.src = url;
  });
}
