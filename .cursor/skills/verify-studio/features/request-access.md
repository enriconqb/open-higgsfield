# Request access

Request access is the `/register` flow for visitors who need an approved account. Verification reaches the page and confirms its title; it does not create a user unless the task is registration.

## Sub-features

- `register-link` reaches `/register` from the login footer.
- `register-title` shows Request access.
- `register-stop` leaves without creating a second account during a UI check.

## How to get to it (user POV)

- On `/login`, choose Request access.
- Open `http://localhost:3000/register`.

## Driving it with verify-studio

Preconditions:

- Doctor passed.
- `/login` is reachable.

- **From login.** Open `/login`, then follow the `Request access` link (or navigate to `/register`).
- **Confirm.** Body text includes `Request access`.
- **Stop.** Do not submit a new registration unless the task explicitly is registration.
- **Proof.** Capture a screenshot and body text under `artifacts/<run-id>/` named for this feature if driving it outside the default CLI. The default `pnpm verify:studio` pass does not open `/register`; report that entry point as unverified in that run.

## Gotchas

- Creating users without a task request pollutes the shared MySQL database.
- Approval is a superadmin concern; an unapproved account cannot prove studio-home generate readiness.
- Do not claim sign-in is verified solely because `/register` loaded.
