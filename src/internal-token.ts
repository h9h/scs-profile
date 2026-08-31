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
