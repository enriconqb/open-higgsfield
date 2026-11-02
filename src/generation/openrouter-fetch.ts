import { Agent, fetch as undiciFetch } from "undici";

/** OpenRouter is reached over IPv4. A VPS with an AAAA record and no IPv6 route
    otherwise fails every generation with undici's bare "fetch failed". */
const ipv4 = new Agent({
  connect: { family: 4 } as NonNullable<ConstructorParameters<typeof Agent>[0]>["connect"],
});

export const openRouterFetch: typeof fetch = async (input, init) => {
  try {
    const response = await undiciFetch(input as Parameters<typeof undiciFetch>[0], {
      ...init,
      dispatcher: ipv4,
    } as Parameters<typeof undiciFetch>[1]);
    return response as unknown as Response;
  } catch (caught) {
    const code = causeCode(caught);
    throw new Error(code ? `fetch failed (${code})` : "fetch failed", { cause: caught });
  }
};

function causeCode(caught: unknown): string | null {
  const seen = new Set<unknown>();
  let current: unknown = caught;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const record = current as { code?: unknown; cause?: unknown };
    if (typeof record.code === "string" && record.code) return record.code;
    current = record.cause;
  }
  return null;
}
