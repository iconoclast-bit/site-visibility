import { describe, expect, it } from "vitest";
import { ConfigError, databaseUrl, demoEnabled, initialData } from "@/lib/bootstrap";

describe("demo switch is safe by default", () => {
  it("is on for local JSON-file dev, off whenever a real database is configured", () => {
    expect(demoEnabled({})).toBe(true);
    expect(demoEnabled({ DATABASE_URL: "postgres://x" })).toBe(false);
  });
  it("treats POSTGRES_URL (set by the Supabase/Neon Vercel integrations) as a configured database too", () => {
    expect(databaseUrl({ POSTGRES_URL: "postgres://x" })).toBe("postgres://x");
    expect(databaseUrl({ DATABASE_URL: "postgres://a", POSTGRES_URL: "postgres://b" })).toBe("postgres://a");
    expect(databaseUrl({ DATABASE_URL: " ", POSTGRES_URL: "" })).toBeUndefined();
    expect(demoEnabled({ POSTGRES_URL: "postgres://x" })).toBe(false);
  });
  it("can be forced either way", () => {
    expect(demoEnabled({ DEMO_HUB: "on", DATABASE_URL: "postgres://x" })).toBe(true);
    expect(demoEnabled({ DEMO_HUB: "off" })).toBe(false);
  });
});

describe("first-run data", () => {
  it("seeds the demo when enabled, with the studio phone if set", () => {
    const { db } = initialData({ STUDIO_PHONE: "+91 98765 43210" } as never);
    expect(db.studio.ownerToken).toBe("demo-owner");
    expect(db.studio.phone).toBe("919876543210");
    expect(db.projects).toHaveLength(4);
  });
  it("starts empty with the configured owner token on a real deployment", () => {
    const { db, photos } = initialData({ DATABASE_URL: "postgres://x", OWNER_TOKEN: "a".repeat(24), STUDIO_NAME: "Aarav Interiors" } as never);
    expect(db.studio).toMatchObject({ name: "Aarav Interiors", ownerToken: "a".repeat(24) });
    expect(db.projects).toEqual([]);
    expect(photos).toEqual({});
  });
  it("refuses to start a real deployment without a strong OWNER_TOKEN", () => {
    for (const OWNER_TOKEN of [undefined, "", "short", "has spaces in it which is not ok!!", "demo-owner"]) {
      expect(() => initialData({ DATABASE_URL: "postgres://x", OWNER_TOKEN } as never)).toThrow(ConfigError);
    }
  });
});
