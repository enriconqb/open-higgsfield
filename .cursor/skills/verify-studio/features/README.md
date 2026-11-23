# Studio verification map

This directory is the maintained source for verifying the user-facing behavior of the OpenHiggsfield studio (video-gen). Read this index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- App answers at `http://localhost:3000` (not `127.0.0.1`).
- MySQL from `DATABASE_URL` is migrated and seeded (`pnpm db:migrate`, `pnpm db:seed`).
- Credentials: `VERIFY_USERNAME`/`VERIFY_PASSWORD`, or `SUPERADMIN_USERNAME`/`SUPERADMIN_PASSWORD` in `.env`.
- Chrome or Edge is installed, or `VERIFY_BROWSER` points at a Chromium binary.
- Run `node .cursor/skills/verify-studio/cli.mjs doctor` and require a pass before Drive.
- Never attach to the developer's interactive Chrome profile; the CLI uses a disposable `--user-data-dir`.
- Never press Generate or call `/api/v1/videos`, `/api/v1/images`, or OpenRouter during verification.

## Driving conventions

- Start every recipe from a signed-out headless session unless preconditions say otherwise.
- Prefer the selectors already wired in `cli.mjs` (`input[name=username]`, `.ohf-composer`, visible label text) over coordinates.
- Treat every command as literal. Keep quoted names and flags unchanged.
- Run browser actions through `pnpm verify:studio` / `node .cursor/skills/verify-studio/cli.mjs` unless a feature file names an extra CDP step.
- Do not remove proof under `.cursor/skills/verify-studio/artifacts/` during cleanup.

## Proof and skip reporting

- Capture the user action and the resulting state (screenshot + body text), not only the final screen.
- Mutation proof is out of scope for the default gate; stop before saving a new password, minting a token, or submitting Generate.
- Record the feature ID and entry point with every artifact (`summary.json` and the feature file name).
- Report an unreachable path with the attempted URL and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with verify-studio` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

Keep implementation details out of the map. Name only user paths, stable handles, required state, commands, and observable proof.

## Features

- [Sign in](./sign-in.md) covers the `/login` form and redirect into the studio.
- [Studio home](./studio-home.md) covers the signed-in composer and gallery scope rail.
- [Change password](./account-password.md) covers `/account` without saving a new password.
- [Request access](./request-access.md) covers `/register` from the login footer.
- [API tokens dialog](./api-tokens.md) covers opening the tokens panel without minting a `vic_` token.
