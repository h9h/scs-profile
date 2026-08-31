# Environment Configuration

scs-profile is configured entirely through environment variables, loaded
from a per-environment file via Bun's built-in `--env-file` flag — the same
convention Portal itself uses. This document is the full reference: every
variable this SCS reads, what it controls, and its default.

## Precedence

Every configurable value in `src/server.ts` resolves the same way, in this
order:

1. An explicit value passed via `createServer(opts)` — used by tests.
2. The matching environment variable, if set.
3. A hardcoded default.

The real entrypoint (the `if (import.meta.main)` block at the bottom of
`src/server.ts`) never passes overriding opts, so in a real deployment the
environment variable is the only lever you have.

## Variables

| Variable | Required? | Default | Purpose |
|---|---|---|---|
| `INTERNAL_TOKEN_SECRET` | Yes | — | Must be set to the *same* value Portal's own `INTERNAL_TOKEN_SECRET` is set to — this is the shared secret Portal signs every internal token with, and this SCS verifies against. |
| `PORT` | No | `4001` | Server port. |
| `SCS_BASE_URL` | No | `http://localhost:<PORT>` | Must exactly match whatever base URL Portal's own `PORTAL_SCS_URLS` registers this SCS under — Portal signs every internal token's audience claim to that exact string, and this SCS rejects any token whose audience doesn't match byte-for-byte (trailing slash, `127.0.0.1` vs `localhost`, a different port — any mismatch is a silent, undiagnosable-to-the-client `401` for every single request; this SCS's own server logs a hint when that happens). Set it explicitly rather than relying on the default whenever the two sides might disagree. |
| `MAX_REQUEST_BODY_SIZE` | No | `1048576` (1MB) | Maximum inbound request body size this SCS accepts, in bytes — far more than a bio + an avatar URL should ever need. A larger body is rejected with `413` before any handler runs. |

To register this SCS with a running Portal instance, add its base URL to
Portal's own `PORTAL_SCS_URLS` env var (comma-separated) — see Portal's own
[`docs/environment-configuration.md`](../portal/docs/environment-configuration.md)
if this repo is checked out as a sibling of Portal's.

## Example `.env`

```bash
export INTERNAL_TOKEN_SECRET=shared-secret-matching-portals-own

# --- Optional ---
# export PORT=4001
# export SCS_BASE_URL=http://localhost:4001
# export MAX_REQUEST_BODY_SIZE=1048576
```
