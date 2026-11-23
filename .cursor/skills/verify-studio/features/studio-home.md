# Studio home

Studio home is the signed-in surface at `/`: one composer for Image and Video, plus a gallery scope rail.

## Sub-features

- `studio-composer` shows `.ohf-composer` after sign-in.
- `studio-scopes` shows gallery tabs Image, Video, Assets, and Favorites (Archive, Timeline, Compare, Tools may also appear).
- `studio-no-generate` never submits a prompt or hits generate APIs.

## How to get to it (user POV)

- Sign in successfully (lands on `/`).
- From `/account`, `/profile`, or `/usage`, choose Back to studio when offered.
- Open `http://localhost:3000/` while already signed in.

## Driving it with verify-studio

Preconditions:

- Sign-in feature already proved in this run, or a valid session cookie exists in the headless profile.
- Doctor passed.
- Do not pass `--generate`.

- **Open studio.** After login, navigate to `/` if needed. Run `pnpm verify:studio` (CLI asserts `/` after login).
- **Composer present.** Evaluate `Boolean(document.querySelector('.ohf-composer'))` — must be `true`.
- **Gallery rail.** Body text includes `Image`, `Video`, `Assets`, and `Favorites`.
- **Network fence.** No request URL may contain `/api/v1/videos`, `/api/v1/images`, or `openrouter.ai`.
- **Proof.** `artifacts/<run-id>/studio.png` and `studio.txt` show the composer dock and scope labels. `summary.json` has `generate: false`.

## Gotchas

- Extra tabs (Archive, Timeline, Compare, Tools) are fine; missing Image/Video/Assets/Favorites fails.
- `Ctrl+Enter` submits the prompt — never send that key during verification.
- An empty gallery is not a failure; empty states still leave the composer and rail visible.
- Catalog models live under `src/generation/catalog/`; do not hardcode a parallel list when asserting the picker.
