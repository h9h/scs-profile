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
