# Change password

Change password is the `/account` page where a signed-in user can update their password. Verification opens the page and confirms the title; it does not save a new password.

## Sub-features

- `account-open` reaches `/account` while signed in.
- `account-title` shows Change password.
- `account-stop` leaves the form without submitting a new password during a UI check.

## How to get to it (user POV)

- User menu → Change password.
- Open `http://localhost:3000/account` while signed in.
- From Profile, follow the Change password link when shown.

## Driving it with verify-studio

Preconditions:

- Signed in (same headless session as studio-home).
- Doctor passed.

- **Open account.** Navigate to `/account`. The default CLI does this after studio assertions (`pnpm verify:studio`).
- **Confirm title.** Body text includes `Change password`.
- **Stop.** Do not fill or submit a new password during a routine UI check.
- **Proof.** `artifacts/<run-id>/account.png` and `account.txt`. `summary.json` lists `/account` under `checked`.

## Gotchas

- Saving a password revokes API tokens for that account — never do that in the default gate.
- A redirect back to `/login` means the session was lost; re-run sign-in, do not treat the redirect as a missing page.
- `/admin` redirects to `/` for non-admin flows; that is unrelated to this feature.
