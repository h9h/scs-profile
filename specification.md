# scs-profile

A reference self-contained system (SCS) for [Portal](../portal) — the "Profile" domain. It exists to be a real, working example an SCS contributor can read and copy, and it demonstrates the full manifest contract: a mounted page component, an SCS-owned data endpoint supporting both `GET` and `POST`, and shared-context publishing.

Portal's own specification (`../portal/specification.md`) is the authority this SCS is built against — this document only describes scs-profile's own side of that contract, not Portal's.

## What it does

Shows and lets the current user edit two fields Portal itself doesn't know about — a short bio and an avatar URL — alongside the identity fields (`displayName`, `email`) Portal already has. Portal's own persistent frame already links to `/profile` from its header; this SCS is what makes that link resolve to something instead of "Not found."

## Architecture

A single Bun server, structurally mirroring Portal's own shell-bundling approach:

- `GET /.portal/manifest` — returns this SCS's manifest.
- `GET /.portal/bundle.js` — the built `ProfileView` component bundle, `react`/`react-dom`/`@portal/runtime` marked external (built the same way Portal's own shell bundle is: `Bun.build` with those three externalized, so the mounted component shares Portal's one React instance instead of bundling its own copy).
- `GET /profile` / `POST /profile` — this SCS's own data endpoint. Both methods are declared on the same manifest route entry (`methods: ["GET", "POST"]`), composed through Portal's proxy exactly like any other manifest route (Portal's own spec, Request flow: Data fetch).

### Manifest

```json
{
  "name": "profile",
  "bundle": "/.portal/bundle.js",
  "routes": [
    { "path": "/profile", "requiredRoles": [], "methods": ["GET", "POST"], "component": "ProfileView" }
  ],
  "nav": [{ "label": "Profile", "path": "/profile", "requiredRoles": [] }],
  "publishesContext": ["profile"],
  "consumesContext": []
}
```

`requiredRoles: []` on `/profile` is deliberate: viewing/editing a profile isn't role-gated in Portal's sense — every authenticated user may view and edit *their own* profile. Ownership isn't a Portal role at all; it's enforced entirely on this SCS's own side, using the `sub` claim (the userId) from the internal token Portal attaches to every composed request. This is the same pattern any SCS enforcing "your own X" would use — Portal's role system answers "can this class of user reach this path," not "which specific record may they touch."

### Data ownership

A single sqlite table, keyed by `userId` (the exact string Portal's internal token's `sub` claim carries — this SCS never sees or needs to know how that ID was originally derived, e.g. from an OAuth provider):

```sql
CREATE TABLE profiles (
  user_id TEXT PRIMARY KEY,
  bio TEXT,
  avatar_url TEXT
);
```

`GET /profile` returns `{ bio: string | null, avatarUrl: string | null }` for the calling user — both `null` if no row exists yet (a brand-new user hasn't set anything). `POST /profile` accepts the same shape and upserts: a malformed body (not JSON, or `bio`/`avatarUrl` present but not `string | null`) is rejected with `400` before anything is written; either field may be omitted from the body entirely, in which case that column is left unchanged rather than nulled out.

### Verifying the internal token

Portal signs an internal token (HS256, JWT-shaped: `base64url(header).base64url(payload).base64url(hmac-sha256-signature)`) for every composed request, carrying `{ sub, roles, aud, exp }`, using a secret (`INTERNAL_TOKEN_SECRET`) shared out-of-band between Portal and every SCS it composes. This SCS independently re-implements verification of that same scheme (there's no shared library between the two repos — Portal and each SCS are independent codebases by design) — this file's logic is the reference implementation the contributor guide walks through:

- Split the token on `.`, recompute the HMAC-SHA256 signature over `header.payload` using the shared secret, and reject on any mismatch (constant-time comparison — never a plain `===` on a signature).
- Reject if `exp` (an integer, seconds since epoch) has passed.
- Reject if `aud` doesn't match this SCS's own base URL (the audience Portal signed the token for) — an internal token minted for a different SCS must not be accepted here, even if legitimately signed by Portal.
- On any failure: `401`, no further detail (matches Portal's own pattern of not leaking why an internal-auth check failed).

### The component (`ProfileView`)

On mount:
1. `portalFetch("/me")` — Portal's own endpoint, for `displayName`/`email` (this SCS has no other way to learn these; they're never in the internal token, which only carries `sub`/`roles`/`aud`/`exp`).
2. `portalFetch("/profile")` — this SCS's own `GET` route, for `bio`/`avatarUrl`.
3. Once both resolve, `usePublishContext("profile")({ displayName, avatarUrl })` — so a future SCS (e.g. Portal's own spec's `orders` example already declares `consumesContext: ["profile"]`) can show the same name/avatar without knowing anything about this SCS's routes or database.

Renders a small form (bio textarea, avatar URL input, submit) that `POST`s the edited values back to `/profile` via `portalFetch`, then re-publishes the updated context on success. No client-side routing, no other pages — this is intentionally the smallest complete example, not a template for a large SCS.

## Tech stack and conventions

Matches Portal's own, for consistency and because this is meant to be read as a companion example: Bun runtime, TypeScript, real `react`/`react-dom` (JSX via React's automatic runtime), `bun:sqlite`, `bun:test` (+ `@happy-dom/global-registrator` for the one DOM-dependent component test). No dependencies beyond `react`/`react-dom` and `bun-types`/`@happy-dom/global-registrator`/`@types/react`/`@types/react-dom` as dev dependencies. No framework, no build tool beyond `Bun.build`.

## Running it

- Dev server on its own port (`4001` by default — override with `PORT`), configured the same `--env-file` way Portal itself is. Copy `.env.dev.example` to `.env.dev` and fill it in.
- Requires `INTERNAL_TOKEN_SECRET` set to the *same* value Portal's own `INTERNAL_TOKEN_SECRET` is set to (they must match — this is the shared secret described above).
- `SCS_BASE_URL` (optional, defaults to `http://localhost:<PORT>`) must exactly match whatever base URL Portal's own `PORTAL_SCS_URLS` registers this SCS under — Portal signs every internal token's audience claim to that exact string, and this SCS rejects any token whose audience doesn't match its own `SCS_BASE_URL` byte-for-byte (trailing slash, `127.0.0.1` vs `localhost`, a different port — any mismatch is a silent, undiagnosable-to-the-client 401 for every single request; check this SCS's own server logs, which do log a hint when this happens). Set it explicitly rather than relying on the default whenever the two sides might disagree.
- To register it with a running Portal instance, add its base URL to Portal's own `PORTAL_SCS_URLS` env var (comma-separated, matching Portal's existing SCS-discovery mechanism — no new Portal-side work needed).

## Out of scope

- Avatar *image* upload — `avatarUrl` is just a string field (a link to an externally-hosted image), not a file-upload pipeline.
- Any notion of a "public" profile visible to other users, or of admin-editing another user's profile — this SCS only ever reads/writes the calling user's own row.
- Deployment/production hardening (TLS, process supervision, etc.) — this is a local reference example, matching the same dev-only scope Portal itself currently has.
