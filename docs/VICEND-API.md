# Vicend API v1

Vicend is this app: a per-user gateway that keeps the platform key on the server
and drives OpenRouter behind it. This HTTP API lets a machine client —
OpenMontage, a script, `curl` — start generations **as a specific user**, without
a browser session, while every request still spends that user's key and lands in
that user's usage ledger.

Base URL is the app root plus `/api/v1`:

| Where the app runs | Base URL |
| --- | --- |
| this machine (`pnpm dev`) | `http://localhost:3000/api/v1` |
| LAN behind nginx | `http://192.168.1.100/video-gen/api/v1` |

## How a token works

```
 user                     Vicend (this app)                    OpenRouter
  │  create token           │                                    │
  ├────────────────────────►│  store sha256(token)               │
  │  vic_… (shown once)     │  store wrappingKey sealed with     │
  │                         │  SESSION_SECRET                    │
  │                         │                                    │
  │  POST /generate         │  find token → check scope/expiry   │
  ├────────────────────────►│  unseal wrappingKey → decrypt      │
  │                         │  the saved platform key            │
  │                         ├───────────────────────────────────►│
  │  202 {requestId}        │  record usage_events(requestId)    │
  │◄────────────────────────┤                                    │
```

A token is `vic_` plus 32 random bytes in base64url. Only its SHA-256 hash is
stored, so a database dump cannot be replayed as a token. Alongside the hash the
row keeps a copy of the user's password-derived **wrapping key**, sealed with
`SESSION_SECRET` — that is what lets a token unlock the stored platform key
without the account password.

**Accepted trade-off, stated plainly:** before this feature, `SESSION_SECRET` only
protected login cookies. Now, someone who obtains *both* the database and
`SESSION_SECRET` can decrypt users' saved platform keys. That is why the deploy
that introduced tokens also had to harden the web server (`.htaccess` for Apache,
`docs/NGINX-HARDENING.md` for nginx) — a leaked `.env` is no longer only a
session-forgery problem. Rotating `SESSION_SECRET` invalidates sessions **and**
every existing token, which is the intended panic button: users then mint new
tokens.

Other consequences, by design:

- **Changing the password revokes every token** for that account (the platform key
  is rewrapped with the new password, so stored copies go stale). The change
  password screen says how many were revoked.
- **Deleting the account** deletes its tokens (foreign key cascade).
- Replacing the platform key in the studio does **not** invalidate tokens; only the
  ciphertext changes, not the wrapping key.

## Create a token

1. Sign in to Vicend and open `/account`.
2. Under **API tokens**, give it a label, choose an expiry (or never), and tick the
   scopes: `read` (see jobs and the catalog) and/or `generate` (start work).
3. Press **Create token** and copy the value immediately — it is shown once. The
   panel also offers the two `.env` lines ready to paste.
4. Revoke it from the same list at any time. `Last used` shows whether something is
   still using it.

## Endpoints

Every request needs `Authorization: Bearer vic_…`. Success responses are JSON;
failures are JSON too, always shaped `{"detail": "..."}`.

### `GET /api/v1/me`

Owner, scopes, and what the token may spend. Works even when the account has no
platform key yet, so it doubles as a wiring check.

```json
{
  "userId": 3,
  "username": "enrico",
  "role": "user",
  "keyKind": "openrouter",
  "hasPlatformKey": true,
  "scopes": ["read", "generate"],
  "token": { "id": 7, "label": "OpenMontage", "expiresAt": null },
  "apiBase": "http://192.168.1.100/video-gen/api/v1",
  "usage": { "last30Days": { "credits": 412, "generations": 9 } }
}
```

`credits` is 1 credit = $0.01 of recorded cost, counted on successful jobs only.

### `GET /api/v1/models`

The studio catalog, already narrowed to the key this token spends (a Higgsfield
account and an OpenRouter account do not see the same models).

```json
{
  "platform": "openrouter",
  "hasPlatformKey": true,
  "models": [
    {
      "id": "kling-3-std",
      "surface": "video",
      "label": "Kling 3.0 Standard",
      "media": [{ "role": "start", "max": 1 }, { "role": "end", "max": 1 }],
      "settings": {
        "aspectRatio": { "type": "enum", "values": ["16:9", "9:16", "1:1"], "default": "16:9" },
        "duration": { "type": "range", "min": 4, "max": 10, "default": 5 }
      }
    }
  ]
}
```

### `POST /api/v1/generate`

```json
{
  "model": "kling-3-std",
  "prompt": "slow dolly across a rain-slick street at dusk",
  "media": {
    "start": [{ "url": "https://example.com/frame.png" }],
    "reference": ["https://example.com/style.png"]
  },
  "settings": { "aspectRatio": "16:9", "duration": 5, "resolution": "1080p" },
  "idempotencyKey": "shot-014-take-2"
}
```

| Field | Notes |
| --- | --- |
| `model` | Required. A studio id from `/models`. Unknown ids are a 400. |
| `prompt` | Required, 1–8000 characters. |
| `media` | Optional. Keys are roles: `start`, `end`, `reference`, `video`, `audio`. A role the model does not accept, or more items than it allows, is a 400. Each item is a URL string or `{ "url": ..., "id": ... }`. |
| `settings` | Optional. Studio setting names and types (string, number, boolean). Values outside a model's range are snapped to the model's own limits, not rejected. |
| `idempotencyKey` | Optional, or send the `Idempotency-Key` header instead. Letters, digits, `.`, `-`, `_`, `:` up to 128 characters. |

**Reference URLs must be `https://` or an inline `data:` URL** (image, video, or
audio). The app hands them to the provider, which fetches them itself; `http://`
and local paths are a 400.

Answers `202 Accepted` with the same body as a job read:

```json
{
  "requestId": "gen-1759...",
  "model": "kling-3-std",
  "kind": "video",
  "status": "pending",
  "costUsd": null,
  "error": null,
  "images": [],
  "video": null,
  "createdAt": "2026-10-29T04:55:10.221Z",
  "updatedAt": "2026-10-29T04:55:10.221Z",
  "reused": false
}
```

Image models finish inside the call, so their reply already carries `images`.
`costUsd` stays `null` until the provider reports the settled amount.

### `GET /api/v1/jobs/{requestId}`

The job body above. Video jobs are polled against OpenRouter on each read, so this
is the call to loop on; `reused` is absent here.

`404` covers both "no such job" and "belongs to another user" — one answer, so a
token cannot probe which request ids exist.

A repeat of `POST /generate` with the same `idempotencyKey` returns the **first**
job with `"reused": true` and bills nothing new.

### `GET /api/v1/jobs/{requestId}/files/{index}`

Image bytes for a finished job, with the stored content type. Needs the same
token; `404` when the index does not exist.

### `GET /api/v1/jobs/{requestId}/content`

Video bytes. Usually answers `302` to the provider's own URL; when only unsigned
URLs exist it streams through this app with the token's key. `?index=` picks a
clip when a job produced several.

## Errors

| Status | When | Retry? |
| --- | --- | --- |
| 400 | Bad body: missing/unknown model, missing prompt, unknown media role, too many references, non-https URL, malformed idempotency key, unknown settings type | No — fix the request |
| 401 | Missing or malformed header, unknown token, revoked token, expired token | No — mint a token |
| 402 | The provider says the account is out of credit | No — top up |
| 403 | Token lacks the scope, or the account is not active | No — new token / ask the admin |
| 404 | Unknown job, or a job owned by another user | No |
| 409 | No platform key saved, the key no longer matches the token (password changed, key re-saved from another device), or the token predates a password change | No — save the key, then mint a new token |
| 429 | Rate limited; `detail` says how many seconds to wait | Yes, after the delay |
| 502 | The provider rejected the request (`User not found.` means the stored platform key is invalid; 5xx upstream) | Maybe — fix the key first |

## Rate limits

Per token: 12 requests/minute and 120/hour by default; per user, twice the hourly
figure. Both are counted per process, so a restart forgets them and a second
worker keeps its own — enough to stop a runaway loop, not a billing control.

Override in `.env`:

```bash
VICEND_API_PER_MIN=12
VICEND_API_PER_HOUR=120
```

## Notes for client authors

- Reference media the provider must fetch has to be reachable over `https`. To use
  a local file, inline it: `data:image/png;base64,…`.
- Reuse one token per tool, not per run: `Last used` in the account panel is how a
  user notices a tool they no longer want running.
- Always keep the `requestId`: it is the key for `/jobs/{id}`, for the usage page,
  and for support questions.
- Image results are stored on the server under `uploads/` and served only through
  the authenticated route above, so a URL from a job body is not a public link.

## Testing

```bash
# End-to-end against a local Vicend: creates throwaway accounts, mints real
# tokens, drives every endpoint, deletes what it created. No money is spent —
# the platform key is deliberately fake, so the one call that reaches OpenRouter
# is expected to come back rejected.
pnpm exec tsx scripts/api-v1-selftest.ts

# Mint a long-lived local token for another tool (writes the two .env lines to
# %TEMP%\vicend-dev-env.txt, never prints the token).
pnpm exec tsx scripts/api-v1-dev-token.ts
#   VICEND_DEV_PLATFORM_KEY=sk-or-... pnpm exec tsx scripts/api-v1-dev-token.ts
#   stores a real key so a real generation can be tried against this machine.
```

Both scripts refuse to run against a database that is not on localhost unless
`--force` is passed.

## Deployment checklist

1. `pnpm db:migrate` — applies `004_api_tokens.sql` and `005_api_jobs.sql`.
2. No new required environment variables: `SESSION_SECRET` already exists. The two
   rate-limit variables are optional.
3. Harden the web server first, then rotate `SESSION_SECRET` and
   `SUPERADMIN_PASSWORD` if there is any chance they were exposed —
   `docs/NGINX-HARDENING.md`.
4. `pnpm build` and restart. `/api/v1/*` is dynamic and needs no extra config.
5. Verify: `curl -s -H "Authorization: Bearer vic_…" https://host/video-gen/api/v1/me`.

## Deliberately not in v1

- No way to read, change, or delete the stored platform key over the API. It stays
  server-side; `/me` only reports its kind.
- No user administration, no billing export.
- No webhooks: poll `/jobs/{id}`.
- No per-token spend cap yet — the rate limits above are the only brake.
