import type { Database } from "bun:sqlite";
import { createDatabase, getProfile, upsertProfile } from "./db";
import { verifyInternalToken } from "./internal-token";
import { manifest } from "./manifest";
import { getProfileBundle } from "./bundle";

// db is the one option below with no corresponding env var: there's nothing
// to configure other than "use a real file or don't" — omit it and you get
// the real on-disk database createDatabase() opens by default.
export type ServerOptions = {
  port?: number;
  db?: Database;
  internalTokenSecret?: string;
  baseUrl?: string;
  maxRequestBodySize?: number;
};

function json(body: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

// Blocks a stored/published avatar URL from being anything other than a
// real http(s) link — this string round-trips through GET /profile into
// other SCSs via usePublishContext("profile"), so a scheme like
// `javascript:` stored here would be a stored-XSS payload for any consumer
// that ever rendered it as an href rather than an <img src>.
function isValidAvatarUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function createServer(opts: ServerOptions = {}) {
  const internalTokenSecret = opts.internalTokenSecret ?? process.env.INTERNAL_TOKEN_SECRET;
  if (!internalTokenSecret) {
    throw new Error(
      "INTERNAL_TOKEN_SECRET must be set (shared out-of-band with the Portal instance composing this SCS)"
    );
  }
  const db = opts.db ?? createDatabase();
  const port = opts.port ?? Number(process.env.PORT ?? 4001);
  const baseUrl = (opts.baseUrl ?? process.env.SCS_BASE_URL ?? `http://localhost:${port}`).replace(/\/+$/, "");
  const maxRequestBodySize =
    opts.maxRequestBodySize ?? Number(process.env.MAX_REQUEST_BODY_SIZE ?? 1024 * 1024);

  function requireInternalToken(req: Request): { sub: string; roles: string[] } | Response {
    const header = req.headers.get("Authorization");
    if (!header?.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
    const payload = verifyInternalToken(header.slice("Bearer ".length), internalTokenSecret!, baseUrl);
    if (!payload) {
      // The client only ever sees a bare 401 (no detail, by design — see
      // specification.md) but a wrong SCS_BASE_URL/INTERNAL_TOKEN_SECRET
      // rejects every single request with no clue why, so log a
      // server-side hint pointing at the two things most likely wrong.
      console.warn(
        `rejected an internal token (bad signature, expired, or wrong audience). If this is unexpected, ` +
          `confirm SCS_BASE_URL ("${baseUrl}") exactly matches how this SCS is registered in Portal's ` +
          `PORTAL_SCS_URLS, and that INTERNAL_TOKEN_SECRET matches on both sides.`
      );
      return json({ error: "unauthorized" }, 401);
    }
    return { sub: payload.sub, roles: payload.roles };
  }

  return Bun.serve({
    port,
    // Far more than a bio + an avatar URL should ever need.
    maxRequestBodySize,
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

      if (url.pathname === "/profile") {
        if (req.method !== "GET" && req.method !== "POST") {
          return json({ error: "method not allowed" }, 405, { Allow: "GET, POST" });
        }

        const auth = requireInternalToken(req);
        if (auth instanceof Response) return auth;

        if (req.method === "GET") {
          return json(getProfile(db, auth.sub));
        }

        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return json({ error: "invalid JSON body" }, 400);
        }
        if (typeof body !== "object" || body === null || Array.isArray(body)) {
          return json({ error: "invalid body" }, 400);
        }
        const obj = body as Record<string, unknown>;
        if (obj.bio !== undefined && obj.bio !== null && typeof obj.bio !== "string") {
          return json({ error: "bio must be a string or null" }, 400);
        }
        if (obj.avatarUrl !== undefined && obj.avatarUrl !== null) {
          if (typeof obj.avatarUrl !== "string" || !isValidAvatarUrl(obj.avatarUrl)) {
            return json({ error: "avatarUrl must be a valid http(s) URL, or null" }, 400);
          }
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
  const server = createServer();
  console.log(`scs-profile listening on ${server.url}`);
}
