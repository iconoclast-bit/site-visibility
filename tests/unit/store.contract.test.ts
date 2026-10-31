/** The same behavioural contract, run against BOTH stores: JSON file (dev) and Postgres (deploy). */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JsonStore } from "@/lib/store/jsonStore";
import { PgStore } from "@/lib/store/pgStore";
import { errorCode, type Store } from "@/lib/store/types";
import type { Checkin, Project, Supervisor } from "@/lib/types";
import { makePgliteDb } from "./pgliteDb";

delete process.env.DATABASE_URL;
delete process.env.DEMO_HUB;

const photo = (name: string) => ({ fileName: name, bytes: Uint8Array.from([0xff, 0xd8, 0xff, 1, 2, 3]) });
const ck = (id: string, projectId = "p-verma", over: Partial<Checkin> = {}): Checkin => ({
  id, projectId, supervisorId: "sup-ravi", date: "2026-06-15", createdAt: "2026-06-15T08:00:00.000Z",
  updates: [{ stageId: "carpentry", state: "working", percent: 80 }], note: "n", photos: [{ fileName: `${id}-1.jpg`, stageId: "carpentry", takenAt: "x", width: 10, height: 10 }],
  location: null, review: "pending", ...over,
});
const rejects = async (p: Promise<unknown>, code: string) => {
  let err: unknown;
  await p.catch((e) => (err = e));
  expect(errorCode(err), String(err)).toBe(code);
};

const makers: [string, () => Promise<{ store: Store; cleanup: () => Promise<void> }>][] = [
  ["JsonStore", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sv-contract-"));
    return { store: new JsonStore(dir), cleanup: async () => fs.rmSync(dir, { recursive: true, force: true }) };
  }],
  ["PgStore (real Postgres via PGlite)", async () => {
    const db = await makePgliteDb();
    const store = new PgStore(db, `contract-${Math.random()}`);
    return { store, cleanup: () => store.close() };
  }],
];

describe.each(makers)("Store contract: %s", (_name, make) => {
  let store: Store;
  let cleanup: () => Promise<void>;
  beforeAll(async () => ({ store, cleanup } = await make()));
  afterAll(async () => cleanup());

  it("bootstraps demo data and looks things up by token", async () => {
    expect((await store.getStudio()).ownerToken).toBe("demo-owner");
    const projects = await store.listProjects();
    expect(projects.map((p) => p.id)).toEqual(["p-sharma", "p-mehta", "p-verma", "p-kapoor"]); // insertion order preserved
    expect((await store.getProjectByClientToken("demo-client-verma"))?.id).toBe("p-verma");
    expect(await store.getProjectByClientToken("nope")).toBeNull();
    expect((await store.getSupervisorByToken("demo-supervisor"))?.id).toBe("sup-ravi");
    expect((await store.getSupervisor("sup-ravi"))?.name).toBe("Ravi Kumar");
    expect(await store.getProject("p-kapoor")).toMatchObject({ homeType: "3BHK", showcase: true, amc: { plan: "Gold AMC" } });
    expect((await store.listCheckins("p-kapoor")).length).toBe(9);
    expect((await store.listInterests())).toEqual([]);
  });

  it("creates supervisors and projects, linking them", async () => {
    const sup: Supervisor = { id: "sup-new", name: "Imran", token: "tok-sup-new-0001", projectIds: [] };
    await store.createSupervisor(sup);
    await rejects(store.createSupervisor({ ...sup, id: "other" }), "CONFLICT"); // same token
    const proj: Project = { id: "p-new", slug: "new", name: "New 2BHK", clientName: "Asha Rao", address: "x", locality: "y", homeType: "2BHK", showcase: false, startDate: "2026-07-01", clientToken: "tok-client-new-0001", supervisorId: "sup-new", stages: (await store.getProject("p-verma"))!.stages };
    await store.createProject(proj);
    expect((await store.getSupervisor("sup-new"))!.projectIds).toEqual(["p-new"]);
    expect((await store.getProjectByClientToken("tok-client-new-0001"))?.id).toBe("p-new");
    await rejects(store.createProject({ ...proj, id: "p-new2" }), "CONFLICT"); // same client token
    await rejects(store.createProject({ ...proj, id: "p-new3", clientToken: "tok-other-0000001", supervisorId: "ghost" }), "NOT_FOUND");
    expect((await store.listSupervisors()).map((s) => s.id)).toContain("sup-new");
  });

  it("updates a project under a lock", async () => {
    await store.updateProject("p-new", (p) => { p.showcase = true; p.style = "Boho"; });
    expect(await store.getProject("p-new")).toMatchObject({ showcase: true, style: "Boho" });
    await Promise.all(Array.from({ length: 10 }, (_, i) => store.updateProject("p-new", (p) => { p.amc = { plan: "x", startsOn: "handover", months: 12, visits: 2, coverage: [], visitLog: [...(p.amc?.visitLog ?? []), { date: "2026-08-01", note: `v${i}` }] }; })));
    expect((await store.getProject("p-new"))!.amc!.visitLog).toHaveLength(10); // no lost updates
    await rejects(store.updateProject("ghost", () => undefined), "NOT_FOUND");
  });

  it("adds check-ins idempotently and stores photos", async () => {
    const r1 = await store.addCheckin(ck("c-1"), [photo("c-1-1.jpg")]);
    expect(r1.created).toBe(true);
    const r2 = await store.addCheckin(ck("c-1", "p-verma", { note: "different" }), [photo("c-1-1.jpg")]);
    expect(r2).toMatchObject({ created: false, checkin: { note: "n" } });
    expect(Array.from((await store.readPhoto("p-verma", "c-1-1.jpg"))!)).toEqual([0xff, 0xd8, 0xff, 1, 2, 3]);
    expect(await store.readPhoto("p-verma", "missing.jpg")).toBeNull();
    expect(await store.readPhoto("p-verma", "../db.json")).toBeNull();
    expect(await store.readPhoto("..", "x")).toBeNull();
    expect(await store.readPhoto("p-sharma", "c-1-1.jpg")).toBeNull(); // photos are per project
    expect((await store.getCheckin("c-1"))?.review).toBe("pending");
  });

  it("does not lose concurrent check-ins", async () => {
    const before = (await store.listCheckins()).length;
    await Promise.all(Array.from({ length: 15 }, (_, i) => store.addCheckin(ck(`par-${i}`), [photo(`par-${i}-1.jpg`)])));
    expect((await store.listCheckins()).length).toBe(before + 15);
  });

  it("approves exactly once, even when two owners tap at the same time", async () => {
    await store.addCheckin(ck("c-race"), []);
    const results = await Promise.allSettled([store.approveCheckin("c-race", "A", "2026-06-15T10:00:00Z"), store.approveCheckin("c-race", "B", "2026-06-15T10:00:01Z")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const loser = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(errorCode(loser.reason)).toBe("CONFLICT");
    expect((await store.getCheckin("c-race"))?.review).toBe("approved");
    await rejects(store.approveCheckin("ghost", "x", "t"), "NOT_FOUND");
  });

  it("stores the feed selection at approval and can change it later (published only)", async () => {
    await store.addCheckin(ck("c-show", "p-verma", { photos: [1, 2].map((n) => ({ fileName: `c-show-${n}.jpg`, stageId: "carpentry", takenAt: "x", width: 1, height: 1 })) }), [photo("c-show-1.jpg"), photo("c-show-2.jpg")]);
    await rejects(store.setShowcase("c-show", { photos: [], caption: "" }), "CONFLICT"); // still pending
    await store.approveCheckin("c-show", "msg", "2026-06-15T10:00:00Z", { photos: [{ id: "sc-abc-1", fileName: "c-show-1.jpg", stageId: "carpentry" }], caption: "Lovely" });
    expect(await store.findCheckinByShowcaseId("sc-abc-1")).toMatchObject({ id: "c-show", showcaseCaption: "Lovely" });
    await store.setShowcase("c-show", { photos: [{ id: "sc-abc-2", fileName: "c-show-2.jpg", stageId: "carpentry" }], caption: "" });
    expect(await store.findCheckinByShowcaseId("sc-abc-1")).toBeNull();
    expect((await store.findCheckinByShowcaseId("sc-abc-2"))?.id).toBe("c-show");
    expect(await store.findCheckinByShowcaseId("nope")).toBeNull();
    await rejects(store.setShowcase("ghost", { photos: [], caption: "" }), "NOT_FOUND");
  });

  it("records one interest per client and photo", async () => {
    const i = { id: "i-1", projectId: "p-mehta", showcaseId: "demo-sc-1", createdAt: "2026-06-15T10:00:00Z" };
    expect(await store.addInterest(i)).toMatchObject({ created: true });
    expect(await store.addInterest({ ...i, id: "i-2" })).toMatchObject({ created: false, interest: { id: "i-1" } });
    expect(await store.addInterest({ ...i, id: "i-3", projectId: "p-sharma" })).toMatchObject({ created: true });
    expect((await store.listInterests()).map((x) => x.id)).toEqual(["i-1", "i-3"]);
  });
});
