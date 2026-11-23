# Audio surface — shared grounding

## Goal
Add an Audio tab for OpenRouter audio-only generation. UI should feel like the Video gallery/composer but for audio. Integrate with existing studio features (catalog, generate via server actions, gallery, history, usage, verify-studio). Commit without push.

## Hard constraints (repo)
- Models live in `src/generation/catalog/`. No parallel model list in UI.
- Browser must not call OpenRouter or `/api/v1/videos|/images` directly; generation goes through `src/generation` + server actions.
- `Surface` today is `"image" | "video"` in `src/generation/catalog/types.ts`.
- `api_jobs.kind` and `usage_events.kind` are MySQL ENUM(`image`,`video`) — need migration text for `audio` (agent must NOT execute writes; only ship `.sql`).
- Image submit is already sync/immediate via OpenRouter `/images`; video is async `/videos` + poll.
- OpenRouter TTS is documented as `POST /api/v1/audio/speech` returning raw audio bytes (OpenAI-compatible), models via `GET /api/v1/audio/speech/models`.
- MediaRole already includes `audio` (for video models that take audio refs). MentionKind already includes `audio`.
- Prompt stores: `useImagePrompt` / `useVideoPrompt`. Media: `useImageMedia` / `useVideoMedia`.
- Gallery views in `src/openhiggsfield/data.ts` (`SURFACES`, `VIEWS`, placeholders, samples).
- Verify gate: `pnpm verify:studio`; never press Generate in verify.

## Out of scope for candidates
- Implementing code
- Higgsfield audio (OpenRouter-only for this surface unless a clear shared abstraction requires it)
- Pushing or opening a PR

## Artifact each candidate must write
A single Markdown design at their output path: `DESIGN.md` with sections:
1. Chosen shape name
2. Core types (Surface, job kind, ModelEntry helpers, settings fields)
3. Generation path (platform client method, settle/poll vs immediate, how bytes become gallery URLs)
4. Catalog seed (which TTS models, how voice/format/speed map to SettingField)
5. Client/UI touch list (stores, gallery card, topbar, composer)
6. DB/migrations files to add
7. verify-studio feature recipe outline
8. Rejected alternatives (2+) and why

## Trace appendix (from explore)
Audio today = MediaRole input + generate_audio on video, NOT an output surface.
Must add: Surface "audio", useAudioPrompt/useAudioMedia, submitAudio (OR POST /audio/speech), ApiJobKind/UsageKind audio, gallery tab + player, ALTER ENUM api_jobs + usage_events.
Exhaustive switch sites: catalog/types, stores (active/prompt/media/plane), engine/platform/to-platform, gallery/archive/download/viewer, openhiggsfield-app/composer/media-tray/data/topbar/history, api_jobs/usage/share, migrations 002/005/(optional 010).
