# scs-profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a real, working reference self-contained system (SCS) for Portal — a "Profile" domain that lets the current user view/edit a bio and avatar URL it owns, demonstrating the full manifest contract: a mounted page component, a `GET`+`POST` data endpoint, internal-token verification, and shared-context publishing.

**Architecture:** A single small Bun server, structurally mirroring Portal's own shell-bundling approach. Five layers, each independently testable: internal-token verification (re-implements Portal's HMAC scheme, since there's no shared library between the two independent repos), a sqlite-backed data layer keyed by userId, the manifest itself, a `Bun.build`-based bundle builder (external `react`/`react-dom`/`@portal/runtime`, same technique Portal's own shell bundle uses), the `ProfileView` React component, and the HTTP server tying all of it together.

**Tech Stack:** Bun + `bun:test` + `bun:sqlite`, TypeScript, real `react`/`react-dom`, `@happy-dom/global-registrator` for the one DOM-dependent test file — matching Portal's own stack exactly, for consistency and because this is meant to be read as a companion example. No other dependencies.

**Spec:** `specification.md` (all sections — this is a small enough project that the whole spec binds the whole plan)

## Global Constraints

- `/profile`'s manifest route entry declares `requiredRoles: []` and `methods: ["GET", "POST"]` — ownership (not role membership) gates who may edit what, enforced via the `sub` claim in the internal token, never via a Portal role. (`specification.md`)
- The internal token verification re-implementation checks, in order: structural validity (3 dot-separated parts), HMAC-SHA256 signature (constant-time comparison), `exp` not in the past, `aud` matches this SCS's own configured base URL. Any failure → treat as unauthenticated. (`specification.md`)
- `GET /profile` returns `{ bio: string | null, avatarUrl: string | null }`, defaulting both to `null` for a user with no row yet. `POST /profile` accepts the same shape; a field omitted from the body leaves that column unchanged (not nulled); a field present but not `string | null` is a `400`; a non-JSON body is a `400`. (`specification.md`)
- The bundle build marks `react`, `react-dom`, `@portal/runtime` external and inlines `react/jsx-runtime` (via the same plugin technique Portal's own `src/shell/bundle.ts` uses), so the mounted component shares Portal's one React instance instead of bundling its own copy. (`specification.md`)
- `@portal/runtime` has no real implementation in this repo (it's Portal's own module, resolved by the browser's import map at actual runtime) — `src/portal-runtime-stub.ts` exists purely so this repo's own `tsc`/`bun test` can resolve the bare specifier locally; it is never shipped (the bundle build's `external` list keeps the real specifier untouched in the built output, exactly as Portal's own identical setup already does for its own shell bundle).
- `ProfileView` fetches `/me` (Portal's own endpoint, for `displayName`/`email`) and `/profile` (this SCS's own route) on mount, publishes both via `usePublishContext("profile")`, and `POST`s edits back to `/profile`. (`specification.md`)
- No dependencies beyond `react`/`react-dom` (runtime) and `bun-types`/`@happy-dom/global-registrator`/`@types/react`/`@types/react-dom` (dev). (`specification.md`)
- Every feature needs a set of test cases, run via `bun:test`, files under `./__tests__`. (matches Portal's own `CLAUDE.md` convention, adopted here for consistency)

## File Structure

- `package.json`, `tsconfig.json`, `bunfig.toml`, `.gitignore` — **new**: project scaffold, mirroring Portal's own.
- `src/portal-runtime-stub.ts` — **new**: local dev/test-only stand-in for `@portal/runtime`, wired via `tsconfig.json`'s `paths`.
- `src/internal-token.ts` — **new**: `verifyInternalToken`.
- `src/db.ts` — **new**: sqlite-backed `getProfile`/`upsertProfile`.
- `src/manifest.ts` — **new**: the manifest object.
- `src/bundle.ts` — **new**: `getProfileBundle` (memoized `Bun.build`).
- `src/profile-view.tsx` — **new**: the `ProfileView` component.
- `src/server.ts` — **new**: `createServer`, ties everything together; `if (import.meta.main)` entrypoint.
- `__tests__/helpers/dom.ts` — **new**: `withDom()`, identical in spirit to Portal's own.
- `__tests__/internal-token.test.ts`, `__tests__/db.test.ts`, `__tests__/manifest.test.ts`, `__tests__/bundle.test.ts`, `__tests__/profile-view.test.tsx`, `__tests__/server.test.ts` — **new**.

---

### Task 1: Project scaffold + internal-token verification

**Files:**
- Create: `package.json`, `tsconfig.json`, `bunfig.toml`, `.gitignore`, `src/portal-runtime-stub.ts`, `src/internal-token.ts`
- Test: `__tests__/internal-token.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `verifyInternalToken(token: string, secret: string, expectedAudience: string): InternalTokenPayload | null`, where `InternalTokenPayload = { sub: string; roles: string[]; aud: string; exp: number }`. Task 5 consumes this.
- `src/portal-runtime-stub.ts` exports `portalFetch(input: string, init？: RequestInit): Promise<Response>` (a thin passthrough to global `fetch`) and `usePublishContext(key: string): (value: unknown) => void` (a no-op setter) — Task 4 imports these via the bare specifier `@portal/runtime`, resolved through `tsconfig.json`'s `paths`.

- [ ] **Step 1: Create the project scaffold**

Create `package.json`:

```json
{
  "name": "scs-profile",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun --env-file=.env.dev --watch src/server.ts",
    "start": "bun src/server.ts",
    "test": "bun test",
    "typecheck": "bunx tsc --noEmit"
  },
  "devDependencies": {
    "@happy-dom/global-registrator": "^20.12.0",
    "@types/react": "^19.2.18",
    "@types/react-dom": "^19.2.5",
    "bun-types": "^1.4.0"
  },
  "dependencies": {
    "react": "^19.2.8",
    "react-dom": "^19.2.8"
  }
}
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "target": "ESNext",
    "module": "ESNext",
    "moduleDetection": "force",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true,
    "jsx": "react-jsx",
    "jsxImportSource": "react",
    "types": ["bun-types"],
    "paths": {
      "@portal/runtime": ["./src/portal-runtime-stub.ts"]
    }
  }
}
```

Create `bunfig.toml`:

```toml
jsx = "react-jsx"
jsxImportSource = "react"

telemetry = false

[serve]
  port = 4001
  hostname = "localhost"

[test]
  framework = "bun:test"
  environment = "node"
  root = "./__tests__"
  coverage = true
```

Create `.gitignore`:

```
node_modules/
*.sqlite
*.sqlite-journal
*.sqlite-shm
*.sqlite-wal
.env
.env.*

.claude
```

Run: `bun install`
Expected: installs cleanly, creates `node_modules/` and `bun.lock`.

- [ ] **Step 2: Write the failing tests for `verifyInternalToken`**

Create `__tests__/internal-token.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { createHmac } from "node:crypto";
import { verifyInternalToken } from "../src/internal-token";

const SECRET = "shared-secret";
const AUDIENCE = "http://localhost:4001";

function base64url(input: string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

// Test-only: production code never signs a token, only verifies one Portal
// signed — this mirrors Portal's own signing algorithm exactly (see
// portal/src/auth/internal-tokens.ts) so these tests exercise the real wire
// format, not a simplified stand-in for it.
function makeToken(payload: Record<string, unknown>, opts: { secret?: string } = {}): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payloadEncoded = base64url(JSON.stringify(payload));
  const signature = sign(`${header}.${payloadEncoded}`, opts.secret ?? SECRET);
  return `${header}.${payloadEncoded}.${signature}`;
}

describe("verifyInternalToken", () => {
  test("verifies a validly signed, unexpired token for the correct audience", () => {
    const token = makeToken({
      sub: "user-1",
      roles: ["orders:admin"],
      aud: AUDIENCE,
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    const payload = verifyInternalToken(token, SECRET, AUDIENCE);
    expect(payload?.sub).toBe("user-1");
    expect(payload?.roles).toEqual(["orders:admin"]);
    expect(payload?.aud).toBe(AUDIENCE);
  });

  test("rejects a token signed with the wrong secret", () => {
    const token = makeToken(
      { sub: "user-1", roles: [], aud: AUDIENCE, exp: Math.floor(Date.now() / 1000) + 60 },
      { secret: "wrong-secret" }
    );
    expect(verifyInternalToken(token, SECRET, AUDIENCE)).toBeNull();
  });

  test("rejects an expired token", () => {
    const token = makeToken({ sub: "user-1", roles: [], aud: AUDIENCE, exp: Math.floor(Date.now() / 1000) - 10 });
    expect(verifyInternalToken(token, SECRET, AUDIENCE)).toBeNull();
  });

  test("rejects a token minted for a different audience", () => {
    const token = makeToken({
      sub: "user-1",
      roles: [],
      aud: "http://localhost:9999",
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    expect(verifyInternalToken(token, SECRET, AUDIENCE)).toBeNull();
  });

  test("rejects a malformed token (wrong number of dot-separated parts)", () => {
    expect(verifyInternalToken("not-a-token", SECRET, AUDIENCE)).toBeNull();
  });

  test("rejects a token whose payload isn't valid JSON", () => {
    const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const badPayload = base64url("not-json");
    const signature = sign(`${header}.${badPayload}`, SECRET);
    expect(verifyInternalToken(`${header}.${badPayload}.${signature}`, SECRET, AUDIENCE)).toBeNull();
  });

  test("rejects a token missing a required field", () => {
    const token = makeToken({ sub: "user-1", aud: AUDIENCE, exp: Math.floor(Date.now() / 1000) + 60 }); // no roles
    expect(verifyInternalToken(token, SECRET, AUDIENCE)).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun test __tests__/internal-token.test.ts`
Expected: FAIL — `src/internal-token.ts` doesn't exist yet.

- [ ] **Step 4: Implement `verifyInternalToken` and the `@portal/runtime` stub**

Create `src/internal-token.ts`:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

export type InternalTokenPayload = {
  sub: string;
  roles: string[];
  aud: string;
  exp: number;
};

function sign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

// Independently re-implements verification of Portal's own internal-token
// scheme (HS256, JWT-shaped: base64url(header).base64url(payload).signature)
// — there is no shared library between Portal and an SCS, since they are
// separate codebases by design. See specification.md, "Verifying the
// internal token".
export function verifyInternalToken(token: string, secret: string, expectedAudience: string): InternalTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;

  const expectedSignature = sign(`${header}.${payload}`, secret);
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSignature);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (typeof decoded !== "object" || decoded === null) return null;
  const obj = decoded as Record<string, unknown>;

  if (
    typeof obj.sub !== "string" ||
    typeof obj.exp !== "number" ||
    typeof obj.aud !== "string" ||
    !Array.isArray(obj.roles) ||
    !obj.roles.every((role) => typeof role === "string")
  ) {
    return null;
  }

  const payloadObj = obj as unknown as InternalTokenPayload;
  if (payloadObj.exp < Math.floor(Date.now() / 1000)) return null;
  if (payloadObj.aud !== expectedAudience) return null;

  return payloadObj;
}
```

Create `src/portal-runtime-stub.ts`:

```ts
// Stand-in for Portal's own "@portal/runtime" module, which has no real
// implementation in this repo — it's Portal's module, resolved by the
// browser's import map at actual runtime (see specification.md,
// Architecture). This file exists purely so this repo's own `tsc`/`bun test`
// can resolve the bare specifier `@portal/runtime` locally; it is wired in
// via tsconfig.json's `paths`, and is NEVER shipped in the built bundle —
// src/bundle.ts marks "@portal/runtime" external in its Bun.build call, the
// same technique Portal's own shell bundle uses for its own external
// specifiers, so the built output keeps the real bare specifier untouched
// for the browser to resolve.

export async function portalFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(input, init);
}

export function usePublishContext(_key: string): (value: unknown) => void {
  return () => {};
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test __tests__/internal-token.test.ts`
Expected: PASS, all 7 tests.

- [ ] **Step 6: Run typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json bunfig.toml .gitignore src/portal-runtime-stub.ts src/internal-token.ts __tests__/internal-token.test.ts
git commit -m "feat: project scaffold and internal-token verification"
```

---

### Task 2: Database layer

**Files:**
- Create: `src/db.ts`
- Test: `__tests__/db.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `createDatabase(path?: string): Database`, `getProfile(db: Database, userId: string): ProfileRow`, `upsertProfile(db: Database, userId: string, update: { bio?: string | null; avatarUrl?: string | null }): ProfileRow`, where `ProfileRow = { bio: string | null; avatarUrl: string | null }`. Task 5 consumes all three.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/db.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { createDatabase, getProfile, upsertProfile } from "../src/db";

describe("profile database", () => {
  test("getProfile returns nulls for a user with no row yet", () => {
    const db = createDatabase(":memory:");
    expect(getProfile(db, "user-1")).toEqual({ bio: null, avatarUrl: null });
  });

  test("upsertProfile creates a new row and getProfile reflects it", () => {
    const db = createDatabase(":memory:");
    const updated = upsertProfile(db, "user-1", { bio: "Hello", avatarUrl: "https://example.com/a.png" });
    expect(updated).toEqual({ bio: "Hello", avatarUrl: "https://example.com/a.png" });
    expect(getProfile(db, "user-1")).toEqual({ bio: "Hello", avatarUrl: "https://example.com/a.png" });
  });

  test("upsertProfile updates only the fields provided, leaving others unchanged", () => {
    const db = createDatabase(":memory:");
    upsertProfile(db, "user-1", { bio: "Hello", avatarUrl: "https://example.com/a.png" });
    const updated = upsertProfile(db, "user-1", { bio: "Updated bio" });
    expect(updated).toEqual({ bio: "Updated bio", avatarUrl: "https://example.com/a.png" });
  });

  test("upsertProfile can explicitly clear a field by passing null", () => {
    const db = createDatabase(":memory:");
    upsertProfile(db, "user-1", { bio: "Hello", avatarUrl: "https://example.com/a.png" });
    const updated = upsertProfile(db, "user-1", { avatarUrl: null });
    expect(updated).toEqual({ bio: "Hello", avatarUrl: null });
  });

  test("profiles for different users are independent", () => {
    const db = createDatabase(":memory:");
    upsertProfile(db, "user-1", { bio: "User one" });
    upsertProfile(db, "user-2", { bio: "User two" });
    expect(getProfile(db, "user-1").bio).toBe("User one");
    expect(getProfile(db, "user-2").bio).toBe("User two");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test __tests__/db.test.ts`
Expected: FAIL — `src/db.ts` doesn't exist yet.

- [ ] **Step 3: Implement the database layer**

Create `src/db.ts`:

```ts
import { Database } from "bun:sqlite";

export type ProfileRow = { bio: string | null; avatarUrl: string | null };

export function createDatabase(path: string = "scs-profile.sqlite"): Database {
  const db = new Database(path);
  db.run(`
    CREATE TABLE IF NOT EXISTS profiles (
      user_id TEXT PRIMARY KEY,
      bio TEXT,
      avatar_url TEXT
    )
  `);
  return db;
}

export function getProfile(db: Database, userId: string): ProfileRow {
  const row = db.query("SELECT bio, avatar_url as avatarUrl FROM profiles WHERE user_id = ?").get(userId) as
    | ProfileRow
    | null;
  return row ?? { bio: null, avatarUrl: null };
}

export function upsertProfile(
  db: Database,
  userId: string,
  update: { bio?: string | null; avatarUrl?: string | null }
): ProfileRow {
  const existing = getProfile(db, userId);
  const bio = update.bio !== undefined ? update.bio : existing.bio;
  const avatarUrl = update.avatarUrl !== undefined ? update.avatarUrl : existing.avatarUrl;
  db.run(
    `INSERT INTO profiles (user_id, bio, avatar_url) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET bio = excluded.bio, avatar_url = excluded.avatar_url`,
    [userId, bio, avatarUrl]
  );
  return { bio, avatarUrl };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test __tests__/db.test.ts`
Expected: PASS, all 5 tests.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `bun test && bun run typecheck`
Expected: PASS, no errors.

- [ ] **Step 6: Commit**

```bash
git add src/db.ts __tests__/db.test.ts
git commit -m "feat: sqlite-backed profile data layer"
```

---

### Task 3: Manifest + bundle building

**Files:**
- Create: `src/manifest.ts`, `src/bundle.ts`
- Test: `__tests__/manifest.test.ts`, `__tests__/bundle.test.ts`

**Interfaces:**
- Consumes: nothing new (Task 4's `src/profile-view.tsx` doesn't exist yet at this point, but `bundle.ts` only references its *path* as a build entrypoint — it doesn't need to exist until the build actually runs, i.e. until the tests in this task run `getProfileBundle()`. Because of this, **Task 4 must actually be completed before this task's `bundle.test.ts` will pass** — see the note in Step 2 below.)
- Produces: `manifest: SCSManifest` (a plain object matching Portal's manifest JSON contract); `getProfileBundle(): Promise<string>`, `__resetBundleCacheForTests(): void`. Task 5 consumes both.

- [ ] **Step 1: Write the manifest and its failing tests**

Create `__tests__/manifest.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { manifest } from "../src/manifest";

describe("manifest", () => {
  test("declares its own name and bundle path", () => {
    expect(manifest.name).toBe("profile");
    expect(manifest.bundle).toBe("/.portal/bundle.js");
  });

  test("declares the /profile route with GET and POST, no required roles, mounting ProfileView", () => {
    expect(manifest.routes).toEqual([
      { path: "/profile", requiredRoles: [], methods: ["GET", "POST"], component: "ProfileView" },
    ]);
  });

  test("declares a nav entry for /profile with no required roles", () => {
    expect(manifest.nav).toEqual([{ label: "Profile", path: "/profile", requiredRoles: [] }]);
  });

  test("publishes the profile context key and consumes none", () => {
    expect(manifest.publishesContext).toEqual(["profile"]);
    expect(manifest.consumesContext).toEqual([]);
  });
});
```

Run: `bun test __tests__/manifest.test.ts`
Expected: FAIL — `src/manifest.ts` doesn't exist yet.

Create `src/manifest.ts`:

```ts
export const manifest = {
  name: "profile",
  bundle: "/.portal/bundle.js",
  routes: [{ path: "/profile", requiredRoles: [] as string[], methods: ["GET", "POST"], component: "ProfileView" }],
  nav: [{ label: "Profile", path: "/profile", requiredRoles: [] as string[] }],
  publishesContext: ["profile"] as string[],
  consumesContext: [] as string[],
};
```

Run: `bun test __tests__/manifest.test.ts`
Expected: PASS, all 4 tests.

- [ ] **Step 2: Write the bundle builder and its failing tests**

**Note:** `getProfileBundle()` builds `src/profile-view.tsx` as its entrypoint — that file doesn't exist until Task 4. Write `src/bundle.ts` and `__tests__/bundle.test.ts` now (this task's own scope), but expect `bundle.test.ts` to fail with a build error ("could not resolve profile-view.tsx" or similar) until Task 4 creates that file. **Do not create a placeholder `profile-view.tsx` to make this pass early** — Task 4 owns that file's real content; this task's job is only the builder itself. Note this dependency in your report; it is expected, not a defect.

Create `__tests__/bundle.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { getProfileBundle, __resetBundleCacheForTests } from "../src/bundle";

describe("getProfileBundle", () => {
  test("builds a module exporting ProfileView, with react/react-dom/@portal/runtime kept as external imports", async () => {
    __resetBundleCacheForTests();
    const code = await getProfileBundle();
    expect(code).toContain("ProfileView");
    expect(code).toMatch(/from\s*["']react["']/);
    expect(code).toMatch(/from\s*["']@portal\/runtime["']/);
    // react/jsx-runtime must be inlined, not left as an unresolvable bare specifier
    expect(code).not.toMatch(/from\s*["']react\/jsx-runtime["']/);
  });

  test("memoizes the build across calls (returns the same string instance)", async () => {
    __resetBundleCacheForTests();
    const first = await getProfileBundle();
    const second = await getProfileBundle();
    expect(second).toBe(first);
  });
});
```

Create `src/bundle.ts`:

```ts
// Builds the ProfileView component bundle the same way Portal's own shell
// bundle is built (see portal/src/shell/bundle.ts): react/react-dom/
// @portal/runtime marked external so the browser loads one shared copy via
// Portal's own import map, instead of this bundle carrying its own copies.

let cached: Promise<string> | null = null;

export function getProfileBundle(): Promise<string> {
  if (!cached) {
    const build = buildOne(new URL("./profile-view.tsx", import.meta.url).pathname, [
      "react",
      "react-dom",
      "@portal/runtime",
    ]);
    // A transient failure must not poison every future call for the rest of
    // the process's life — clear the cache slot on rejection so the next
    // request gets a fresh build attempt.
    build.catch(() => {
      if (cached === build) cached = null;
    });
    cached = build;
  }
  return cached;
}

// Test-only seam: forces a fresh build on the next call.
export function __resetBundleCacheForTests(): void {
  cached = null;
}

async function buildOne(entrypoint: string, external: string[]): Promise<string> {
  const result = await Bun.build({
    entrypoints: [entrypoint],
    format: "esm",
    target: "browser",
    external,
    plugins: [inlineJsxRuntime],
    // Bun picks the dev JSX runtime based on the actual process.env.NODE_ENV
    // at build time, which is unset under `bun --watch src/server.ts` —
    // `define` forces the production runtime for this build only, without
    // mutating the server process's own NODE_ENV.
    define: { "process.env.NODE_ENV": '"production"' },
  });
  if (!result.success) {
    throw new Error(`bundle build failed for ${entrypoint}: ${result.logs.map((l) => l.message).join("; ")}`);
  }
  return await result.outputs[0].text();
}

// Bun's automatic JSX runtime transform compiles every JSX call to an import
// from "react/jsx-runtime" — a bare specifier distinct from "react" itself.
// Marking "react" external makes Bun treat that jsx-runtime subpath as
// external too, by package-name association — and Portal's import map
// doesn't cover it, so the browser can't resolve it. This plugin redirects
// just that one subpath to its real file on disk so Bun inlines it instead
// (identical technique to Portal's own portal/src/shell/bundle.ts).
const inlineJsxRuntime: Bun.BunPlugin = {
  name: "inline-react-jsx-runtime",
  setup(build) {
    build.onResolve({ filter: /^react\/jsx-(dev-)?runtime$/ }, (args) => ({
      path: Bun.resolveSync(args.path, import.meta.dir),
    }));
  },
};
```

- [ ] **Step 3: Run typecheck for this task's own files**

Run: `bun run typecheck`
Expected: no errors (this doesn't depend on `profile-view.tsx` existing — `bundle.ts` only references its path as a string, not as an import, so nothing here fails to typecheck because of Task 4's pending file).

- [ ] **Step 4: Commit**

```bash
git add src/manifest.ts src/bundle.ts __tests__/manifest.test.ts __tests__/bundle.test.ts
git commit -m "feat: manifest and bundle builder"
```

`bundle.test.ts` remains failing at this commit (documented in your report) until Task 4 lands — this is expected, not a defect in this task.

---

### Task 4: `ProfileView` component

**Files:**
- Create: `src/profile-view.tsx`, `__tests__/helpers/dom.ts`
- Test: `__tests__/profile-view.test.tsx`

**Interfaces:**
- Consumes: `portalFetch`, `usePublishContext` from `@portal/runtime` (Task 1's stub, resolved via `tsconfig.json`'s `paths`).
- Produces: `export function ProfileView(): JSX.Element` — the manifest names this export (`component: "ProfileView"`); Portal's shell mounts it by that exact name once composed. This task also unblocks Task 3's `bundle.test.ts`, which was left failing until this file exists.

- [ ] **Step 1: Create the DOM test helper**

Create `__tests__/helpers/dom.ts`:

```ts
import { beforeAll, afterAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Scopes happy-dom's globals to exactly the test file that calls this at its
// top level — register()/unregister() run around that file's own suite, so
// no other test file's assumptions about the native fetch/Response are
// disturbed. Also scopes React's act() environment flag the same way.
const reactActEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };

export function withDom(): void {
  beforeAll(() => {
    GlobalRegistrator.register();
    reactActEnv.IS_REACT_ACT_ENVIRONMENT = true;
  });
  afterAll(() => {
    GlobalRegistrator.unregister();
    delete reactActEnv.IS_REACT_ACT_ENVIRONMENT;
  });
}
```

- [ ] **Step 2: Write the failing tests**

Create `__tests__/profile-view.test.tsx`:

```tsx
import { describe, test, expect, mock } from "bun:test";
import { withDom } from "./helpers/dom";

withDom();

async function flush(act: (callback: () => Promise<void>) => Promise<void>, times = 3): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe("ProfileView", () => {
  test("loads identity and profile data on mount and renders them", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (input: any) => {
      const url = String(input);
      if (url === "/me") {
        return new Response(JSON.stringify({ displayName: "Ada Lovelace", email: "ada@example.com" }), {
          status: 200,
        });
      }
      if (url === "/profile") {
        return new Response(JSON.stringify({ bio: "Mathematician", avatarUrl: "https://example.com/a.png" }), {
          status: 200,
        });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    try {
      const { createRoot } = await import("react-dom/client");
      const { act } = await import("react");
      const { ProfileView } = await import("../src/profile-view");

      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      await act(async () => {
        root.render(<ProfileView />);
      });
      await flush(act);

      expect(container.textContent).toContain("Ada Lovelace");
      const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
      expect(textarea.value).toBe("Mathematician");
      const input = container.querySelector("input") as HTMLInputElement;
      expect(input.value).toBe("https://example.com/a.png");

      await act(async () => {
        root.unmount();
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("shows an error state when the boot fetch fails", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;

    try {
      const { createRoot } = await import("react-dom/client");
      const { act } = await import("react");
      const { ProfileView } = await import("../src/profile-view");

      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      await act(async () => {
        root.render(<ProfileView />);
      });
      await flush(act);

      expect(container.textContent).toContain("Something went wrong");

      await act(async () => {
        root.unmount();
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("submitting the form POSTs the current field values and updates from the response", async () => {
    const originalFetch = globalThis.fetch;
    const postedBodies: string[] = [];
    globalThis.fetch = mock(async (input: any, init?: RequestInit) => {
      const url = String(input);
      if (url === "/me") {
        return new Response(JSON.stringify({ displayName: "Ada Lovelace", email: null }), { status: 200 });
      }
      if (url === "/profile" && init?.method === "POST") {
        postedBodies.push(String(init.body));
        return new Response(JSON.stringify({ bio: "Mathematician", avatarUrl: "https://example.com/a.png" }), {
          status: 200,
        });
      }
      if (url === "/profile") {
        return new Response(JSON.stringify({ bio: "Mathematician", avatarUrl: "https://example.com/a.png" }), {
          status: 200,
        });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    try {
      const { createRoot } = await import("react-dom/client");
      const { act } = await import("react");
      const { ProfileView } = await import("../src/profile-view");

      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      await act(async () => {
        root.render(<ProfileView />);
      });
      await flush(act);

      const form = container.querySelector("form") as HTMLFormElement;
      await act(async () => {
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });
      await flush(act);

      expect(postedBodies).toHaveLength(1);
      expect(JSON.parse(postedBodies[0])).toEqual({ bio: "Mathematician", avatarUrl: "https://example.com/a.png" });

      await act(async () => {
        root.unmount();
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun test __tests__/profile-view.test.tsx`
Expected: FAIL — `src/profile-view.tsx` doesn't exist yet.

- [ ] **Step 4: Implement `ProfileView`**

Create `src/profile-view.tsx`:

```tsx
import { useEffect, useState, type FormEvent } from "react";
import { portalFetch, usePublishContext } from "@portal/runtime";

type Me = { displayName: string | null; email: string | null };
type Profile = { bio: string | null; avatarUrl: string | null };
type Status = "loading" | "ready" | "saving" | "error";

export function ProfileView() {
  const publishProfile = usePublishContext("profile");
  const [me, setMe] = useState<Me | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    (async () => {
      try {
        const [meResponse, profileResponse] = await Promise.all([portalFetch("/me"), portalFetch("/profile")]);
        if (!meResponse.ok || !profileResponse.ok) {
          setStatus("error");
          return;
        }
        const meJson = (await meResponse.json()) as Me;
        const profileJson = (await profileResponse.json()) as Profile;
        setMe(meJson);
        setProfile(profileJson);
        setBio(profileJson.bio ?? "");
        setAvatarUrl(profileJson.avatarUrl ?? "");
        setStatus("ready");
      } catch {
        setStatus("error");
      }
    })();
  }, []);

  useEffect(() => {
    if (!me || !profile) return;
    publishProfile({ displayName: me.displayName, avatarUrl: profile.avatarUrl });
  }, [me, profile, publishProfile]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setStatus("saving");
    try {
      const response = await portalFetch("/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bio, avatarUrl }),
      });
      if (!response.ok) {
        setStatus("error");
        return;
      }
      const updated = (await response.json()) as Profile;
      setProfile(updated);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }

  if (status === "loading") return <div>Loading…</div>;
  if (status === "error") return <div>Something went wrong loading your profile.</div>;

  return (
    <div>
      <h1>{me?.displayName ?? me?.email ?? "Your profile"}</h1>
      <form
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
      >
        <label>
          Bio
          <textarea value={bio} onChange={(event) => setBio(event.target.value)} />
        </label>
        <label>
          Avatar URL
          <input value={avatarUrl} onChange={(event) => setAvatarUrl(event.target.value)} />
        </label>
        <button type="submit" disabled={status === "saving"}>
          {status === "saving" ? "Saving…" : "Save"}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test __tests__/profile-view.test.tsx`
Expected: PASS, all 3 tests.

- [ ] **Step 6: Run Task 3's previously-failing bundle test — it should now pass**

Run: `bun test __tests__/bundle.test.ts`
Expected: PASS, both tests — `profile-view.tsx` now exists as a valid build entrypoint.

- [ ] **Step 7: Run the full suite and typecheck**

Run: `bun test && bun run typecheck`
Expected: PASS, no errors.

- [ ] **Step 8: Commit**

```bash
git add src/profile-view.tsx __tests__/helpers/dom.ts __tests__/profile-view.test.tsx
git commit -m "feat: ProfileView component"
```

---

### Task 5: Server wiring

**Files:**
- Create: `src/server.ts`
- Test: `__tests__/server.test.ts`

**Interfaces:**
- Consumes: `verifyInternalToken` (Task 1), `createDatabase`/`getProfile`/`upsertProfile` (Task 2), `manifest` (Task 3), `getProfileBundle` (Task 3).
- Produces: `createServer(opts?: ServerOptions): ReturnType<typeof Bun.serve>`; `if (import.meta.main)` boots a real server on `PORT` (default `4001`).

- [ ] **Step 1: Write the failing tests**

Create `__tests__/server.test.ts`:

```ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createHmac } from "node:crypto";
import { createServer } from "../src/server";
import { createDatabase } from "../src/db";

const SECRET = "internal-secret";

function base64url(input: string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

function makeToken(sub: string, aud: string, roles: string[] = [], secret: string = SECRET): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ sub, roles, aud, exp: Math.floor(Date.now() / 1000) + 60 }));
  const signature = sign(`${header}.${payload}`, secret);
  return `${header}.${payload}.${signature}`;
}

// The audience an internal token is minted for is a *configured* value (in
// production, whatever Portal's own PORTAL_SCS_URLS names this SCS as) —
// it is NOT the literal OS-assigned TCP port `port: 0` produces below. The
// server is given this fixed value as its own `baseUrl` opt, so every
// token's `aud` claim is checked against it consistently, regardless of
// which real port the test server happens to bind to. `requestUrl` (from
// `server.url`) is a separate, unrelated concern: the actual address these
// tests' own `fetch()` calls must hit to reach that bound port.
const CONFIGURED_BASE_URL = "http://localhost:4001";

let server: ReturnType<typeof createServer>;
let requestUrl: string;

beforeEach(() => {
  server = createServer({
    port: 0,
    db: createDatabase(":memory:"),
    internalTokenSecret: SECRET,
    baseUrl: CONFIGURED_BASE_URL,
  });
  requestUrl = server.url.toString().replace(/\/$/, "");
});

afterEach(() => {
  server.stop();
});

describe("GET /.portal/manifest", () => {
  test("returns the manifest, unauthenticated", async () => {
    const response = await fetch(`${requestUrl}/.portal/manifest`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { name: string };
    expect(body.name).toBe("profile");
  });
});

describe("GET /.portal/bundle.js", () => {
  test("returns the built bundle, unauthenticated", async () => {
    const response = await fetch(`${requestUrl}/.portal/bundle.js`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("javascript");
    expect(await response.text()).toContain("ProfileView");
  });
});

describe("GET /profile", () => {
  test("returns 401 with no Authorization header", async () => {
    const response = await fetch(`${requestUrl}/profile`);
    expect(response.status).toBe(401);
  });

  test("returns 401 for a token signed with the wrong secret", async () => {
    const badToken = makeToken("user-1", CONFIGURED_BASE_URL, [], "wrong-secret");
    const response = await fetch(`${requestUrl}/profile`, { headers: { Authorization: `Bearer ${badToken}` } });
    expect(response.status).toBe(401);
  });

  test("returns defaults for a user with no saved profile", async () => {
    const token = makeToken("user-1", CONFIGURED_BASE_URL);
    const response = await fetch(`${requestUrl}/profile`, { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ bio: null, avatarUrl: null });
  });
});

describe("POST /profile", () => {
  test("returns 401 with no Authorization header", async () => {
    const response = await fetch(`${requestUrl}/profile`, { method: "POST", body: JSON.stringify({ bio: "hi" }) });
    expect(response.status).toBe(401);
  });

  test("saves and returns the updated profile for the token's own user", async () => {
    const token = makeToken("user-1", CONFIGURED_BASE_URL);
    const response = await fetch(`${requestUrl}/profile`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ bio: "Hello", avatarUrl: "https://example.com/a.png" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ bio: "Hello", avatarUrl: "https://example.com/a.png" });

    const getResponse = await fetch(`${requestUrl}/profile`, { headers: { Authorization: `Bearer ${token}` } });
    expect(await getResponse.json()).toEqual({ bio: "Hello", avatarUrl: "https://example.com/a.png" });
  });

  test("two different users' tokens see and write independent profiles", async () => {
    const tokenA = makeToken("user-a", CONFIGURED_BASE_URL);
    const tokenB = makeToken("user-b", CONFIGURED_BASE_URL);
    await fetch(`${requestUrl}/profile`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenA}`, "Content-Type": "application/json" },
      body: JSON.stringify({ bio: "User A" }),
    });
    await fetch(`${requestUrl}/profile`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenB}`, "Content-Type": "application/json" },
      body: JSON.stringify({ bio: "User B" }),
    });

    const responseA = await fetch(`${requestUrl}/profile`, { headers: { Authorization: `Bearer ${tokenA}` } });
    const responseB = await fetch(`${requestUrl}/profile`, { headers: { Authorization: `Bearer ${tokenB}` } });
    expect((await responseA.json()).bio).toBe("User A");
    expect((await responseB.json()).bio).toBe("User B");
  });

  test("returns 400 for a non-JSON body", async () => {
    const token = makeToken("user-1", CONFIGURED_BASE_URL);
    const response = await fetch(`${requestUrl}/profile`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: "not json",
    });
    expect(response.status).toBe(400);
  });

  test("returns 400 when bio is present but not a string", async () => {
    const token = makeToken("user-1", CONFIGURED_BASE_URL);
    const response = await fetch(`${requestUrl}/profile`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ bio: 42 }),
    });
    expect(response.status).toBe(400);
  });

  test("a partial update (only bio) leaves avatarUrl unchanged", async () => {
    const token = makeToken("user-1", CONFIGURED_BASE_URL);
    await fetch(`${requestUrl}/profile`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ bio: "Hello", avatarUrl: "https://example.com/a.png" }),
    });
    const response = await fetch(`${requestUrl}/profile`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ bio: "Updated" }),
    });
    expect(await response.json()).toEqual({ bio: "Updated", avatarUrl: "https://example.com/a.png" });
  });
});

describe("unknown paths", () => {
  test("returns 404", async () => {
    const response = await fetch(`${requestUrl}/nonexistent`);
    expect(response.status).toBe(404);
  });
});

describe("createServer construction", () => {
  test("throws if no internalTokenSecret is available (opt or env)", () => {
    const originalEnv = process.env.INTERNAL_TOKEN_SECRET;
    delete process.env.INTERNAL_TOKEN_SECRET;
    try {
      expect(() => createServer({ port: 0, db: createDatabase(":memory:") })).toThrow();
    } finally {
      if (originalEnv !== undefined) process.env.INTERNAL_TOKEN_SECRET = originalEnv;
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test __tests__/server.test.ts`
Expected: FAIL — `src/server.ts` doesn't exist yet.

- [ ] **Step 3: Implement the server**

Create `src/server.ts`:

```ts
import type { Database } from "bun:sqlite";
import { createDatabase, getProfile, upsertProfile } from "./db";
import { verifyInternalToken } from "./internal-token";
import { manifest } from "./manifest";
import { getProfileBundle } from "./bundle";

export type ServerOptions = {
  port?: number;
  db?: Database;
  internalTokenSecret?: string;
  baseUrl?: string;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export function createServer(opts: ServerOptions = {}) {
  const db = opts.db ?? createDatabase();
  const internalTokenSecret = opts.internalTokenSecret ?? process.env.INTERNAL_TOKEN_SECRET;
  if (!internalTokenSecret) {
    throw new Error(
      "INTERNAL_TOKEN_SECRET must be set (shared out-of-band with the Portal instance composing this SCS)"
    );
  }
  const port = opts.port ?? 4001;
  const baseUrl = (opts.baseUrl ?? process.env.SCS_BASE_URL ?? `http://localhost:${port}`).replace(/\/+$/, "");

  function requireInternalToken(req: Request): { sub: string; roles: string[] } | Response {
    const header = req.headers.get("Authorization");
    if (!header?.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
    const payload = verifyInternalToken(header.slice("Bearer ".length), internalTokenSecret!, baseUrl);
    if (!payload) return json({ error: "unauthorized" }, 401);
    return { sub: payload.sub, roles: payload.roles };
  }

  return Bun.serve({
    port,
    // 1MB is far more than a bio + an avatar URL should ever need.
    maxRequestBodySize: 1024 * 1024,
    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === "/.portal/manifest" && req.method === "GET") {
        return json(manifest);
      }

      if (url.pathname === "/.portal/bundle.js" && req.method === "GET") {
        try {
          const code = await getProfileBundle();
          return new Response(code, { status: 200, headers: { "Content-Type": "text/javascript; charset=utf-8" } });
        } catch (err) {
          console.error("bundle build failed", err);
          return json({ error: "bundle build failed" }, 500);
        }
      }

      if (url.pathname === "/profile" && req.method === "GET") {
        const auth = requireInternalToken(req);
        if (auth instanceof Response) return auth;
        return json(getProfile(db, auth.sub));
      }

      if (url.pathname === "/profile" && req.method === "POST") {
        const auth = requireInternalToken(req);
        if (auth instanceof Response) return auth;

        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return json({ error: "invalid JSON body" }, 400);
        }
        if (typeof body !== "object" || body === null) return json({ error: "invalid body" }, 400);
        const obj = body as Record<string, unknown>;
        if (obj.bio !== undefined && obj.bio !== null && typeof obj.bio !== "string") {
          return json({ error: "bio must be a string or null" }, 400);
        }
        if (obj.avatarUrl !== undefined && obj.avatarUrl !== null && typeof obj.avatarUrl !== "string") {
          return json({ error: "avatarUrl must be a string or null" }, 400);
        }

        const updated = upsertProfile(db, auth.sub, {
          bio: obj.bio as string | null | undefined,
          avatarUrl: obj.avatarUrl as string | null | undefined,
        });
        return json(updated);
      }

      return json({ error: "not found" }, 404);
    },
  });
}

if (import.meta.main) {
  const server = createServer({ port: Number(process.env.PORT ?? 4001) });
  console.log(`scs-profile listening on ${server.url}`);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test __tests__/server.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `bun test && bun run typecheck`
Expected: PASS, no errors — every task's changes are now in place.

- [ ] **Step 6: Commit**

```bash
git add src/server.ts __tests__/server.test.ts
git commit -m "feat: wire up the scs-profile HTTP server"
```

- [ ] **Step 7: Manual end-to-end verification against a real running Portal**

This step has no automated test — it's a real integration check, matching the same real-browser verification Portal's own frontend-shell plan used.

1. In `~/dev/scs-profile`, create `.env.dev`:
   ```
   export INTERNAL_TOKEN_SECRET=dev-internal-secret-change-me
   ```
   (This value must exactly match whatever `INTERNAL_TOKEN_SECRET` Portal's own `.env.dev` has — check `~/dev/portal/.env.dev`; if Portal's `.env.dev` doesn't set one yet, add the same value to both files.)
2. Start scs-profile: `bun run dev` (from `~/dev/scs-profile`) — confirm it logs `scs-profile listening on http://localhost:4001/`.
3. In `~/dev/portal/.env.dev`, add: `export PORTAL_SCS_URLS=http://localhost:4001`
4. Restart Portal's dev server (`bun run dev` from `~/dev/portal`) so it picks up the new env var.
5. In a browser, sign in to Portal, then click the "Profile" link in the header (or the nav entry, once `/nav` reflects it).
6. Confirm the page shows your display name, an empty bio/avatar form (first visit), and that submitting the form saves and reloads with the saved values (refresh the page to confirm persistence).
7. Report the result (pass/fail, and any real issue found) in this task's completion note — do not silently skip this step even though it's unautomated.
