import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// connection() needs a real Next request scope; in a direct handler call it is a no-op.
vi.mock("next/server", () => ({ connection: async () => undefined }));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sv-admin-"));
process.env.DATA_DIR = dir;
delete process.env.DATABASE_URL;
delete process.env.DEMO_HUB;

const OWNER = "demo-owner", SUP = "demo-supervisor", MEHTA = "demo-client-mehta", SHARMA = "demo-client-sharma";
type H = (req: Request, ctx?: never) => Promise<Response>;
let h: Record<string, H>;
let getStore: typeof import("@/lib/store").getStore;

beforeAll(async () => {
  getStore = (await import("@/lib/store")).getStore;
  h = {
    supervisors: (await import("@/app/api/supervisors/route")).POST as unknown as H,
    projects: (await import("@/app/api/projects/route")).POST as unknown as H,
    patch: (await import("@/app/api/projects/[id]/route")).PATCH as unknown as H,
    amc: (await import("@/app/api/projects/[id]/amc/route")).PUT as unknown as H,
    visits: (await import("@/app/api/projects/[id]/amc/visits/route")).POST as unknown as H,
    approve: (await import("@/app/api/checkins/[id]/approve/route")).POST as unknown as H,
    showcase: (await import("@/app/api/checkins/[id]/showcase/route")).POST as unknown as H,
    feed: (await import("@/app/api/feed/[id]/route")).GET as unknown as H,
    interests: (await import("@/app/api/interests/route")).POST as unknown as H,
    health: (await import("@/app/api/health/route")).GET as unknown as H,
  };
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const post = (body: unknown, method = "POST") => new Request("http://x/api", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const call = (name: string, req: Request, params: Record<string, string> = {}) => h[name](req, { params: Promise.resolve(params) } as never);
const body = async (r: Response) => r.json();

describe("health", () => {
  it("reports ok", async () => {
    const r = await h.health(new Request("http://x/api/health"));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
  });
});

describe("supervisors and projects (owner only)", () => {
  const proj = { name: "Rao 3BHK", clientName: "Asha Rao", address: "12 Lake Road", locality: "Sector 9", startDate: "2026-07-01", homeType: "3BHK", style: "Boho", clientPhone: "+91 98765 43210" };
  let created: { id: string; clientToken: string; supervisorToken: string };

  it("rejects missing, wrong-role and garbage tokens", async () => {
    for (const [token, status] of [[undefined, 401], ["garbage", 401], [SUP, 403], [MEHTA, 403]] as const) {
      expect((await call("supervisors", post({ token, name: "Imran" }))).status, String(token)).toBe(status);
      expect((await call("projects", post({ token, ...proj, newSupervisorName: "X" }))).status).toBe(status);
    }
  });

  it("creates a supervisor and returns a working secret link token", async () => {
    const r = await call("supervisors", post({ token: OWNER, name: "Imran" }));
    expect(r.status).toBe(201);
    const s = await body(r);
    expect(s.token).toHaveLength(24);
    expect((await getStore().getSupervisorByToken(s.token))?.name).toBe("Imran");
    expect((await call("supervisors", post({ token: OWNER, name: "" }))).status).toBe(400);
  });

  it("creates a project with a new supervisor, linking both", async () => {
    const r = await call("projects", post({ token: OWNER, ...proj, newSupervisorName: "Salim" }));
    expect(r.status).toBe(201);
    created = await body(r);
    const p = (await getStore().getProject(created.id))!;
    expect(p).toMatchObject({ name: "Rao 3BHK", clientPhone: "919876543210", homeType: "3BHK", style: "Boho", showcase: false });
    expect(p.stages).toHaveLength(7);
    const sup = (await getStore().getSupervisorByToken(created.supervisorToken))!;
    expect(sup.projectIds).toEqual([created.id]);
    expect((await getStore().getProjectByClientToken(created.clientToken))?.id).toBe(created.id);
  });

  it("assigns an existing supervisor and validates input", async () => {
    const r = await call("projects", post({ token: OWNER, ...proj, name: "Second", supervisorId: "sup-ravi" }));
    expect(r.status).toBe(201);
    expect((await getStore().getSupervisor("sup-ravi"))!.projectIds).toContain((await body(r)).id);
    const bad = await call("projects", post({ token: OWNER, ...proj, startDate: "nope", newSupervisorName: "X" }));
    expect(bad.status).toBe(400);
    expect((await body(bad)).errors.join()).toMatch(/Start date/);
    expect((await call("projects", post({ token: OWNER, ...proj, supervisorId: "ghost" }))).status).toBe(400);
  });

  it("patches settings: feed consent, label, phone", async () => {
    const id = created.id;
    expect((await call("patch", post({ token: SUP, showcase: true }, "PATCH"), { id })).status).toBe(403);
    const r = await call("patch", post({ token: OWNER, showcase: true, style: "Industrial", clientPhone: "" }, "PATCH"), { id });
    expect(r.status).toBe(200);
    const saved = (await getStore().getProject(id))!;
    expect(saved).toMatchObject({ showcase: true, style: "Industrial" });
    expect(saved.clientPhone).toBeUndefined(); // an empty phone clears it
    expect((await call("patch", post({ token: OWNER, showcase: true }, "PATCH"), { id: "ghost" })).status).toBe(404);
    expect((await call("patch", post({ token: OWNER, showcase: "yes" }, "PATCH"), { id })).status).toBe(400);
  });
});

describe("AMC (owner only)", () => {
  const amc = { plan: "Silver AMC", startsOn: "handover", months: 12, visits: 2, coverage: "Hinges\nPaint touch-ups", purchasedOn: "2026-06-01" };
  it("is owner only", async () => {
    expect((await call("amc", post({ token: SUP, amc }, "PUT"), { id: "p-sharma" })).status).toBe(403);
    expect((await call("amc", post({ token: SHARMA, amc }, "PUT"), { id: "p-sharma" })).status).toBe(403);
    expect((await call("visits", post({ token: SHARMA, date: "2026-06-01", note: "abc" }), { id: "p-kapoor" })).status).toBe(403);
  });
  it("sets, replaces (keeping the visit log) and removes an AMC", async () => {
    expect((await call("visits", post({ token: OWNER, date: "2026-06-01", note: "Checked doors" }), { id: "p-sharma" })).status).toBe(409); // no AMC yet
    expect((await call("amc", post({ token: OWNER, amc }, "PUT"), { id: "p-sharma" })).status).toBe(200);
    expect((await getStore().getProject("p-sharma"))!.amc).toMatchObject({ plan: "Silver AMC", coverage: ["Hinges", "Paint touch-ups"], visitLog: [] });
    expect((await call("visits", post({ token: OWNER, date: "2026-06-01", note: "Checked doors" }), { id: "p-sharma" })).status).toBe(201);
    expect((await call("visits", post({ token: OWNER, date: "2999-01-01", note: "Future" }), { id: "p-sharma" })).status).toBe(400);
    await call("amc", post({ token: OWNER, amc: { ...amc, plan: "Silver Plus" } }, "PUT"), { id: "p-sharma" });
    expect((await getStore().getProject("p-sharma"))!.amc).toMatchObject({ plan: "Silver Plus", visitLog: [{ date: "2026-06-01", note: "Checked doors" }] });
    expect((await call("amc", post({ token: OWNER, amc: { ...amc, months: 0 } }, "PUT"), { id: "p-sharma" })).status).toBe(400);
    expect((await call("amc", post({ token: OWNER, amc: null }, "PUT"), { id: "p-sharma" })).status).toBe(200);
    expect((await getStore().getProject("p-sharma"))!.amc).toBeUndefined();
    expect((await call("amc", post({ token: OWNER, amc }, "PUT"), { id: "ghost" })).status).toBe(404);
  });
});

describe("inspiration feed: selection, photo route and interests", () => {
  const kapoorPhoto = async () => (await getStore().listCheckins("p-kapoor")).flatMap((c) => c.showcase ?? [])[0];
  const feedGet = (id: string, t?: string) => call("feed", new Request(`http://x/api/feed/${id}${t ? `?t=${t}` : ""}`), { id });

  it("serves a selected photo to clients of OTHER projects and the owner only", async () => {
    const sc = await kapoorPhoto();
    const ok = await feedGet(sc.id, MEHTA);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/svg+xml");
    expect((await feedGet(sc.id, OWNER)).status).toBe(200);
    expect((await feedGet(sc.id, SUP)).status).toBe(404);
    expect((await feedGet(sc.id)).status).toBe(404);
    expect((await feedGet(sc.id, "garbage")).status).toBe(404);
    expect((await feedGet("nope", MEHTA)).status).toBe(404);
  });

  it("stops serving the moment feed consent is withdrawn", async () => {
    const sc = await kapoorPhoto();
    await call("patch", post({ token: OWNER, showcase: false }, "PATCH"), { id: "p-kapoor" });
    expect((await feedGet(sc.id, MEHTA)).status).toBe(404);
    await call("patch", post({ token: OWNER, showcase: true }, "PATCH"), { id: "p-kapoor" });
    expect((await feedGet(sc.id, MEHTA)).status).toBe(200);
  });

  it("never serves photos of an unpublished update, even if somehow selected", async () => {
    const pending = (await getStore().listCheckins("p-sharma")).find((c) => c.review === "pending")!;
    await getStore().updateProject("p-sharma", () => undefined);
    const r = await call("showcase", post({ token: OWNER, fileNames: [pending.photos[0].fileName], caption: "" }), { id: pending.id });
    expect(r.status).toBe(409); // must publish first
    expect(await getStore().findCheckinByShowcaseId("anything")).toBeNull();
  });

  it("approve records the owner's photo choice and caption (only when the project has consent)", async () => {
    const pending = (await getStore().listCheckins("p-sharma")).find((c) => c.review === "pending")!;
    const bad = await call("approve", post({ token: OWNER, message: "Hi", showcase: { fileNames: ["foreign.jpg"], caption: "" } }), { id: pending.id });
    expect(bad.status).toBe(400);
    expect((await getStore().getCheckin(pending.id))!.review).toBe("pending"); // a bad selection does not half-publish
    const pick = pending.photos[0].fileName;
    const ok = await call("approve", post({ token: OWNER, message: "Hi", showcase: { fileNames: [pick], caption: "Lovely finish" } }), { id: pending.id });
    expect(ok.status).toBe(200);
    const saved = (await getStore().getCheckin(pending.id))!;
    expect(saved.showcase).toHaveLength(1);
    expect(saved.showcase![0].fileName).toBe(pick);
    expect(saved.showcaseCaption).toBe("Lovely finish");
    // visible on the feed to another client
    expect((await feedGet(saved.showcase![0].id, MEHTA)).status).toBe(200);

    // a project WITHOUT consent ignores any selection
    const mehtaPending = (await getStore().listCheckins("p-mehta")).find((c) => c.review === "pending")!;
    await call("approve", post({ token: OWNER, message: "Hi", showcase: { fileNames: [mehtaPending.photos[0].fileName], caption: "" } }), { id: mehtaPending.id });
    expect((await getStore().getCheckin(mehtaPending.id))!.showcase).toBeUndefined();
    expect((await call("showcase", post({ token: OWNER, fileNames: [], caption: "" }), { id: mehtaPending.id })).status).toBe(409); // no consent
  });

  it("owner can change the selection later; kept photos keep their handle", async () => {
    const c = (await getStore().listCheckins("p-kapoor")).find((x) => (x.showcase?.length ?? 0) >= 2)!;
    const [first, second] = c.showcase!;
    const r = await call("showcase", post({ token: OWNER, fileNames: [first.fileName], caption: "Final look" }), { id: c.id });
    expect(r.status).toBe(200);
    const after = (await getStore().getCheckin(c.id))!;
    expect(after.showcase).toEqual([first]);
    expect((await feedGet(first.id, MEHTA)).status).toBe(200);
    expect((await feedGet(second.id, MEHTA)).status).toBe(404);
    expect((await call("showcase", post({ token: SUP, fileNames: [], caption: "" }), { id: c.id })).status).toBe(403);
  });

  it("interest: clients only, other projects' photos only, once per photo", async () => {
    const sc = await kapoorPhoto();
    const r1 = await call("interests", post({ token: MEHTA, showcaseId: sc.id }));
    expect(r1.status).toBe(201);
    const r2 = await call("interests", post({ token: MEHTA, showcaseId: sc.id }));
    expect(r2.status).toBe(200);
    expect((await r2.json()).repeated).toBe(true);
    expect((await getStore().listInterests()).filter((i) => i.projectId === "p-mehta")).toHaveLength(1);
    expect((await call("interests", post({ token: OWNER, showcaseId: sc.id }))).status).toBe(403);
    expect((await call("interests", post({ token: SUP, showcaseId: sc.id }))).status).toBe(403);
    expect((await call("interests", post({ showcaseId: sc.id }))).status).toBe(401);
    expect((await call("interests", post({ token: MEHTA, showcaseId: "nope" }))).status).toBe(404);
    const own = (await getStore().listCheckins("p-verma")).flatMap((c) => c.showcase ?? [])[0];
    expect((await call("interests", post({ token: "demo-client-verma", showcaseId: own.id }))).status).toBe(404); // not their own site
  });
});
