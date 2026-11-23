# Audio surface design — Immediate Speech Mirror

## 1. Chosen shape name

**Immediate Speech Mirror**

Audio is a first-class studio `Surface` (`"audio"`), not a video subtype and not a side panel. OpenRouter TTS answers in one HTTP round trip with raw bytes, so generation mirrors the **image** path (`QueuedGeneration.immediate`) rather than the **video** poll/settle worker. Gallery, history, usage, and verify treat audio as a peer of image/video.

v1 scope is **spoken TTS only** (text in → speech out, with voice / format / speed). Music, SFX, voice cloning, and multi-speaker dialogue stay out of the catalog until the spoken loop is solid.

---

## 2. Core types

### Surface and catalog

```ts
// catalog/types.ts
export type Surface = "image" | "video" | "audio";
```

`MediaRole` already includes `"audio"` (video reference input). TTS models for v1 declare **`roles: {}`** — no attachment tray. Do not overload `MediaRole.audio` as “output kind”; output kind is `Surface` / job `kind`.

### Job / usage / history / share kinds

| Location | Today | Change |
|---|---|---|
| `api_jobs.kind` | ENUM(`image`,`video`) | add `audio` |
| `usage_events.kind` | ENUM(`image`,`video`) | add `audio` |
| `RunRecord.kind` | `"image" \| "video"` | add `"audio"` |
| `RunRecord.surface` | via `Surface` | `"audio"` |
| `ShareKind` | `"image" \| "video" \| "timeline"` | add `"audio"` |
| `ClipKind` | `"image" \| "video"` | leave as-is for v1 (timeline stays A/V) |

`generation_results.payload` is JSON; no schema change. Payload already carries `kind` / `surface` from `RunRecord`.

### ModelEntry helpers

Add beside `imageModel` / `videoModel` in `defaults.ts`:

```ts
export function speechModel(
  id: string,
  label: string,
  settings: Record<string, SettingField>,
): ModelEntry {
  return { id, surface: "audio", label, roles: {}, settings };
}
```

No `PlatformPaths` for speech. Slug lives only in `openrouter-slugs.ts` (same pattern as images).

### Settings fields (SettingField as today)

| Key | Type | Notes |
|---|---|---|
| `voice` | `enum` | Required for every seeded model. Values = OpenRouter speech-models `voice.values` subset (curated, not the entire Azure locale dump). |
| `outputFormat` | `enum` | Values from model capability: prefer `["mp3","pcm"]` with default `"mp3"`. PCM-only models get `values: ["pcm"]`, default `"pcm"`. |
| `speed` | `range` | **Only** when the speech-models API publishes a speed range. Omit the key entirely otherwise so the rail stays clean and we never send a speed that returns 400. |

Do **not** add a free-text `instructions` SettingField in v1 (`SettingField` has no string variant). Gemini/Fish “delivery instructions” wait for a deliberate string field or a second composer line later.

Pill labels in `data.ts`: `voice` → Voice, `outputFormat` → Format, `speed` → Speed.

### Platform status shape

Extend `GenerationStatus`:

```ts
audio?: { url: string; sourceUrl?: string };
```

`url` after archive is `/api/uploads/<id>` (or data URL only before archive). `ApiJobResult` gains the same `audio` object parallel to `video`. `parseJobResult` / `jobResultFromStatus` / `archiveGenerationStatus` / gallery `buildUrls` all grow one audio branch — not a “fake video with audio/mpeg” hack.

### Active store

```ts
modelBySurface: { image: "flux-2", video: "seedance-2.5", audio: "voxtral-mini" }
```

Default surface remains image; Audio is a topbar/gallery tab like Video.

---

## 3. Generation path

### Why image-immediate, not video-async

| Fact | Consequence |
|---|---|
| `POST /api/v1/audio/speech` returns **raw audio bytes**, not a queued job JSON | There is nothing useful to poll on `/videos/{id}` |
| Image already uses `submitImage` → synthetic `requestId` (`img-…`) + `immediate` | Speech reuses that contract with `aud-…` / `speech-…` ids |
| Video settlement worker + `sealed_credentials` exist for long-running platform jobs | Wiring TTS through them adds latency, resume complexity, and false “running” tiles for a 1–5s call |

**Chosen path:** `submitSpeech` on the OpenRouter platform client, same outer flow as `submitImage`.

### Client method

```ts
// platform.ts — createPlatformClient
async submitSpeech(input: Record<string, unknown>): Promise<QueuedGeneration>
```

Behavior:

1. `POST ${base}/audio/speech` with JSON body (`model`, `input`, `voice`, optional `response_format`, optional `speed`).
2. On non-OK: parse JSON error → `PlatformError` (same as today).
3. On OK: read `arrayBuffer()`, read `Content-Type` and optional `X-Generation-Id`.
4. Build a data URL or hand bytes straight into archive helpers (`audio/mpeg` for mp3, `audio/pcm` / `audio/wav` policy for pcm — prefer archiving with explicit mime from `outputFormat`).
5. Return `{ requestId, status, statusUrl: "", cancelUrl: "", immediate: { status: "completed", requestId, audio: { url }, costUsd? } }`.
6. Failures with empty body → `immediate.status = "failed"`.

`submitPlane` becomes a three-way branch on `model.surface` (image / video / audio). Higgsfield never sees audio in v1 (OpenRouter-only; grounding).

### Mapper

```ts
// to-platform.ts
if (model.surface === "audio") {
  return {
    surface: "audio",
    body: {
      model: slug,
      input: plane.prompt.text,
      voice: plane.settings.voice,
      response_format: plane.settings.outputFormat,
      ...(typeof plane.settings.speed === "number" ? { speed: plane.settings.speed } : {}),
    },
  };
}
```

Prompt text **is** the spoken script (`input`). No mention resolution required for empty roles.

### Bytes → gallery URLs

1. `archiveGenerationStatus` (on `immediate`) archives `audio.url` via `ensureArchivedUrl` with mime from format (`audio/mpeg` / `audio/pcm`).
2. `rememberStudioJob` + `mirrorStudioJobToGallery` write one `RunRecord` with `kind: "audio"`, `surface: "audio"`, `urls: ["/api/uploads/…"]`, `ratio: "16 / 5"` (wide wave card), `meta` from voice + format + speed.
3. Studio composer treats `immediate` as terminal (existing image path in `actions.ts` / client watch) — **no** `watchRequest` poll for audio.
4. Download helper: extension from format (`mp3` / `pcm` / `wav` if we wrap pcm).

Cost: prefer OpenRouter cost if exposed on speech responses; else estimate from speech pricing endpoints later. Until pricing lands, record `costUsd` null and still write usage with `kind: "audio"`.

---

## 4. Catalog seed

Measured against live `GET /api/v1/audio/speech/models` (38 models). Seed a **small, mp3-friendly** set so gallery playback works in every browser without PCM decode glue.

### Entries (studio id → OpenRouter slug)

| Studio id | Label | Slug | Why |
|---|---|---|---|
| `voxtral-mini` | Voxtral Mini | `mistralai/voxtral-mini-tts-2603` | Documented default; mp3; clear emotion-tagged voices; **default model** |
| `eleven-flash` | Eleven Flash | `elevenlabs/eleven-flash-v2.5` | Fast; mp3; speed 0.7–1.2; familiar voice names |
| `eleven-multilingual` | Eleven Multilingual | `elevenlabs/eleven-multilingual-v2` | Quality / languages; same voice enum family |
| `kokoro` | Kokoro | `hexgrad/kokoro-82m` | Cheap open; mp3; wide speed 0.25–4 |
| `grok-voice` | Grok Voice | `x-ai/grok-voice-tts-1.0` | Short voice list (eve/ara/rex/sal/leo); mp3 |

### Concrete settings per entry

**`voxtral-mini`**

- `voice`: enum curated English Paul set — `en_paul_neutral` (default), `en_paul_happy`, `en_paul_sad`, `en_paul_excited`, `en_paul_confident`, `en_paul_cheerful`, `en_paul_frustrated`, `en_paul_angry`
- `outputFormat`: `mp3` | `pcm`, default `mp3`
- no `speed`

**`eleven-flash` / `eleven-multilingual`**

- `voice`: `rachel` is not always listed; use published set head — `george` (default), `sarah`, `adam`, `alice`, `bella`, `bill`, `brian`, `callum` (extend later from API overlay if desired)
- `outputFormat`: `mp3` | `pcm`, default `mp3`
- `speed`: range `0.7`–`1.2`, step `0.05`, default `1`

**`kokoro`**

- `voice`: `af_heart` (default), `af_bella`, `af_nicole`, `af_aoede`, `af_jessica`, `am_adam`, `am_michael`, `bf_emma` (curate ~8 from published list)
- `outputFormat`: `mp3` | `pcm`, default `mp3`
- `speed`: `0.25`–`4`, step `0.05`, default `1`

**`grok-voice`**

- `voice`: `eve` (default), `ara`, `rex`, `sal`, `leo`
- `outputFormat`: `mp3` | `pcm`, default `mp3`
- no `speed`

### Explicitly not seeded in v1

- **Gemini TTS family** — pcm-only; needs player/decode path and `instructions` UX.
- **HeyGen Voice** — pcm-only, no speed, tag syntax in prompt.
- **Microsoft MAI** — huge locale-suffixed voice enums; bad first-rail UX.
- **Fish Audio / Seed Audio 1.0** — cloning, unknown voices, and Seed’s non-speech prompt mode (SFX/music) are a different product surface.
- **Speechify / AssemblyAI / Deepgram / Qwen large lists** — defer until overlay-from-`/speech/models` exists.

Optional later: capability overlay (like image `capabilitiesFor`) that trims `voice` / `speed` from `GET /audio/speech/models/{author}/{slug}` without growing a parallel UI list.

### Music / SFX decision

OpenRouter’s only clear “describe a soundscape” path today is Seed Audio treating `input` as a free prompt (no voice). That conflicts with a Voice dial and with “script in the composer.” **Same Audio tab, different model mode** is a v2 story (e.g. `seed-audio` with empty/hidden voice). v1 catalog stays TTS-only so the rail always means speak-this-text.

---

## 5. Client / UI touch list

| Area | Change |
|---|---|
| `openhiggsfield/data.ts` | `SURFACES` += `"audio"`; labels, placeholders, samples (spoken lines, not shot descriptions); setting labels; empty-state art for audio |
| `stores/prompt.ts` | `useAudioPrompt` (`openhiggsfield.audioPrompt.v1`) |
| `stores/media.ts` | `useAudioMedia` for symmetry; stays empty with `roles: {}` (tray hidden when no roles) |
| `stores/active.ts` | `modelBySurface.audio`; fallback default `voxtral-mini` |
| `plane.ts` | Branch prompt/media stores on `surface === "audio"` |
| Topbar / gallery rail | Audio between Video and Assets (or after Video); switching surface restores remembered audio model |
| Composer | Same dock; Generate label unchanged; hide media shelf when `Object.keys(model.roles).length === 0` |
| `gallery.tsx` / `viewer.tsx` | `kind === "audio"` → `<audio controls>` + static/gradient art (no video hover scrub); reuse download |
| `history.ts` | `RunRecord.kind` includes `"audio"`; parsers accept it |
| `download.ts` | Extension from format / mime |
| `share/*` | Allow `ShareKind: "audio"`; share page plays `<audio>` (no timeline clips) |
| `usage/dashboard.ts` | Filter/kind union includes `audio` |
| `compare` / `timeline` / `unface` | No audio in those tools for v1 (filter out or ignore) |
| `asset-picker` / mentions | Existing `MentionKind.audio` stays for **video** reference audio; generated TTS rows may appear as audio assets for later Seedance attach |
| `verify-studio` fence | Ban `/api/v1/audio` and `/audio/speech` in browser network checks |

Prompt placeholder example: `Script to speak — plain sentences, punctuation for pacing…`

Samples: short VO lines (product read, podcast intro, calm narration), not cinematic shot language.

---

## 6. DB / migrations files to add

Ship SQL only (agent does not execute writes). Next free number after `016_…`:

**`database/migrations/017_audio_kind.sql`**

```sql
-- Add audio to generation kind enums (TTS surface).
-- Review and run via: pnpm db:migrate

ALTER TABLE api_jobs
  MODIFY kind ENUM('image', 'video', 'audio') NOT NULL;

ALTER TABLE usage_events
  MODIFY kind ENUM('image', 'video', 'audio') NOT NULL;

ALTER TABLE shares
  MODIFY kind ENUM('image', 'video', 'timeline', 'audio') NOT NULL;
```

No new tables. `generation_results` unchanged. If a later migration already claimed `017`, bump the filename; content stays the same.

---

## 7. verify-studio feature recipe outline

**Update** `.cursor/skills/verify-studio/features/studio-home.md`

- Gallery rail body text must include `Image`, `Video`, **`Audio`**, `Assets`, `Favorites`.
- Network fence adds `/api/v1/audio`, `/audio/speech` (and keep existing video/images/openrouter bans).

**New** `.cursor/skills/verify-studio/features/audio-surface.md`

1. **Sub-features**
   - `audio-tab` — Audio scope visible on `/`
   - `audio-composer` — switching to Audio keeps `.ohf-composer`; placeholder mentions speak/script
   - `audio-model-rail` — model picker lists catalog audio labels (Voxtral / Eleven / …), not a hardcoded parallel list
   - `audio-no-generate` — never press Generate
2. **How to get there** — signed-in studio → click Audio on the gallery rail
3. **Driving** — CDP click Audio; assert rail + composer; assert no forbidden network; screenshot `audio-surface.png`
4. **Gotchas** — empty gallery OK; do not open share/download flows that hit speech APIs; pcm-only models are not in v1 seed so player absence is not a fail

Default CLI pass can keep sign-in → studio-home → account; studio-home assertion of the Audio label is enough for the gate. Full `audio-surface` is for audio-scoped PRs.

---

## 8. Rejected alternatives

1. **Reuse video async job machinery (poll `/videos/{id}`, sealed credentials, settlement worker)**  
   TTS has no durable platform job to poll. Forcing the video worker would invent fake “running” rows, seal keys for terminal work, and couple speech to video status mapping. Wrong domain model.

2. **Ship music/SFX (Seed Audio non-speech) and voice-cloning in the same v1 surface**  
   Those flows need missing voice, optional refs, and prompt-as-sound-design semantics. Mixing them with a mandatory Voice dial produces illegal or confusing states. Experience First: polish speak-this-text first.

3. **Treat audio output as `kind: "video"` with an audio mime / fake mp4 card**  
   Breaks gallery filters, share pages, downloads, and usage dashboards. `MentionKind` already has `audio`; collapsing output into video fights the domain.

4. **Browser → OpenRouter `/audio/speech` directly**  
   Violates studio hard constraint (generation through `src/generation` + server actions only).

5. **Add a free-text `instructions` SettingField before extending `SettingField`**  
   Would special-case the settings rail or abuse `enum`. Defer until string settings are a real catalog type; seed models that work with voice/format/speed alone.

6. **PCM-first seed (Gemini / HeyGen as defaults)**  
   Gallery and share need browser-playable files. Default `mp3` keeps Immediate Speech Mirror aligned with image’s “archive then show” path without a decode sidecar.
