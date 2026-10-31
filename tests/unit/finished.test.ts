import { describe, expect, it } from "vitest";
import { buildClientView } from "@/lib/clientView";
import { buildFeed, buildFinishedHomes, FINISHED_PHOTOS } from "@/lib/feed";
import { buildDemo } from "@/lib/seed";
import type { Checkin, Interest, Project } from "@/lib/types";

const today = "2026-06-15";
const { db } = buildDemo(today, new Date("2026-06-15T07:00:00Z"));
const proj = (slug: string) => db.projects.find((p) => p.slug === slug)!;
const homes = (viewer: string, over: { projects?: Project[]; checkins?: Checkin[]; interests?: Interest[] } = {}) =>
  buildFinishedHomes(proj(viewer), over.projects ?? db.projects, over.checkins ?? db.checkins, over.interests ?? [], today);
const withProject = (slug: string, patch: Partial<Project>) => db.projects.map((p) => (p.slug === slug ? { ...p, ...patch } : p));

describe("finished homes gallery", () => {
  it("shows other clients' completed homes only, as one card each", () => {
    const h = homes("mehta");
    expect(h).toHaveLength(1); // Sharma/Verma are still in progress, Mehta is the viewer
    expect(h[0]).toMatchObject({ label: "3BHK · Classic warm", completedOn: expect.stringMatching(/^\d{1,2} \w{3} \d{4}$/) });
    expect(homes("kapoor")).toEqual([]); // the viewer's own home is never shown to them, and nothing else is finished
  });

  it("uses the owner's selected photos from the final stages, newest first, capped", () => {
    const [kapoor] = homes("mehta");
    expect(kapoor.photos.length).toBeLessThanOrEqual(FINISHED_PHOTOS);
    expect(kapoor.photos.length).toBeGreaterThan(2);
    for (const ph of kapoor.photos) expect(ph.alt).toMatch(/Putty & paint|Fittings|Cleaning & handover/); // last three stages only
    expect(kapoor.photos[0].alt).toContain("Cleaning & handover"); // newest first: the handover shots
    expect(kapoor.id).toBe(kapoor.photos[0].id);
    expect(kapoor.photos[0].url).toMatch(/^\/api\/feed\/demo-sc-\d+\?t=demo-client-mehta$/);
  });

  it("falls back to other selected photos when none are from the final stages, and hides a home with nothing selected", () => {
    const earlyOnly = db.checkins.map((c) => (c.projectId === "p-kapoor" ? { ...c, showcase: (c.showcase ?? []).filter((s) => s.stageId === "civil") } : c));
    const h = homes("mehta", { checkins: earlyOnly });
    expect(h).toHaveLength(1);
    for (const ph of h[0].photos) expect(ph.alt).toContain("Civil");
    const none = db.checkins.map((c) => (c.projectId === "p-kapoor" ? { ...c, showcase: [] } : c));
    expect(homes("mehta", { checkins: none })).toEqual([]);
  });

  it("requires consent, publication and completion", () => {
    expect(homes("mehta", { projects: withProject("kapoor", { showcase: false }) })).toEqual([]);
    // the final update is not published yet -> the home is not finished as far as clients can tell
    const kapoorCheckins = db.checkins.filter((c) => c.projectId === "p-kapoor");
    const last = kapoorCheckins[kapoorCheckins.length - 1];
    const unpublished = db.checkins.map((c) => (c.id === last.id ? { ...c, review: "pending" as const } : c));
    expect(homes("mehta", { checkins: unpublished })).toEqual([]);
    // reopened after handover -> no longer a final result
    const reopened: Checkin = { ...last, id: "reopen", date: "2026-06-01", createdAt: "2026-06-01T08:00:00Z", updates: [{ stageId: "fittings", state: "working", percent: 50 }], showcase: [], review: "approved" };
    expect(homes("mehta", { checkins: [...db.checkins, reopened] })).toEqual([]);
  });

  it("badges whether the home has an AMC, both ways", () => {
    expect(homes("mehta")[0].amc).toEqual({ has: true, plan: "Gold AMC", status: "Active" });
    const noAmc = withProject("kapoor", { amc: undefined });
    const badge = homes("mehta", { projects: noAmc })[0].amc;
    expect(badge).toEqual({ has: false });
    expect(JSON.stringify(badge)).not.toContain("plan");
  });

  it("an AMC that has run out shows as expired, not as a purchase that never happened", () => {
    const old = withProject("kapoor", { amc: { ...proj("kapoor").amc!, months: 1 } });
    expect(homes("mehta", { projects: old })[0].amc).toMatchObject({ has: true, status: "Expired" });
  });

  it("counts distinct clients who asked for a similar design, never who", () => {
    const kapoorIds = db.checkins.filter((c) => c.projectId === "p-kapoor").flatMap((c) => c.showcase ?? []).map((s) => s.id);
    const i = (id: string, projectId: string, showcaseId: string): Interest => ({ id, projectId, showcaseId, createdAt: "2026-06-10T00:00:00Z" });
    const interests = [i("1", "p-mehta", kapoorIds[0]), i("2", "p-mehta", kapoorIds[1]), i("3", "p-sharma", kapoorIds[2]), i("4", "p-verma", "unrelated-photo")];
    const h = homes("verma", { interests });
    expect(h[0].wants).toBe(2); // Mehta (twice) and Sharma count once each
    expect(JSON.stringify(h)).not.toMatch(/Mehta|Sharma|p-mehta|p-sharma/);
    expect(homes("mehta")[0].wants).toBe(0);
  });

  it("carries no names, addresses, ids, notes, supervisor, GPS or tokens", () => {
    const FORBIDDEN = ["Palm Residency", "Greenview", "Lotus", "Orchid", "Sector", "Gurgaon", "Sharma", "Mehta", "Verma", "Kapoor", "Priya", "Rohan", "Anita", "Neha", "Ravi", "Kumar", "p-sharma", "p-mehta", "p-verma", "p-kapoor", "supplier ne late kiya", '"lat"', "demo-owner", "demo-supervisor", ".svg", "919876"];
    for (const viewer of ["mehta", "sharma", "verma"]) {
      const text = JSON.stringify(homes(viewer));
      for (const bad of FORBIDDEN) expect(text, `${viewer}: ${bad}`).not.toContain(bad);
      expect(text).not.toContain("demo-client-kapoor"); // other clients' link tokens never appear
    }
  });
});

describe("AMC badge on feed posts", () => {
  it("every post says whether its home has an AMC", () => {
    const posts = buildFeed(proj("mehta"), db.projects, db.checkins, today);
    const byLabel = new Map(posts.map((p) => [p.label, p.amc]));
    expect(byLabel.get("3BHK · Classic warm")).toMatchObject({ has: true, plan: "Gold AMC" });
    expect(byLabel.get("3BHK · Contemporary")).toEqual({ has: false });
    expect(byLabel.get("2BHK · Modern minimal")).toEqual({ has: false });
  });
  it("an AMC bought before handover shows as starting after handover", () => {
    const projects = withProject("mehta", { showcase: true });
    const mehta = projects.find((p) => p.slug === "mehta")!;
    const first = db.checkins.find((c) => c.projectId === "p-mehta" && c.review === "approved")!;
    const checkins = db.checkins.map((c) => (c.id === first.id ? { ...c, showcase: c.photos.map((p) => ({ id: `m-${p.fileName}`, fileName: p.fileName, stageId: p.stageId })) } : c));
    const post = buildFeed(proj("kapoor"), projects, checkins, today).find((p) => p.label.includes("Scandinavian"))!;
    expect(post.amc).toEqual({ has: true, plan: mehta.amc!.plan, status: "Starts after handover" });
  });
});

describe("client view", () => {
  it("exposes the gallery and counts interest only against ids the client can see", () => {
    const kapoorId = homes("mehta")[0].id;
    const view = buildClientView({ project: proj("mehta"), studioName: "S", projects: db.projects, checkins: db.checkins, interests: [{ id: "x", projectId: "p-mehta", showcaseId: kapoorId, createdAt: "t" }], today });
    expect(view.finished).toHaveLength(1);
    expect(view.interested).toContain(kapoorId);
    const none = buildClientView({ project: proj("mehta"), studioName: "S", projects: db.projects, checkins: db.checkins, interests: [{ id: "x", projectId: "p-mehta", showcaseId: "gone", createdAt: "t" }], today });
    expect(none.interested).toEqual([]);
  });
});
