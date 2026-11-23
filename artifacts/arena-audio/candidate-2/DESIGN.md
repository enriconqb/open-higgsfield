# Audio surface — SurfaceOps registry

Goal: an Audio tab that feels like Video (rail, composer, gallery, history, usage) while generation stays on the catalog + server-action path. Smallest durable change is a typed registry of per-surface operations so the third surface does not triple every `image ? … : video` branch.

## 1. Chosen shape name

**SurfaceOps registry**

One `Record<Surface, SurfaceOps>` (plus a small `SURFACES` const array) owns submit, plane mapping, settle/archive, gallery render hints, prompt/media store access, defaults, caps, and quote. Call sites look up `ops[surface]` instead of growing ternaries. Image and video keep today’s behavior; audio plugs in as a third row.

Principles that forced this shape: **Model the Domain** (table over scattered conditionals), **Redesign from First Principles** (audio as if it had been day-one), **Foundational Thinking** (ops table before feature code), **Laziness Protocol** (thin function table, not a plugin host), **Experience First** (Audio tab parity with Video).

## 2. Core types

### Surface and job kind

```ts
export type Surface = "image" | "video" | "audio";
```

`api_jobs.kind` and `usage_events.kind` become the same three values. `UsageKind` and `ApiJobKind` alias `Surface` (or stay equal unions). `MediaRole` and `MentionKind` already include `audio`; do not conflate role `audio` (attachment on a video model) with surface `audio` (TTS generation).

### GenerationStatus

Extend the finished payload with a single-result audio slot, symmetric with video:

```ts
export type GenerationStatus = {
  status: string;
  requestId: string;
  images?: Array<{ url: string; sourceUrl?: string }>;
  video?: { url: string; sourceUrl?: string };
  audio?: { url: string; sourceUrl?: string; mime?: string };
  error?: unknown;
  costUsd?: number;
};
```

TTS returns one clip per request. Batch still means N submits, like video.

### SurfaceOps

```ts
export type SurfaceOps = {
  /** Default catalog model id when the persisted slot is missing. */
  defaultModel: string;
  /** Thumb / card aspect CSS; audio uses a fixed wide bar, not a frame ratio. */
  thumbRatio: string;
  promptStore: () => PromptStoreApi;
  mediaStore: () => MediaStoreApi;
  /** Build OpenRouter JSON (or speech body) from a snapped plane. */
  mapPlane: (plane: GenerationPlane, slug: string) => Record<string, unknown>;
  /** Platform submit; audio and image set `immediate`. */
  submit: (client: PlatformClient, body: Record<string, unknown>) => Promise<QueuedGeneration>;
  /** Archive completed status fields into `/api/uploads/...` URLs. */
  archiveStatus: (
    context: GenerationContext,
    requestId: string,
    status: GenerationStatus,
  ) => Promise<GenerationStatus>;
  /** Gallery / history: how a completed status becomes RunRecord urls. */
  resultUrls: (status: GenerationStatus) => string[];
  /** Mime hint when archiving a run record without Content-Type. */
  archiveMime: string;
  /** Optional caps/quote hooks; audio may return null until pricing lands. */
  fetchCaps?: (credentials: Creds, slug: string) => Promise<OpenRouterCaps>;
  fetchQuote?: (credentials: Creds, slug: string) => Promise<OpenRouterQuote | null>;
  /** Gallery card chrome: element kind and optional badge. */
  card: {
    mediaKind: "image" | "video" | "audio";
    badgeFromSettings?: (settings: Record<string, unknown>) => string | undefined;
  };
};
```

Illegal states the registry prevents (Type System Discipline): a `Surface` without an ops row fails at the typecheck (`satisfies Record<Surface, SurfaceOps>`). Callers that still ternary on surface are the smell to delete in the same wave (Migrate Callers Then Delete).

### ModelEntry helpers

In `defaults.ts`, add `audioModel(id, label, paths?)` parallel to `imageModel` / `videoModel`:

- `surface: "audio"`
- `roles: {}` (no media tray attachments for v1 TTS; text + settings only)
- `settings`:
  - `voice`: enum (model-specific defaults; OpenAI-style `alloy | echo | fable | onyx | nova | shimmer` as the seed set unless caps overlay widens it)
  - `outputFormat`: enum `mp3 | wav | opus | flac` (maps to OpenRouter `response_format`)
  - `speed`: range `0.25..4.0`, default `1`, step `0.05`

`PlatformPaths` gains optional `speech?: string` or reuse `text` as the speech path key. Prefer a dedicated `speech` key so video `text` paths stay unambiguous.

### Settings fields

No aspect/resolution/duration on audio. Composer pills come from `ModelEntry.settings` only. Labels in `data.ts`: `voice` → Voice, `outputFormat` already labeled Format, `speed` → Speed (`1×` style via `settingValueLabel`).

## 3. Generation path

### Boundary

Browser never calls OpenRouter. Studio → server action → `submitPlane` → platform client. Same as image/video (Boundary Discipline).

### Platform client

Add `submitSpeech(body)` on `createPlatformClient`:

1. `POST {base}/audio/speech` with JSON `{ model, input, voice, response_format, speed }` (OpenAI-compatible).
2. Response is **raw audio bytes**, not JSON. Read `arrayBuffer()`, take `Content-Type` (fallback from `response_format`).
3. Write bytes through `ensureArchivedUrl`’s byte path (or a thin `writeArchive` helper) under the user + synthetic `aud-{uuid}` request id.
4. Return `QueuedGeneration` with `immediate: { status: "completed", requestId, audio: { url: localUploadUrl, mime } }` — same settle shape as `submitImage`.

No poll. `client.status` stays video-only; audio never enters `statusesFor` as pending.

### Engine

`submitPlane` becomes:

```ts
const { surface, body } = toPlatform(parsed); // surface from model
const queued = await SURFACE_OPS[surface].submit(client, body);
```

`archiveGenerationStatus` delegates media archival to `SURFACE_OPS[kind].archiveStatus` (or branches only on which of `images` / `video` / `audio` is present — prefer ops so mime and URL extraction stay local).

`toPlatform` returns `{ surface, body }` via `ops.mapPlane`. Higgsfield path unchanged and **rejects** `surface === "audio"` (out of scope).

### Bytes → gallery URLs

Immediate audio status already holds an archived `/api/uploads/<id>` URL. Gallery mirror (`gallery.ts`) uses `ops.resultUrls` so audio rows store one url, `surface: "audio"`, `kind: "audio"`. History reuse restores prompt text + settings; media tray stays empty for TTS models.

Usage: `recordUsage({ kind: model.surface })` already works once `UsageKind` includes `audio`. Immediate success settles like images.

## 4. Catalog seed

Seed a small OpenRouter TTS set under `src/generation/catalog/` (e.g. `openai-tts.ts` + entries in the catalog index / openrouter extras). Confirm slugs against `GET /api/v1/audio/speech/models` at implement time; provisional seed:

| Studio id | Label | OpenRouter slug |
| --- | --- | --- |
| `or-openai-tts-1` | OpenAI TTS | `openai/tts-1` |
| `or-openai-tts-1-hd` | OpenAI TTS HD | `openai/tts-1-hd` |

If the models list returns different ids, map them in `openrouter-slugs.ts` the same way image/video slugs are mapped. Do not hardcode the list in UI.

Setting → request body:

| SettingField | Body key |
| --- | --- |
| (prompt text) | `input` |
| `voice` | `voice` |
| `outputFormat` | `response_format` |
| `speed` | `speed` |

`paths.speech` unused if the client always posts `/audio/speech`; keep the field only if a later model needs a non-default path.

Default active model for audio: first seeded id (`or-openai-tts-1`).

## 5. Client / UI touch list

Replace surface ternaries with ops lookups. Touch list:

| Area | Change |
| --- | --- |
| `catalog/types.ts` | `Surface` += `audio` |
| `catalog/defaults.ts` | `audioModel` helper |
| New catalog module(s) | TTS `ModelEntry` rows + slug map |
| `stores/active.ts` | `modelBySurface.audio`, rehydrate default via `ops.defaultModel` |
| `stores/prompt.ts` | `useAudioPrompt` (same factory) |
| `stores/media.ts` (or equivalent) | `useAudioMedia` empty/no-op tray; keeps `plane.ts` uniform |
| `plane.ts` | `ops[surface].promptStore` / `mediaStore` |
| `platform.ts` | `submitSpeech`, `GenerationStatus.audio` |
| `to-platform.ts` | audio branch via ops |
| `engine.ts` | submit + archive via ops; caps/quote null-safe for audio |
| `gallery.ts`, `archive-media.ts` | audio urls + mime |
| `api-jobs.ts`, `usage/record.ts`, `usage/dashboard.ts` | kind unions |
| `openhiggsfield/data.ts` | `SURFACES`, labels, placeholders, samples, setting labels |
| `openhiggsfield/openhiggsfield-app.tsx` | view rail includes Audio; generate/reuse/filter use ops |
| `composer.tsx` | prompt store via ops; no media tray when `roles` empty |
| `gallery.tsx` / artwork / viewer | `<audio controls>` card; `thumbRatio` from ops |
| `history.ts` | accept `surface === "audio"` |
| `model-picker.tsx` | filters by `surface` already |
| `asset-picker.tsx` | drop or soften “Runs never return audio” empty copy for surface runs |
| `compare.tsx` | keep audio out of compare stage (cross-view); filter kind may add `audio` later — out of v1 polish if compare already skips non-visual |
| Share / `/api/s` | leave image\|video unless share of audio is required; defer share of audio clips |

UX parity (Experience First): gallery rail order `Image | Video | Audio | Assets | …`. Composer placeholder and sample shelf for spoken scripts. Card shows waveform-less player bar with voice/format badge optional. Switching tabs remembers model per surface like today.

Minimize Reader Load: one file `src/generation/surface-ops.ts` (or `surfaces/registry.ts`) is the answer to “what does audio do on submit / archive / card?”. Do not wrap each method in a class hierarchy.

## 6. DB / migrations files to add

Ship SQL only; do not execute (repo rule).

1. `database/migrations/0XX_audio_kind.sql` (next free number):

```sql
-- Add audio to generation kind enums. Review and run via: pnpm db:migrate

ALTER TABLE api_jobs
  MODIFY kind ENUM('image', 'video', 'audio') NOT NULL;

ALTER TABLE usage_events
  MODIFY kind ENUM('image', 'video', 'audio') NOT NULL;
```

2. No change to `shares.kind` in v1 (audio share deferred).
3. `generation_results` stores surface/kind in JSON or varchar paths already used by the app; confirm at implement time and only migrate if a column ENUM blocks inserts.

## 7. verify-studio feature recipe outline

Update `features/studio-home.md` (and FEATURES index row) so the rail expects **Audio** beside Video.

New or extended feature file sketch:

```md
# Studio home (audio scope)

## Sub-features
- studio-scopes includes Image, Video, Audio, Assets, Favorites
- studio-audio-composer shows audio placeholder when Audio is selected
- studio-audio-picker lists catalog models with surface audio only
- studio-no-generate unchanged

## How to get to it
- Sign in → `/` → click Audio on the gallery scope rail

## Driving it with verify-studio
- Open studio after sign-in
- Click the Audio scope control
- Assert body text includes Audio; `.ohf-composer` present
- Assert prompt placeholder matches audio copy
- Open model picker; assert at least one TTS label from catalog
- Network fence: no openrouter.ai, no /api/v1/videos|/images|/audio
- Never press Generate

## Gotchas
- Empty gallery OK
- Media tray may be hidden when roles are empty
```

Default CLI feature list gains the Audio rail assertion inside `studio-home` so `pnpm verify:studio` fails if the tab is missing.

## 8. Rejected alternatives

1. **Triple every ternary (`image ? … : video ? … : audio`)**  
   Lowest upfront ceremony, highest blast radius. `openhiggsfield-app.tsx`, `plane.ts`, `composer`, `engine`, `gallery`, `active` store, and archive paths each grow a third arm. The next surface repeats the tax. Rejected under Model the Domain and Minimize Reader Load.

2. **Reuse Video surface with an “audio output” setting**  
   Avoids `Surface` growth, but the Audio tab users expect never appears, gallery filters stay video-shaped, and TTS sync bytes fight video poll semantics. Rejected under Experience First and Boundary Discipline (wrong platform path).

3. **Full plugin / lifecycle framework (register, hooks, DI)**  
   Would centralize behavior but adds layers (loader, capability flags, abstract base) for three rows of functions. Laziness Protocol and Minimize Reader Load reject it. A plain `satisfies Record<Surface, SurfaceOps>` object is enough.

4. **Client-side fetch to `/api/v1/audio/speech` from the browser**  
   Violates hard constraint: generation goes through `src/generation` + server actions. Rejected on the spot.

5. **Async job + poll for speech “for symmetry with video”**  
   OpenRouter speech is immediate bytes. Inventing a poll loop adds fake pending states and unused `status()` calls. Prefer image-like `immediate` completion.
)
