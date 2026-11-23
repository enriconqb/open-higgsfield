# API tokens dialog

API tokens lets a signed-in user open a studio dialog that lists personal machine tokens. Verification opens the dialog and confirms its title; it does not create a `vic_` token during a UI check.

## Sub-features

- `tokens-open` opens the API tokens dialog from the user menu.
- `tokens-title` shows API tokens and a Create token control.
- `tokens-stop` leaves without minting or revealing a new secret during a UI check.

## How to get to it (user POV)

- User menu → API tokens (studio dialog, not a separate `/account` section).

## Driving it with verify-studio

Preconditions:

- Signed in on `/`.
- Doctor passed.
- Default `pnpm verify:studio` does **not** open this dialog; drive it only when the task touches tokens UI.

- **Open menu.** On `/`, open the user menu (button showing the signed-in username).
- **Open dialog.** Choose `API tokens`. A dialog titled `API tokens` appears with a Create token affordance.
- **Stop.** Do not click Create token or copy a newly revealed secret during a routine UI check.
- **Proof.** Screenshot the open dialog with the title visible. Record that this entry point was the one driven.

## Gotchas

- Tokens spend the account's platform key; minting one is a credential side effect.
- Password change revokes tokens — do not chain account-password save with this feature.
- Machine `curl` against `/api/v1/me` is a different surface; this map entry is the browser dialog only.
- Do not report this feature verified because `/account` showed Change password.
