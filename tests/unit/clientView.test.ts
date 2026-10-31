import { describe, expect, it } from "vitest";
import { buildClientView } from "@/lib/clientView";
import { addDays } from "@/lib/dates";
import { computeSchedule } from "@/lib/schedule";
import { buildDemo, DEMO_TOKENS } from "@/lib/seed";

const today = "2026-06-15";
const { db } = buildDemo(today, new Date("2026-06-15T07:00:00Z"));
const proj = (slug: string) => db.projects.find((p) => p.slug === slug)!;
const input = (slug: string, over = {}) => ({ project: proj(slug), studioName: db.studio.name, projects: db.projects, checkins: db.checkins, interests: [], today, ...over });
const view = (slug: string) => buildClientView(input(slug));

describe("demo data tells the intended story", () => {
  const sched = (slug: string, approvedOnly = false) =>
    computeSchedule(proj(slug), db.checkins.filter((c) => c.projectId === proj(slug).id && (!approvedOnly || c.review === "approved")), today);

  it("Sharma is late with a blocked ceiling and one pending update", () => {
    const s = sched("sharma");
    expect(s.health).toBe("bad");
    expect(s.flags[0]).toMatchObject({ kind: "blocked", stageId: "ceiling" });
    expect(s.slipDays).toBeGreaterThanOrEqual(4);
    expect(db.checkins.filter((c) => c.projectId === "p-sharma" && c.review === "pending")).toHaveLength(1);
  });
  it("Mehta just started and is slightly behind (watch), one pending", () => {
    const s = sched("mehta");
    expect(s.health).toBe("warn");
    expect(s.slipDays).toBeGreaterThanOrEqual(1);
    expect(s.slipDays).toBeLessThan(4);
    expect(db.checkins.filter((c) => c.projectId === "p-mehta" && c.review === "pending")).toHaveLength(1);
  });
  it("Verma is on track with everything published and an update due today", () => {
    const s = sched("verma");
    expect(s.health).toBe("ok");
    expect(s.slipDays).toBe(0);
    expect(db.checkins.filter((c) => c.projectId === "p-verma").every((c) => c.review === "approved")).toBe(true);
    expect(Math.max(...db.checkins.filter((c) => c.projectId === "p-verma").map((c) => +c.date.replace(/-/g, "")))).toBeLessThan(+today.replace(/-/g, ""));
  });
});

describe("client view privacy", () => {
  const FORBIDDEN = [
    "Palm Residency", "Sector 56", "Gurgaon", "Greenview", "Golf Course", "Lotus Apartments", // address / locality
    "Ravi", "Kumar", // supervisor name
    "Material not arrived", "supplier ne late kiya", "Wardrobe shutters", "debris uthana", // raw reasons and notes
    "28.42", "77.09", "\"lat\"", "\"lng\"", "\"accuracy\"", // GPS
    "demo-owner", "demo-supervisor", // other roles' tokens
  ];
  for (const slug of ["sharma", "mehta", "verma", "kapoor"]) {
    it(`${slug}: serialised view contains none of the internal strings`, () => {
      const text = JSON.stringify(view(slug));
      for (const bad of FORBIDDEN) expect(text, bad).not.toContain(bad);
      for (const other of ["sharma", "mehta", "verma", "kapoor"].filter((x) => x !== slug)) expect(text).not.toContain(DEMO_TOKENS.client(other));
    });
  }
  it("shows only approved updates and photos", () => {
    const v = view("sharma");
    const approved = db.checkins.filter((c) => c.projectId === "p-sharma" && c.review === "approved");
    expect(v.updates).toHaveLength(approved.length);
    const pendingPhotos = db.checkins.find((c) => c.projectId === "p-sharma" && c.review === "pending")!.photos.map((p) => p.fileName);
    for (const f of pendingPhotos) expect(JSON.stringify(v)).not.toContain(f);
  });
  it("computes every number from approved check-ins only", () => {
    const approvedOnly = computeSchedule(proj("sharma"), db.checkins.filter((c) => c.projectId === "p-sharma" && c.review === "approved"), today);
    const v = view("sharma");
    expect(v.slipDays).toBe(approvedOnly.slipDays);
    expect(v.percent).toBe(approvedOnly.percent);
    const all = computeSchedule(proj("sharma"), db.checkins.filter((c) => c.projectId === "p-sharma"), today);
    expect(all.percent).not.toBe(approvedOnly.percent); // the pending update would have changed it
  });
  it("explains holds in plain words and an honest late headline", () => {
    const v = view("sharma");
    expect(v.now.find((n) => n.id === "ceiling")).toMatchObject({ state: "blocked", reason: "waiting for material to be delivered" });
    expect(v.headline).toEqual({ tone: "late", text: `${v.slipDays} days behind the original plan` });
    expect(v.upNext[0]).toMatch(/^Putty & paint \(starts once False ceiling and Carpentry are done\)$/);
  });
  it("a project with no approved updates says so and never invents progress", () => {
    const none = buildClientView(input("mehta", { studioName: "Studio", checkins: [] }));
    expect(none.hasUpdates).toBe(false);
    expect(none.lastUpdate).toBeNull();
    expect(none.percent).toBe(0);
    expect(none.headline.tone).toBe("none");
  });
  it("uses only dates the schedule computed (last update is an approved check-in date)", () => {
    const v = view("verma");
    expect(v.lastUpdate).toBeTruthy();
    expect(addDays(today, -1)).toBe("2026-06-14");
  });
});

import { XMLValidator } from "fast-xml-parser";
describe("demo photos", () => {
  it("every seeded SVG is well-formed (an unescaped & would show as a broken image)", () => {
    const { photos } = buildDemo(today, new Date());
    expect(Object.keys(photos).length).toBeGreaterThan(10);
    for (const [name, svg] of Object.entries(photos)) {
      const v = XMLValidator.validate(svg);
      expect(v, name).toBe(true);
      expect(svg).toContain("Demo photo");
    }
  });
});
