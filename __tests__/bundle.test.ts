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
