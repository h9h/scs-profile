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
