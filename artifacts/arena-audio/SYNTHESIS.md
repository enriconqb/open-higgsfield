# Arena synthesis — Audio surface

## Rubric (scored)

| Criterion | C1 triad | C2 SurfaceOps | C3 Immediate Speech |
| --- | --- | --- | --- |
| Catalog + server-only generate | pass | pass | pass |
| Clear Surface / job kind `audio` | pass | pass | pass |
| Matches OpenRouter TTS (sync bytes) | pass | pass | pass |
| Gallery/composer parity without breaking I/V | pass | pass | pass |
| Controlled blast radius | good (surgical) | best (registry) | good (surgical + concrete seeds) |
| verify-studio recipe | good | good | best |

## Cross-judge

Skipped. `arena cross-judge pool` is `inherit-parent` (same as parent). No other-vendor judge available from the rule.

## Pick

**Base: candidate-3 Immediate Speech Mirror** — most concrete TTS-only seed list, explicit pcm/music rejection for v1, clear image-immediate path.

## Grafts

| From | What |
| --- | --- |
| C2 | Thin `storesFor(surface)` / lookup helpers where ternaries already cluster (`plane.ts`, app wiring). Do **not** build a full SurfaceOps plugin framework in this PR. |
| C1 | Archive TTS bytes to `/api/uploads` before gallery; request id `aud-…`; skip inventing `/api/v1/audio` client routes. |
| C3 | Catalog seeds (Voxtral default + Eleven Flash/Multilingual + Kokoro + Grok), settings voice/outputFormat/speed, migration including shares optional. |

## Rejected

- Full SurfaceOps registry as day-one deliverable (C2 whole cloth) — right direction, too much refactor alongside the feature.
- Video poll for speech (all rejected).
- Music/SFX in v1 (C3).
- Browser→OpenRouter (all).
