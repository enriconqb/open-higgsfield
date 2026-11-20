# Feature map

Catalog entries in `src/generation/catalog/` decide which models, settings, and media roles the studio shows. Do not copy that list into a component.

| Route | How to reach it | What must be visible | Stop before |
| --- | --- | --- | --- |
| `/login` | Open `/login` | Labels Username and Password, button Sign in, link Request access | Submitting a second account |
| `/register` | Link Request access on `/login` | Title Request access | Creating a user unless the task is registration |
| `/` | Sign in, or Back to studio | Composer `.ohf-composer`. Gallery scope rail: Image, Video, Assets, Favorites. Prompt placeholder for the active surface. `Ctrl+Enter` submits, but verification must not press it | Generate, model runs, OpenRouter |
| `/account` | User menu, Change password | Title Change password | Saving a new password during a UI check |
| `/profile` | User menu, Profile | Title Profile | Editing identity unless that is the task |
| `/usage` | User menu, Usage | Usage page | Treating an empty ledger as a generate failure |
| API tokens | User menu, API tokens. This opens a studio dialog, not `/account` | Title API tokens, button Create token | Creating a `vic_` token during a UI check |
| `/admin` | Open `/admin` | Redirects to `/` | Treating the redirect as a missing admin page |
| `/s/[token]` | Share link only | Public share preview for a real token | Inventing a token. An unknown token is a 404 |

Signed-out visitors can open `/`. Generate stays behind an approved login. The top bar lamp is the key state. Verification stops at the composer and the gallery rail.
