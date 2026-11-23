# Audio surface — candidate 1

## 1. Chosen shape name

**Surface triad + speech-immediate**

`Surface` becomes `"image" | "video" | "audio"`. Audio generation is OpenRouter TTS only (`POST /api/v1/audio/speech`), completed inside submit the same way images already are (`QueuedGeneration.immediate`), with raw bytes archived to `/api/uploads/<id>` before the client sees a gallery URL.

## 2. Core types

### Surface and job kind

```ts
// catalog/types.ts
export type Surface = "image" | "video" | "audio";
```

Propagate the same three-way union everywhere `kind` is today tied to surface:

| Location | Change |
| --- | --- |
| `ApiJobKind` (`api-jobs.ts`) | `"image" \| "video" \| "audio"` |
| `usage_events.kind` / `api_jobs.kind` (MySQL ENUM) | add `'audio'` via migration text |
| `RunRecord.kind` + `RunRecord.surface` (`history.ts`) | both accept `"audio"` |
| `isRunRecord` surface guard | allow `audio` |
| `MappedRequest.surface` (`to-platform.ts`) | include `"audio"` |

`MediaRole` and `MentionKind` already include `audio` for **video** models that take audio refs. Do not repurpose that role as “this surface makes audio.” TTS catalog entries use `roles: {}` (prompt-only).

### GenerationStatus / ApiJobResult

Mirror video’s single-object media slot (one speech stream per request), not image’s array:

```ts
// platform.ts GenerationStatus
audio?: { url: string; sourceUrl?: string };

// api-jobs.ts ApiJobResult
audio?: { url: string; sourceUrl?: string };
```

`jobResultFromStatus` copies `status.audio` the same way it copies `status.video`. Gallery mirror (`gallery.ts`) treats `kind === "audio"` like video: one studio row per `requestId`, `urls: [archivedUrl]`.

### ModelEntry helpers

Add beside `imageModel` / `videoModel` in `defaults.ts`:

```ts
export function audioModel(
  id: string,
  label: string,
  settings: {
    voice: readonly string[];
    responseFormat?: readonly string[]; // default ["mp3", "pcm"]
    speed?: { min: number; max: number; default: number; step?: number };
  },
): ModelEntry
```

- `surface: "audio"`
- `roles: {}` (no tray)
- `settings.voice`: `{ type: "enum", values, default: values[0] }`
- `settings.responseFormat`: enum of formats the model accepts (prefer `mp3` as default when listed)
- `settings.speed`: optional range when the speech-models catalog publishes one
- no `paths` (TTS has a fixed endpoint; `PlatformPaths` stays image/video)

### Settings fields (catalog → OpenRouter body)

| SettingField key | OpenRouter body | Notes |
| --- | --- | --- |
| (prompt text) | `input` | plane.prompt.text |
| `voice` | `voice` | required for most models |
| `responseFormat` | `response_format` | `mp3` \| `pcm` (and `wav` only if a seeded model lists it) |
| `speed` | `speed` | omit from body when model has no speed field |

Skip free-text `instructions` in v1: `SettingField` has no string type, and the prompt is already the spoken text. Models that honor delivery instructions can gain a later field without changing the surface model.

`metaOf` for audio: `voice · responseFormat · speed` (pill-friendly). `describeModel`: `"Speech from a prompt · …voices"`.

## 3. Generation path

### Platform client

Extend `createPlatformClient` with `submitAudio(input): Promise<QueuedGeneration>`:

1. `POST ${base}/audio/speech` with JSON body (`model`, `input`, `voice`, `response_format`, optional `speed`).
2. Do **not** use the existing `send()` helper that always `readJson`s. Speech returns `audio/*` bytes on success and JSON only on error.
3. On non-OK: parse JSON error → `PlatformError`.
4. On OK: read `ArrayBuffer` → write through the same local upload helpers image/video archive already use → get `/api/uploads/<id>`.
5. Synthesize:

```ts
{
  status: "completed", // or "failed" if zero bytes
  requestId: `aud-${crypto.randomUUID()}`,
  statusUrl: "",
  cancelUrl: "",
  immediate: {
    status: "completed",
    requestId,
    audio: { url: `/api/uploads/${id}` },
    // costUsd if OpenRouter exposes it later; else undefined
  },
}
```

No `client.status` path for audio. Settlement worker never needs to poll these rows (terminal at insert, `sealed_credentials: null`), same as image.

### Mapper and engine

- `toPlatform`: if `model.surface === "audio"` → `{ surface: "audio", body: mapSpeech(plane, slug) }` with `input: plane.prompt.text`, slug from `openRouterSlug`.
- `submitPlane`: branch `image` → `submitImage`, `audio` → `submitAudio`, else `submitVideo`. Higgsfield provider: audio models are OpenRouter-only; if key kind is higgsfield, audio entries simply do not appear in `modelsFor("higgsfield")` (they only exist in the OpenRouter catalog set).
- After submit, existing `if (queued.immediate) archiveGenerationStatus(...)` stays. Extend `archiveGenerationStatus` to archive `status.audio` like `status.video` (no-op when URL is already `/api/uploads/…`).
- `rememberStudioJob` / `recordUsage` already pass `kind: model.surface` — works once ENUM and `ApiJobKind` include `audio`.

### Gallery URLs

Bytes never leave the server as a provider CDN link for TTS. The gallery card’s `urls[0]` is always the archived `/api/uploads/<id>` (playable via existing upload route). `remoteUrls` stay empty for audio unless a future provider returns a fetchable https speech URL.

Client must not call OpenRouter or invent `/api/v1/audio`; studio still goes through `submitGeneration` server action only.

## 4. Catalog seed

Seed a small fixed set in `src/generation/catalog/` (one file per model or one `tts.ts` barrel), register in `catalog/index.ts` / `OPENROUTER_EXTRAS` as appropriate, and map slugs in `openrouter-slugs.ts`.

Recommended first seeds (stable, documented by OpenRouter TTS docs):

| Studio id | OpenRouter slug | Voices (enum defaults) | Formats | Speed |
| --- | --- | --- | --- | --- |
| `voxtral-mini-tts` | `mistralai/voxtral-mini-tts-2603` | `en_paul_neutral` (+ any others listed for that model) | `mp3` only if that is all the model accepts | omit if unpublished |
| `openai-gpt-4o-mini-tts` | OpenAI mini TTS slug as listed on `/audio/speech/models` | model’s published voice enum | `mp3`, `pcm` | published range or omit |
| `eleven-v3` | `elevenlabs/eleven-v3` | e.g. `george`, `sarah`, `adam` (from speech-models API) | `mp3`, `pcm` | `0.7–1.2` if published |

Implementation rule: voice/format/speed values come from the speech-models catalog shape (`supported_parameters`), encoded as `SettingField`s — never hardcoded in the UI. Before shipping, refresh enums from `GET /api/v1/audio/speech/models` once; keep the catalog file as the studio source of truth afterward (same pattern as image/video).

Default active audio model: first seeded entry (e.g. `voxtral-mini-tts`).

## 5. Client / UI touch list

| Area | Change |
| --- | --- |
| `openhiggsfield/data.ts` | `SURFACES`, labels, `VIEWS`, placeholders, `SAMPLES` (spoken-line prompts), `SETTING_LABELS` (`voice`, `responseFormat`, `speed`), `describeModel` / `metaOf` / `durationBadge` (no duration for TTS; optional omit) |
| `stores/active.ts` | `modelBySurface.audio`, rehydrate fallback for audio |
| `stores/prompt.ts` | `useAudioPrompt` |
| `stores/media.ts` | `useAudioMedia` (empty for v1; keeps surface symmetry / reuse) |
| `composer.tsx` / `media-tray.tsx` / `openhiggsfield-app.tsx` | surface switch picks audio stores; hide tray when `rolesOf(model)` is empty |
| `model-picker.tsx` / `model-admin-panel.tsx` | filter `surface === "audio"` |
| `gallery.tsx` | audio card: artwork + `<audio controls>` (or play button) instead of img/video aspect; ratio can be a fixed wide strip |
| `artwork.ts` | `artFor("audio", …)` waveform-ish gradient (no new asset dependency) |
| `history.ts` | accept `surface`/`kind` audio in parsers |
| Gallery mirror / `RunRecord` writers | set `kind: "audio"`, `surface: "audio"` |
| Shares (`010_shares.sql` ENUM) | out of scope for first ship unless share-audio is required; note follow-up |

UX: Audio tab sits with Image / Video on the gallery scope rail. Composer prompt is the text to speak. Settings pills: Voice, Format, Speed.

## 6. DB / migrations files to add

Ship **text only** (agent does not execute writes). Next free number after `016_`:

**`database/migrations/017_audio_kind.sql`**

```sql
-- Extend job + usage kinds for the Audio surface (OpenRouter TTS).
-- Review and run via: pnpm db:migrate

ALTER TABLE api_jobs
  MODIFY COLUMN kind ENUM('image', 'video', 'audio') NOT NULL;

ALTER TABLE usage_events
  MODIFY COLUMN kind ENUM('image', 'video', 'audio') NOT NULL;
```

No change to `generation_results` (JSON payload already carries `surface` / `kind`).

Optional follow-up (not required for studio generate/gallery): `shares.kind` ENUM add `'audio'` if public share of audio rows is desired.

## 7. verify-studio feature recipe outline

Add `features/studio-audio.md` and index it from `features/README.md`. Extend `studio-home` rail assertion to include **Audio**.

Preconditions: signed-in session, doctor passed, never `--generate`.

Checks:

1. Open `/` → body text includes `Image`, `Video`, **`Audio`**, `Assets`, `Favorites`.
2. Activate Audio scope (click Audio rail) → `.ohf-composer` still present; prompt placeholder matches audio copy.
3. Model picker lists only `surface === "audio"` catalog ids (no hardcoded name list in the test beyond asserting the tab works).
4. Network fence: no browser request URL contains `openrouter.ai`, `/api/v1/videos`, `/api/v1/images`, or `/api/v1/audio`.
5. Proof: screenshot + `summary.json` with `generate: false`.

Do not press Generate; do not assert a finished clip.

## 8. Rejected alternatives

1. **Parallel “AudioPlane” / second catalog outside `Surface`.** Rejected: doubles every switch (`modelsFor`, active store, gallery view, usage kind) and fights the existing “catalog is the only model list” rule. Extending `Surface` is the smallest domain that stays consistent.

2. **Async poll like video.** Rejected: OpenRouter TTS returns raw bytes synchronously. Inventing a queued job + poll would fake latency and force sealed credentials for nothing. Image’s `immediate` pattern already exists.

3. **Audio as a mode under Video** (`generateAudio`-style flag / fake video model). Rejected: conflates “video with soundtrack” with “speech asset,” pollutes video gallery filters, and cannot reuse `/audio/speech` cleanly.

4. **Chat-completions / multimodal audio instead of `/audio/speech`.** Rejected: different contract, weaker voice/format controls, and the repo constraint names the speech endpoint as the path.

5. **Higgsfield audio in the same PR.** Rejected by grounding (OpenRouter-only unless a shared abstraction forces it). Empty `paths` + OpenRouter-only listing keeps Higgsfield clients unaware of the surface’s models.

---

### Rationale (short)

The studio already has two surfaces that share one plane, one submit action, one job ledger, and one gallery. TTS fits that lattice if it is a third surface with image-like immediacy and a dedicated byte ingest. Alternatives that invent a parallel type system or borrow video’s poll loop add machinery without matching the provider’s sync speech API.
