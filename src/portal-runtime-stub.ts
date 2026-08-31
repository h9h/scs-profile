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
