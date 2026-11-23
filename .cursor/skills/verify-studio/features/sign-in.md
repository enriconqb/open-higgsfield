# Sign in

Sign in lets an approved user enter username and password on `/login` and land on the studio at `/`.

## Sub-features

- `sign-in-form` shows Username, Password, and Sign in.
- `sign-in-submit` accepts valid credentials and leaves `/login`.
- `sign-in-reject` surfaces a failure message for bad credentials (manual only; default gate uses a known-good pair).

## How to get to it (user POV)

- Open `http://localhost:3000/login`.
- From a signed-out studio, follow the path that sends the browser to `/login`.
- From `/register`, use the link back toward sign-in when present.

## Driving it with verify-studio

Preconditions:

- `node .cursor/skills/verify-studio/cli.mjs doctor` passes.
- Verify credentials are set in the environment.
- Headless Chrome uses a fresh profile (CLI default).

- **Open form.** Navigate to `/login`. Run `pnpm verify:studio` (CLI opens `${VERIFY_BASE_URL:-http://localhost:3000}/login`). Body text includes `Sign in`, `Username`, and `Password`. Evidence: `artifacts/<run-id>/login.png` and `login.txt`.
- **Enter credentials.** Focus `input[name=username]` and `input[type=password]`, type the verify username and password. Typed lengths must stick (username ≥ 1, password ≥ 8).
- **Submit.** Click the button whose text is `Sign in`. `location.pathname` becomes `/` within 20s. Body must not contain `Login failed` or `Invalid`.
- **Proof.** `summary.json` lists `/login` under `checked`. Do not treat a later studio assertion alone as proof of this feature.

## Gotchas

- Use `http://localhost:3000`, not `127.0.0.1`, or Next may 403 script loads and login never hydrates.
- Wait for hydration before typing; empty controlled inputs mean the React form was not ready.
- Guests can open `/` without signing in; generate stays behind an approved login. Proving browse-as-guest is a different journey.
- Do not create a second account from this recipe.
