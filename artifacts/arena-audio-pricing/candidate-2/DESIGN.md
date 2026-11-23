# Audio USD estimate + usage — design

Goal: when the studio surface is Audio, the Generate button shows a USD preview and `usage_events` / gallery `costUsd` get a real number. Root cause today: `quoteFor` returns `null` for `model.surface === "audio"`, so composer estimate and `rememberUsage` both stay empty.

## Verdict

Add a third `OpenRouterQuote` arm `{ kind: "audio"; prompt: number; completion: number }` that mirrors OpenRouter’s speech `pricing.prompt` / `pricing.completion` fields. Fetch them from the speech-filtered models list (same TTL/list-cache pattern as video SKUs). Bill studio estimates and usage from `characters × prompt` (+ optional `duration × completion`). Leave `submitSpeech` alone: when speech returns raw bytes with no `usage.cost`, keep using `immediate?.costUsd ?? estimated`.

This is closer to a tiny fixed video SKU table than to image `lines`, but it fits prompt/completion pricing without inventing billable/unit rows OpenRouter does not publish for speech.

---

## 1. Chosen `OpenRouterQuote` audio variant

```ts
export type OpenRouterQuote =
  | { kind: "video"; skus: Record<string, number>; sizes?: string[] }
  | { kind: "image"; lines: ImagePriceLine[] }
  | {
      kind: "audio";
      /** USD per input character (`pricing.prompt`). */
      prompt: number;
      /** USD per second of generated audio (`pricing.completion`). */
      completion: number;
    };
```

Semantics (from `pricing-samples.json`):

| Model style | `prompt` | `completion` | Estimate needs |
|---|---|---|---|
| Typical TTS (ElevenLabs, Kokoro, Voxtral) | per character | `0` | characters only |
| Seed Audio | `0` | per second | duration (seconds) |
| Gemini TTS | both non-zero | both | characters + duration |

Parse with `Number(raw)`; treat non-finite as missing (skip model / return null quote). Zero is a valid rate (means “this leg does not bill”).

Do **not** reuse `ImagePriceLine` or video SKU key soup: speech pricing is two named scalars on the models list, not endpoint price rows or `pricing_skus`.

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
  /** Spoken script length (`plane.prompt.text.length`). Audio surface only. */
  characters?: number;
};

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
  const characters = Math.max(0, input.characters ?? 0);
  const duration = input.duration && input.duration > 0 ? input.duration : 0;
  const batch = Math.max(1, input.batch);
  const per =
    quote.prompt * characters + quote.completion * duration;
  const total = per * batch;
  return total > 0 ? total : null;
}
```

Notes:

- Character-priced studio defaults light up as soon as the prompt is non-empty and `prompt > 0`.
- Completion-only models stay `null` until a positive `duration` is on the input (no WPM guess in this design).
- Dual-rate models under-estimate if duration is omitted; that is acceptable for v1 (catalog defaults are character-priced TTS).
- `batch` multiplies like image output: N speech submits ⇒ N × one-script cost.
- Empty prompt ⇒ `null` (same “hide label” behavior as other surfaces when total ≤ 0).

---

## 3. How `quoteFor` fetches prices (path + cache)

### Path

Exact OpenRouter call (via existing `openRouterJson` / `credentials.baseUrl`):

```
GET {baseUrl}/models?output_modalities=speech&endpoints=/api/v1/audio/speech
```

Example relative path passed to `openRouterJson`:

```ts
"/models?output_modalities=speech&endpoints=/api/v1/audio/speech"
```

Do **not** use `/audio/speech/models` — that endpoint has voices/formats but **no** pricing (caps already use it via `speechCaps`).

### `quoteFor` branch

```ts
export async function quoteFor(...): Promise<OpenRouterQuote | null> {
  // ... openrouter + slug guards ...
  const model = getModel(modelId);
  if (model.surface === "audio") {
    const rates = await speechRates(context.credentials, slug);
    return rates ? { kind: "audio", prompt: rates.prompt, completion: rates.completion } : null;
  }
  // existing video / image branches
}
```

Remove today’s early `if (model.surface === "audio") return null;`.

### Cache (video-list pattern)

Speech prices arrive as one list for all models → cache like `videoSkuCache`, not per-slug `imagePriceCache`:

```ts
const PRICE_TTL_MS = 5 * 60_000; // already shared

let speechPriceCache: {
  at: number;
  models: Map<string, { prompt: number; completion: number }>;
} | null = null;

async function speechRates(
  credentials: { apiKey: string; baseUrl: string },
  slug: string,
): Promise<{ prompt: number; completion: number } | null> {
  if (!speechPriceCache || Date.now() - speechPriceCache.at > PRICE_TTL_MS) {
    const payload = await openRouterJson(
      credentials,
      "/models?output_modalities=speech&endpoints=/api/v1/audio/speech",
    );
    const models = new Map<string, { prompt: number; completion: number }>();
    for (const item of asList(/* payload.data */)) {
      const row = asObject(item, "pricing");
      if (typeof row.id !== "string") continue;
      const pricing = asObject(row.pricing, "pricing");
      const prompt = Number(pricing.prompt);
      const completion = Number(pricing.completion);
      if (!Number.isFinite(prompt) || !Number.isFinite(completion)) continue;
      models.set(row.id, { prompt, completion });
    }
    speechPriceCache = { at: Date.now(), models };
  }
  return speechPriceCache.models.get(slug) ?? null;
}
```

Server-only: composer still calls `openRouterQuote` → `quoteFor`; browser never hits OpenRouter. Caps and quotes stay separate endpoints/caches.

---

## 4. Composer + `estimatePlaneUsd` wire for characters

Spoken script = billable text: `input: plane.prompt.text` in `mapSpeech`. Character count = that string’s `.length` (JS UTF-16 code units; same string the API receives).

### Composer (`composer.tsx`)

Existing quote effect stays (`openRouterQuote(model.id)`). Extend the `estimateUsd` call:

```ts
const estimate = quote
  ? estimateUsd(quote, {
      resolution: /* unchanged */,
      aspectRatio: /* unchanged */,
      duration: Number.isFinite(Number(values.duration)) ? Number(values.duration) : undefined,
      audio: values.generateAudio === true || values.sound === true,
      images: referenceCounts.images,
      videos: referenceCounts.videos,
      audios: referenceCounts.audios,
      batch: batchValue,
      characters: prompt.text.length, // new — Audio (and harmless on other surfaces)
    })
  : null;
```

Generate label already does `Generate ${formatUsd(estimate)}` when `estimate !== null` — no label rewrite once quote + characters work.

Optional: only pass `characters` when `surface === "audio"`; either way image/video estimators ignore the field.

### `estimatePlaneUsd` (`usage/record.ts`)

```ts
return estimateUsd(quote, {
  // ...existing fields...
  batch: batch > 0 ? batch : 1,
  characters: plane.prompt.text.length,
});
```

`rememberUsage` already does `quoteFor` → `estimatePlaneUsd` → `recordUsage`; once audio quotes exist, usage rows and gallery `costUsd` (via `usage_events.cost_usd`) fill without a new recording path.

---

## 5. Usage recording when speech returns no `usage.cost`

`submitSpeech` returns raw audio bytes; `immediate` has no `costUsd` today. Keep that.

Existing chain already covers the gap:

```ts
const estimated = estimatePlaneUsd(quote, plane);
const costUsd = immediate?.costUsd ?? estimated;
await recordUsage({ ..., costUsd, status: settled ?? "pending" });
```

For completed TTS:

1. `immediate.status === "completed"` → `usageStatusFromPlatform` → `"success"`.
2. `immediate.costUsd` undefined → fall back to **estimated** from the new audio quote.
3. `recordUsage` writes `cost_usd` / credits on insert.
4. Gallery / viewer read `costUsd` from usage / history as they already do for image/video.

`settleUsage` / later status polls: speech jobs are immediate and usually never re-settled via `/videos/{id}`. If a settle path runs with no `status.costUsd`, existing logic keeps the row’s prior `cost_usd` (`COALESCE` / “prefer positive new cost else existing”). Do **not** clear estimated cost to null.

No change required in `submitSpeech` for v1. If OpenRouter later adds JSON usage on speech, `readCost` + `immediate.costUsd` would win over estimate automatically.

---

## 6. Alternatives considered and rejected

| Alternative | Why rejected |
|---|---|
| Reuse `{ kind: "image"; lines }` with synthetic `billable`/`unit` rows | Speech list is not endpoint pricing; fake lines add mapping without reusing `estimateImage` (units are character/second, not image/megapixel). |
| Stuff rates into `{ kind: "video"; skus }` (`prompt` / `completion` keys) | Pollutes video estimator (`tokenUsd`, per-second heuristics). Wrong surface semantics. |
| Hardcoded USD table in catalog / UI | Forbidden: catalog is models only; prices must stay server-fetched from OpenRouter. |
| WPM / char→seconds heuristic for Seed Audio / Gemini completion | Extra concept; grounding asks smallest diff for character-priced studio defaults. Leave completion-only as `null` until a real duration control exists. |
| Parse cost from speech response headers / body | Bytes-only response; no `usage.cost` today. Estimate fallback is the product path. |
| Per-slug cache like `imagePriceCache` | List endpoint already returns every speech model; video-style whole-list cache is fewer round trips. |

---

## 7. Risks

1. **Completion-priced models** (Seed Audio): Generate preview stays blank without `duration` on `EstimateInput`; usage may also lack cost unless duration is wired later.
2. **Dual-rate models** (Gemini TTS): character-only estimate under-bills if `completion > 0` and duration is unknown.
3. **Character metric**: JS `.length` vs provider grapheme/byte counting can drift slightly for emoji / combining marks; usually negligible for Latin scripts.
4. **Empty / whitespace prompt**: estimate null until there is billable length; user may still click Generate and get a provider error — same as today.
5. **Stale cache (5 min)**: OpenRouter price changes lag until TTL; same as video/image.
6. **Slug mismatch**: quote keyed by OpenRouter model `id`; if `openRouterSlug` diverges from list `id`, cache miss → null quote (fail soft, no crash).
7. **Verify harness**: `pnpm verify:studio` must keep calling server `openRouterQuote` only — never browser → OpenRouter or `/audio/speech` for pricing.
8. **Team spend / credits**: estimated USD becomes the charged figure when no provider cost exists; if estimate is wrong, credits follow the estimate until a real `usage.cost` appears.

---

## Implementation touch list (for a later code candidate — not this artifact)

| File | Change |
|---|---|
| `src/generation/estimate.ts` | Audio quote arm + `characters` on `EstimateInput` + `estimateAudio` |
| `src/generation/engine.ts` | `speechPriceCache`, `speechRates`, audio branch in `quoteFor` |
| `src/usage/record.ts` | Pass `characters: plane.prompt.text.length` |
| `src/openhiggsfield/composer.tsx` | Pass `characters: prompt.text.length` into `estimateUsd` |

Out of scope for the pricing light-up: `submitSpeech`, caps path, catalog model list, UI chrome beyond the existing Generate USD label.
