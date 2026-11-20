---
name: verify-studio
description: Runs the video-gen studio check on localhost. Use when changing the studio, login, account page, or catalog-backed UI, and before claiming a change works.
---

# Verify the studio

Run the fixed CLI from the repo root. Do not write a new browser script for the same check.

```bash
pnpm verify:studio
```

The CLI runs `tsc --noEmit`, uses `pnpm dev` on port 3000 when nothing is listening, and signs in with `VERIFY_USERNAME` and `VERIFY_PASSWORD` when those are set, otherwise the superadmin pair in `.env`. Open the app as `http://localhost:3000`. Next.js blocks dev scripts when the origin is `127.0.0.1`.

It passes only when the signed-in studio shows the composer (`.ohf-composer`) and the gallery scopes Image, Video, Assets, and Favorites, and `/account` shows Change password.

Do not pass `--generate`. Do not press Generate, do not create an API token, and do not call `/api/v1/videos`, `/api/v1/images`, or OpenRouter. A request to those URLs fails the run.

Read [FEATURES.md](FEATURES.md) before guessing which control a report refers to. The map matches the routes in `src/app`.

## Outer loop

This skill is the local gate. Do not start a cloud agent, Slack subscription, or Sentry hook from a chat. Those connectors are not configured in this repo. After `pnpm verify:studio` exits 0, a person can attach Cursor Automations by hand. A change is not done when the chat says the studio works and this command was not run.
