# Audio cost estimate + usage — grounding

## Goal
When the studio surface is Audio, show a Generate-button USD estimate (same as image/video) and record that cost on `usage_events` / gallery preview (`costUsd`). Today both are missing.

## Root cause (measured)
`src/generation/engine.ts` `quoteFor` early-returns `null` for `model.surface === "audio"`. Composer already calls `openRouterQuote` → `estimateUsd`; `rememberUsage` already calls `quoteFor` → `estimatePlaneUsd` → `recordUsage`. Without a quote, estimate and stored cost stay empty.

## OpenRouter pricing source
`GET /api/v1/models?output_modalities=speech&endpoints=/api/v1/audio/speech`

Each model has `pricing.prompt` and `pricing.completion` as numeric strings (USD units as OpenRouter publishes them):

- Most TTS: `prompt` = USD per input character; `completion` = `"0"`.
- Seed Audio style: `prompt` = `"0"`; `completion` = USD per second of generated audio.
- Some Gemini TTS: both non-zero (input + output style rates in the same fields).

See `pricing-samples.json` in this folder.

`GET /api/v1/audio/speech/models` has voices/formats but **no** pricing.

Speech `POST /audio/speech` returns raw bytes; `submitSpeech` today does not set `costUsd` on the immediate status (no JSON `usage.cost`).

## Existing shapes to extend (do not invent a parallel path)
- `OpenRouterQuote` in `src/generation/estimate.ts` — discriminated union `video` | `image`
- `estimateUsd(quote, EstimateInput)` + `formatUsd`
- `estimatePlaneUsd` in `src/usage/record.ts`
- Composer estimate input + Generate label in `src/openhiggsfield/composer.tsx`
- Viewer preview already renders `item.costUsd` when present

## Constraints
- Server-side quote via existing `openRouterQuote` / `quoteFor` (browser must not call OpenRouter).
- Catalog stays source of models; no hardcoded parallel price list in UI.
- Prefer smallest diff that lights up estimate + usage for character-priced TTS (studio defaults).
- `pnpm verify:studio` must not hit `/audio/speech` or openrouter from the browser during drive.

## Spoken script = billable text
Audio body uses `input: plane.prompt.text` (`to-platform.ts` `mapSpeech`). Character count for estimates = that prompt string length.
