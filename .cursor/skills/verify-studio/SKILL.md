---
name: verify-studio
description: Drives the OpenHiggsfield / video-gen studio web UI on localhost (login, composer, gallery, account) with the CDP harness. Use when changing the studio, login, account page, or catalog-backed UI, and before claiming a change works.
---

# Verify the studio

Agent-facing gate for the **web studio** (Next.js App Router). Machine clients also hit `/api/v1/*`; this skill does **not** call generate endpoints. Read [features/README.md](features/README.md) before guessing which control a report refers to.

## Launch

From the repo root, with `.env` already holding `DATABASE_URL`, `SESSION_SECRET`, and either `VERIFY_USERNAME`/`VERIFY_PASSWORD` or `SUPERADMIN_USERNAME`/`SUPERADMIN_PASSWORD`:

```bash
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm verify:studio
```

`pnpm verify:studio` runs `tsc --noEmit`, then uses `http://localhost:3000` when something already answers `/login`, otherwise starts `pnpm dev` on port **3000** and waits until `/login` returns HTTP 200 with a Sign-in form (usable, not only a process). Ready = signed-in studio can show `.ohf-composer` after login, not merely that TCP accepts connections.

Open the app as `http://localhost:3000` (not `127.0.0.1` — Next.js blocks some DevTools/scripts for that origin in this project).

Optional override: `VERIFY_BASE_URL`, `VERIFY_BROWSER` (path to Chrome or Edge).

Teardown is built into the CLI: it kills only the headless Chrome it spawned and only the `pnpm dev` child it started. It never kills by process name and never deletes proof under `artifacts/`.

## Doctor

When anything looks off, run this first (read-only; does not sign in or mutate data):

```bash
node .cursor/skills/verify-studio/cli.mjs doctor
```

Pass means: `/login` answers 200, body includes Sign in / Username / Password, Chrome or Edge is on disk (or `VERIFY_BROWSER` is set), and verify credentials exist in the environment. Fail means do not Drive until Launch succeeds.

## Drive

Harness: headless Chromium via CDP in `.cursor/skills/verify-studio/cli.mjs` (invoked as `pnpm verify:studio`). Prefer the selectors already used there:

| Handle | Where |
| --- | --- |
| `input[name=username]` | `/login` |
| `input[type=password]` | `/login` |
| Button text `Sign in` | `/login` |
| `.ohf-composer` | `/` after sign-in |
| Visible text `Image`, `Video`, `Audio`, `Assets`, `Favorites` | gallery scope rail on `/` |
| Visible text `Change password` | `/account` |

Do **not** pass `--generate`. Do not press Generate, do not mint an API token, and do not call `/api/v1/videos`, `/api/v1/images`, `/api/v1/audio`, `/audio/speech`, or OpenRouter. A request to those URLs fails the run.

Feature recipes live under [features/](features/). Drive one mapped feature at a time unless the user asks for a broader sweep; the default CLI proves sign-in → studio home → account in one pass.

## Evidence

Each full `pnpm verify:studio` run writes under:

`.cursor/skills/verify-studio/artifacts/<run-id>/`

| File | Meaning |
| --- | --- |
| `login.png` / `login.txt` | Sign-in form before credentials |
| `studio.png` / `studio.txt` | Signed-in composer + gallery rail |
| `account.png` / `account.txt` | Change password page |
| `summary.json` | `{ ok, base, checked, generate: false, runId }` |

Proof standards: exercise the real user path (form login → studio → account), capture action and resulting state (screenshots + body text), and treat a forbidden generate network hit as failure. Mocks are not used; the platform generate boundary is simply never crossed.

## Cleanup

The CLI's `finally` block:

1. Kills the headless Chrome PID it spawned.
2. Removes its ephemeral `--user-data-dir` under the OS temp folder.
3. Kills the `pnpm dev` child **only if this run started it**.
4. Leaves `artifacts/<run-id>/` intact.

If a run aborts mid-flight, re-run the same CLI (or only `doctor`) rather than `taskkill` by image name — a shared interactive Chrome or a developer's `pnpm dev` must stay up.

## Helpers

| Command | Role |
| --- | --- |
| `pnpm verify:studio` | Full gate: typecheck + launch-if-needed + drive + evidence + cleanup |
| `node .cursor/skills/verify-studio/cli.mjs doctor` | Read-only health |
| `node .cursor/skills/verify-studio/cli.mjs` | Same as `pnpm verify:studio` |

There is no separate generate helper. Refusing `--generate` is intentional.

## Isolate

- **Port 3000** and **MySQL** (`DATABASE_URL`) are shared with the developer's session. The harness reuses an already-listening server; it does not spin a second port.
- Browser state is isolated: each run uses a fresh temp user-data dir. Do not attach to the user's everyday Chrome profile.
- Do not run two full verifies that both try to `pnpm dev` on 3000 at once. Prefer one driver; if the port is busy, `doctor` and reuse it.
- Never wipe the shared database for a UI check.

## Outer loop

This skill is the local gate. Do not start a cloud agent, Slack subscription, or Sentry hook from a chat. After `pnpm verify:studio` exits 0, a person can attach Cursor Automations by hand. A change is not done when the chat says the studio works and this command was not run.
