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
