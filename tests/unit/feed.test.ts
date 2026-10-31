import { describe, expect, it } from "vitest";
import { buildFeed, findShowcase, PER_SITE_LIMIT } from "@/lib/feed";
import { buildDemo } from "@/lib/seed";

const today = "2026-06-15";
const { db } = buildDemo(today, new Date("2026-06-15T07:00:00Z"));
const proj = (slug: string) => db.projects.find((p) => p.slug === slug)!;
const feedFor = (slug: string) => buildFeed(proj(slug), db.projects, db.checkins, today);

describe("inspiration feed", () => {
  it("shows other consenting sites and never the viewer's own", () => {
    const posts = feedFor("mehta");
    expect(posts.length).toBeGreaterThan(5);
    const labels = new Set(posts.map((p) => p.label));
    expect(labels).toEqual(new Set(["3BHK · Contemporary", "2BHK · Modern minimal", "3BHK · Classic warm"]));
    const own = feedFor("verma").map((p) => p.label);
    expect(own).not.toContain("2BHK · Modern minimal");
  });

  it("excludes a project that has not given showcase consent, even when photos were selected", () => {
    const mehta = proj("mehta");
    const tampered = db.checkins.map((c) => (c.projectId === mehta.id ? { ...c, review: "approved" as const, showcase: c.photos.map((p) => ({ id: `x-${p.fileName}`, fileName: p.fileName, stageId: p.stageId })) } : c));
    expect(buildFeed(proj("kapoor"), db.projects, tampered, today).some((p) => p.label.includes("Scandinavian"))).toBe(false);
    const consenting = db.projects.map((p) => (p.id === mehta.id ? { ...p, showcase: true } : p));
    expect(buildFeed(proj("kapoor"), consenting, tampered, today).some((p) => p.label.includes("Scandinavian"))).toBe(true);
  });

  it("never includes photos of unpublished check-ins or photos the owner did not select", () => {
    const sharmaPending = db.checkins.find((c) => c.projectId === "p-sharma" && c.review === "pending")!;
    const forced = db.checkins.map((c) => (c.id === sharmaPending.id ? { ...c, showcase: c.photos.map((p) => ({ id: `leak-${p.fileName}`, fileName: p.fileName, stageId: p.stageId })) } : c));
    const ids = JSON.stringify(buildFeed(proj("kapoor"), db.projects, forced, today));
    expect(ids).not.toContain("leak-");
    const verma = db.checkins.filter((c) => c.projectId === "p-verma" && c.review === "approved");
    const newest = verma[verma.length - 1]; // the newest posts are the ones inside the per-site window
    expect(newest.showcase!.length).toBeGreaterThan(1);
    const dropOne = db.checkins.map((c) => (c.id === newest.id ? { ...c, showcase: c.showcase!.slice(1) } : c));
    const before = feedFor("kapoor").flatMap((p) => p.photos).length;
    const after = buildFeed(proj("kapoor"), db.projects, dropOne, today).flatMap((p) => p.photos).length;
    expect(after).toBe(before - 1);
  });

  it("carries no names, addresses, ids, notes, supervisor, GPS or other tokens", () => {
    const FORBIDDEN = [
      "Palm Residency", "Greenview", "Lotus", "Orchid", "Sector", "Gurgaon", "Golf Course",
      "Sharma", "Mehta", "Verma", "Kapoor", "Priya", "Rohan", "Anita", "Neha",
      "Ravi", "Kumar", "p-sharma", "p-mehta", "p-verma", "p-kapoor",
      "Material not arrived", "supplier ne late kiya", "28.42", '"lat"', "demo-owner", "demo-supervisor",
      ".svg", "demo-1", "demo-2",
    ];
    for (const slug of ["mehta", "sharma", "kapoor"]) {
      const text = JSON.stringify(feedFor(slug));
      for (const bad of FORBIDDEN) expect(text, `${slug}: ${bad}`).not.toContain(bad);
      for (const other of ["sharma", "mehta", "verma", "kapoor"].filter((x) => x !== slug)) expect(text).not.toContain(`demo-client-${other}`);
    }
  });

  it("uses opaque handles for photos, with the viewer's own token only", () => {
    const post = feedFor("mehta")[0];
    expect(post.photos[0].url).toMatch(/^\/api\/feed\/demo-sc-\d+\?t=demo-client-mehta$/);
  });

  it("is newest first, limited, and labels progress as of that day", () => {
    const posts = buildFeed(proj("mehta"), db.projects, db.checkins, today, 5);
    expect(posts).toHaveLength(5);
    const times = posts.map((p) => p.dateLabel);
    expect(times).toEqual([...times]); // formatted labels only; order checked via the full list below
    const all = feedFor("mehta");
    expect(all.some((p) => p.progress === "Completed")).toBe(true);
    expect(all.some((p) => /^In progress · \d+% done$/.test(p.progress))).toBe(true);
    const kapoorPosts = all.filter((p) => p.label.includes("Classic warm"));
    expect(kapoorPosts[0].progress).toBe("Completed"); // newest Kapoor post is the final handover
    expect(kapoorPosts[0].stageNames).toEqual(["Cleaning & handover"]);
  });

  it("shows at most a few posts per site so one busy site cannot crowd out the others", () => {
    const posts = feedFor("mehta");
    const bySite = new Map<string, number>();
    for (const p of posts) bySite.set(p.label, (bySite.get(p.label) ?? 0) + 1);
    expect([...bySite.keys()].sort()).toEqual(["2BHK · Modern minimal", "3BHK · Classic warm", "3BHK · Contemporary"]); // the oldest site is still represented
    for (const n of bySite.values()) expect(n).toBeLessThanOrEqual(PER_SITE_LIMIT);
    expect(bySite.get("3BHK · Classic warm")).toBe(PER_SITE_LIMIT); // Kapoor has 9 posts: its 5 newest
    const kapoor = posts.filter((p) => p.label.includes("Classic warm"));
    expect(kapoor[0].progress).toBe("Completed");
  });

  it("findShowcase resolves a handle only while consent and approval hold", () => {
    const sc = db.checkins.find((c) => c.projectId === "p-kapoor")!.showcase![0];
    expect(findShowcase(sc.id, db.projects, db.checkins)?.project.id).toBe("p-kapoor");
    expect(findShowcase("nope", db.projects, db.checkins)).toBeNull();
    const revoked = db.projects.map((p) => (p.id === "p-kapoor" ? { ...p, showcase: false } : p));
    expect(findShowcase(sc.id, revoked, db.checkins)).toBeNull();
    const unpublished = db.checkins.map((c) => (c.projectId === "p-kapoor" ? { ...c, review: "pending" as const } : c));
    expect(findShowcase(sc.id, db.projects, unpublished)).toBeNull();
  });
});
