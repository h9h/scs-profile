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
