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
