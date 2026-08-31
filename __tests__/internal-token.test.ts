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
