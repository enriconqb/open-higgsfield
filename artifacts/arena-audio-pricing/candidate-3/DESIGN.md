# Audio USD estimate + usage — design

**Goal:** smallest safe diff so character-priced TTS (Eleven / Kokoro / Voxtral studio defaults) shows a Generate-button USD estimate and records `costUsd` on `usage_events` / gallery.

**Root fix:** stop `quoteFor` early-returning `null` for `surface === "audio"`, then extend the existing `OpenRouterQuote` → `estimateUsd` → composer / `estimatePlaneUsd` → `rememberUsage` path. No parallel price list in the UI; browser still only calls `openRouterQuote` server action.

---

## 1. Chosen `OpenRouterQuote` audio variant

Mirror OpenRouter’s speech pricing fields (`pricing.prompt`, `pricing.completion` as USD numeric strings). One variant covers character-priced, second-priced, and mixed models without a second pricing abstraction.

```ts
export type OpenRouterQuote =
  | { kind: "video"; skus: Record<string, number>; sizes?: string[] }
  | { kind: "image"; lines: ImagePriceLine[] }
  | {
      kind: "audio";
      /** USD per input character — OpenRouter `pricing.prompt`. */
      prompt: number;
      /** USD per generated audio second — OpenRouter `pricing.completion`. */
      completion: number;
    };
```

Parse with `Number(raw)`; require `Number.isFinite`. Zero is valid (Seed Audio has `prompt: "0"`; Eleven has `completion: "0"`).

**v1 estimate rule (character-first):**

| Rates | Behavior |
|---|---|
| `prompt > 0` | `prompt * characters * batch` (+ `completion * duration` only if `duration > 0` is known) |
| `prompt === 0` && `completion > 0` | return `null` until a duration input exists (Seed Audio deferred) |
| both `0` / non-finite | return `null` |

Studio defaults (Eleven Flash, Kokoro, Voxtral Mini) are `prompt > 0`, `completion === 0` → lit up by the character path alone. Gemini TTS (`prompt` + `completion` both non-zero) gets a character-only underestimate unless duration is later wired; acceptable for this pass.

---

## 2. `estimateUsd` / `EstimateInput` changes

```ts
export type EstimateInput = {
  resolution?: string;
  aspectRatio?: string;
  duration?: number;
  audio?: boolean;
  images: number;
  videos: number;
  audios: number;
  batch: number;
  /** Billable TTS script length (`plane.prompt.text.length`). */
  characters?: number;
};
```

```ts
export function estimateUsd(quote: OpenRouterQuote, input: EstimateInput): number | null {
  const total =
    quote.kind === "video"
      ? estimateVideo(quote.skus, quote.sizes, input)
      : quote.kind === "image"
        ? estimateImage(quote.lines, input)
        : estimateAudio(quote, input);
  if (total === null || !Number.isFinite(total) || total <= 0) return null;
  return total;
}

function estimateAudio(
  quote: Extract<OpenRouterQuote, { kind: "audio" }>,
  input: EstimateInput,
): number | null {
  const batch = input.batch > 0 ? input.batch : 1;
  const chars = Math.max(0, input.characters ?? 0);
  const seconds = input.duration && input.duration > 0 ? input.duration : 0;
  let total = 0;
  if (quote.prompt > 0) total += quote.prompt * chars * batch;
  if (quote.completion > 0 && seconds > 0) total += quote.completion * seconds * batch;
  return total > 0 ? total : null;
}
```

Empty prompt → `characters === 0` → `null` estimate (no fake floor). That matches “no text → no billable speech.”

---

## 3. How `quoteFor` fetches prices (path + cache)

### Exact path

Credentials `baseUrl` is already `…/api/v1`. Fetch:

```
GET {baseUrl}/models?output_modalities=speech&endpoints=/api/v1/audio/speech
```

via existing `openRouterJson` (same Bearer as video/image quotes). **Not** `/audio/speech/models` (voices/formats only, no pricing).

Response shape used: `data[]` rows with `id` (OpenRouter slug) and `pricing.prompt` / `pricing.completion` strings. Match `openRouterSlug(modelId)`.

### Cache

Parallel the video list cache (one list for all speech models, not per-slug like images):

```ts
const PRICE_TTL_MS = 5 * 60_000; // already in engine.ts

let speechPriceCache: {
  at: number;
  models: Map<string, { prompt: number; completion: number }>;
} | null = null;
```

- On miss / TTL expiry: one list fetch → fill `Map` by `id`.
- `quoteFor` audio branch: `speechRates(credentials, slug)` → `{ kind: "audio", prompt, completion }` or `null` if slug missing / unparseable.

### `quoteFor` change

Replace:

```ts
if (model.surface === "audio") return null;
```

with a real branch:

```ts
if (model.surface === "audio") {
  const rates = await speechRates(context.credentials, slug);
  return rates ? { kind: "audio", ...rates } : null;
}
```

Provider guard stays: non-`openrouter` → `null`.

`openRouterQuote` server action needs no signature change; it already returns `quoteFor(...)`.

---

## 4. Composer + `estimatePlaneUsd` wire for characters

Billable text = spoken script = `plane.prompt.text` (`mapSpeech` `input`). Character count = that string’s `.length` (JS UTF-16 length; matches how the studio counts the prompt field today; do not invent grapheme / byte counters).

### Composer (`composer.tsx`)

Existing `openRouterQuote(model.id)` effect already runs for any OpenRouter model including audio once `quoteFor` returns a quote. Only the `estimateUsd` call needs `characters`:

```ts
const estimate = quote
  ? estimateUsd(quote, {
      // …existing fields…
      batch: batchValue,
      characters: prompt.text.length,
    })
  : null;
```

Generate label / `onGenerate(estimate ?? undefined)` already format and pass USD — no label special-case for audio.

### `estimatePlaneUsd` (`usage/record.ts`)

```ts
return estimateUsd(quote, {
  // …existing fields…
  batch: batch > 0 ? batch : 1,
  characters: plane.prompt.text.length,
});
```

Same number on preview and on `rememberUsage` when the quote is present.

---

## 5. Usage recording when speech returns no `usage.cost`

### Today

`submitSpeech` reads raw audio bytes. Immediate status has **no** `costUsd` (no JSON body, so `readCost` never runs). `rememberUsage` already does:

```ts
const costUsd = immediate?.costUsd ?? estimated;
```

Once `quoteFor` + `estimatePlaneUsd` work, **usage_events get the character estimate** on successful immediate speech without further platform changes.

### Response headers

`submitSpeech` already lifts `X-Generation-Id` / `x-generation-id` into `requestId`. There is **no** documented cost header on `/audio/speech` responses in this codebase or grounding. Do **not** invent header parsers for cost.

### Generation lookup (`GET /generation?id=…`)

OpenRouter’s generation stats endpoint can eventually expose billed `usage` / total cost for an id. Considered as a **follow-up**, not v1:

| Factor | Verdict |
|---|---|
| Extra RTT after every TTS | Hurts the immediate-speech path |
| Cost often not ready on the first poll | Needs retry / settle complexity speech does not have |
| `verify:studio` must not drive OpenRouter from the browser | Server-only lookup is fine, but still more surface area |
| Estimate already matches character SKUs for defaults | Enough for gallery/usage parity with image’s “estimate when no provider cost” fallback |

**v1 decision:** record `estimated` from the quote; leave `immediate.costUsd` unset. Optional later: best-effort generation lookup when `X-Generation-Id` is present, then `settleUsage` / overwrite if a positive provider cost appears.

### Gallery / `api_jobs` parity (small companion fix)

`rememberUsage` will store estimate; `rememberStudioJob` today sets `cost_usd: immediate?.costUsd ?? null`, so a mirrored gallery row can lose USD on reload even when usage_events has it.

**Include in the same change set:** when creating/mirroring the studio job for an immediate audio (or any immediate) result, use the same fallback as `rememberUsage`:

```ts
const estimated = estimatePlaneUsd(await quoteFor(...).catch(() => null), plane);
const costUsd = immediate?.costUsd ?? estimated;
```

Reuse one quote fetch if both `rememberUsage` and `rememberStudioJob` run in the same submit (optional micro-optimize; correctness first).

Client draft already receives `onGenerate(estimate)` — preview works before reload; server mirror keeps it after.

---

## 6. Alternatives considered and rejected

| Alternative | Why rejected |
|---|---|
| Hardcode per-model USD in catalog / UI | Violates catalog+server quote pattern; drifts from OpenRouter |
| Price from `/audio/speech/models` | No pricing fields |
| Separate `SpeechPriceTable` module outside `OpenRouterQuote` | Parallel path; composer/`estimatePlaneUsd` already keyed on quote kind |
| Require generation-stats lookup before recording cost | Latency + readiness races; not needed for character SKUs |
| Estimate Seed Audio via byte-length → duration heuristics | Unsafe; defer until a real duration input exists |
| `billable: "character" \| "second"` discriminated audio quotes | More types for one API; flat `prompt`/`completion` matches the source |

---

## 7. Risks

1. **UTF-16 vs provider character billing** — JS `.length` may disagree with provider grapheme/byte rules on emoji / combining marks; estimates can drift slightly. Accept for v1; same string the studio sends as `input`.
2. **Stale list cache (5 min)** — OpenRouter price changes lag until TTL; same as video SKU cache.
3. **Gemini / Seed under- or non-estimate** — character-first rule leaves Seed at `null` and Gemini incomplete; document as intentional scope, not a bug in the Eleven/Kokoro/Voxtral path.
4. **Empty prompt** — estimate stays hidden (`null`); Generate still enabled unless other guards block — UX may look “free” until text is typed; consistent with zero billable chars.
5. **Provider cost never overwrites estimate** — without generation lookup, usage stays at estimate forever even if billed amount differs; fine for character linear pricing, weaker if OpenRouter applies minimums/discounts.
6. **`api_jobs.cost_usd` vs `usage_events`** — if the rememberStudioJob fallback is skipped, gallery reload drops `costUsd` while usage dashboard still shows it; treat the companion fallback as required for the “gallery costUsd” half of the goal.
7. **Verify gate** — `pnpm verify:studio` must keep quoting on the server action only; do not add browser calls to `/models` or `/audio/speech`.

---

## Implementation touch list (no code in this artifact)

| File | Change |
|---|---|
| `src/generation/estimate.ts` | audio quote variant; `characters` on `EstimateInput`; `estimateAudio` |
| `src/generation/engine.ts` | `speechPriceCache` + `speechRates`; audio branch in `quoteFor` |
| `src/usage/record.ts` | pass `characters: plane.prompt.text.length` |
| `src/openhiggsfield/composer.tsx` | pass `characters: prompt.text.length` into `estimateUsd` |
| `src/generation/actions.ts` | `rememberStudioJob` cost fallback ≈ `rememberUsage` (estimate when no `immediate.costUsd`) |
| `src/generation/platform.ts` | **no change** in v1 (keep bytes + `X-Generation-Id`; no fake `usage.cost`) |

Out of scope for this pass: Seed Audio duration pricing, generation-stats enrichment, client-side OpenRouter fetches.
