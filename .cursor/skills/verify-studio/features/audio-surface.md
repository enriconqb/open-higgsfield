# Audio surface

OpenRouter TTS-only Audio tab on the studio gallery rail. Spoken script in the composer; no Generate during verify.

## Sub-features

- `audio-tab` — Audio scope visible on `/`
- `audio-composer` — switching to Audio keeps `.ohf-composer`; placeholder mentions speak/script
- `audio-model-rail` — model picker lists catalog audio labels (Voxtral / Eleven / …), not a hardcoded parallel list
- `audio-no-generate` — never press Generate

## How to get there

Signed-in studio → click Audio on the gallery rail.

## Driving it with verify-studio

1. CDP click the Audio tab.
2. Assert rail still shows Image, Video, Audio, Assets, Favorites.
3. Assert `.ohf-composer` is present.
4. Assert no forbidden network (`/api/v1/audio`, `/audio/speech`, `/api/v1/videos`, `/api/v1/images`, `openrouter.ai`).
5. Screenshot `audio-surface.png`.

## Gotchas

- Empty gallery is OK.
- Do not open share/download flows that hit speech APIs.
- PCM-only models are not in the v1 seed, so player absence is not a fail.
- Default CLI pass already asserts the Audio label via studio-home; this recipe is for audio-scoped PRs.
