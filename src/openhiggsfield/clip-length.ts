/** Does this model edit the clip it was handed? Extend is deliberately not one:
    its duration is the added length, not the length of the result. */
export function editsClip(modelId: string): boolean {
  return /edit/i.test(modelId);
}

/* Lengths measured in this tab, keyed by media URL: a clip that has already been
   attached or previewed does not have to be fetched again to be measured. */
const measured = new Map<string, number>();

export function rememberClipSeconds(url: string, seconds: number): void {
  if (!url || !Number.isFinite(seconds) || seconds <= 0) return;
  measured.set(url, seconds);
}

export function knownClipSeconds(url: string): number | null {
  return measured.get(url) ?? null;
}

/** Length of a clip, read by the browser's own demuxer. An edit has to be told
    how long its output should be, and the clip being edited is the only sensible
    default: the provider's own fallback is 5 s, so omitting the parameter
    shortens a 10 s source. Resolves null when the metadata never arrives (dead
    link, unsupported container, slow fetch). */
export function clipSeconds(url: string, timeoutMs = 20_000): Promise<number | null> {
  return measure(url, timeoutMs, () => undefined);
}

/** The file the visitor just handed over: a blob URL needs no network at all,
    so this answers in milliseconds where clipSeconds() may wait on megabytes. */
export function fileSeconds(file: File): Promise<number | null> {
  const url = URL.createObjectURL(file);
  return measure(url, 8_000, () => URL.revokeObjectURL(url));
}

function measure(url: string, timeoutMs: number, release: () => void): Promise<number | null> {
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
      release();
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
