import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sv-api-"));
process.env.DATA_DIR = dir;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.DEMO_HUB;

const SUP = "demo-supervisor", OWNER = "demo-owner", CLIENT = "demo-client-verma", OTHER_CLIENT = "demo-client-sharma";

let checkinsPOST: typeof import("@/app/api/checkins/route").POST;
let approvePOST: typeof import("@/app/api/checkins/[id]/approve/route").POST;
let draftsPOST: typeof import("@/app/api/drafts/route").POST;
let photoGET: typeof import("@/app/api/photos/[project]/[file]/route").GET;
let getStore: typeof import("@/lib/store").getStore;
let jpegHasMetadata: typeof import("@/lib/photos").jpegHasMetadata;

beforeAll(async () => {
  ({ POST: checkinsPOST } = await import("@/app/api/checkins/route"));
  ({ POST: approvePOST } = await import("@/app/api/checkins/[id]/approve/route"));
  ({ POST: draftsPOST } = await import("@/app/api/drafts/route"));
  ({ GET: photoGET } = await import("@/app/api/photos/[project]/[file]/route"));
  ({ getStore } = await import("@/lib/store"));
  ({ jpegHasMetadata } = await import("@/lib/photos"));
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

function jpegWithExif(): Uint8Array {
  const exif = [0xff, 0xe1, 0x00, 0x0e, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x47, 0x50, 0x53, 0x21];
  const jfif = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  return Uint8Array.from([0xff, 0xd8, ...jfif, ...exif, 0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 63, 0, 0x12, 0x34, 0xff, 0xd9]);
}

interface PostOpts { token?: string | null; projectId?: string; updates?: unknown; note?: string; files?: { name: string; bytes: Uint8Array; type?: string }[]; location?: unknown; id?: string; photoMeta?: unknown }
function checkinRequest(o: PostOpts = {}): Request {
  const fd = new FormData();
  if (o.token !== null) fd.set("token", o.token ?? SUP);
  fd.set("projectId", o.projectId ?? "p-verma");
  fd.set("updates", JSON.stringify(o.updates ?? [{ stageId: "carpentry", state: "working", percent: 80 }]));
  fd.set("note", o.note ?? "internal note: supplier delay");
  fd.set("location", JSON.stringify(o.location === undefined ? { lat: 28.4, lng: 77.1, accuracy: 20 } : o.location));
  const files = o.files ?? [];
  fd.set("photoMeta", JSON.stringify(o.photoMeta ?? files.map(() => ({ stageId: "carpentry", takenAt: new Date().toISOString(), width: 800, height: 600 }))));
  if (o.id) fd.set("id", o.id);
  for (const f of files) fd.append("photos", new Blob([f.bytes as BlobPart], { type: f.type ?? "image/jpeg" }), f.name);
  return new Request("http://x/api/checkins", { method: "POST", body: fd });
}
const jsonReq = (body: unknown, url = "http://x/api") => new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const photoReq = (project: string, file: string, token?: string) => photoGET(new Request(`http://x/api/photos/${project}/${file}${token ? `?t=${token}` : ""}`), { params: Promise.resolve({ project, file }) } as never);
const approveReq = (id: string, body: unknown) => approvePOST(jsonReq(body), { params: Promise.resolve({ id }) } as never);

describe("POST /api/checkins", () => {
  it("rejects missing/unknown tokens (401) and non-supervisor or foreign roles (403)", async () => {
    expect((await checkinsPOST(checkinRequest({ token: null }))).status).toBe(401);
    expect((await checkinsPOST(checkinRequest({ token: "nope" }))).status).toBe(401);
    expect((await checkinsPOST(checkinRequest({ token: CLIENT }))).status).toBe(403);
    expect((await checkinsPOST(checkinRequest({ token: OWNER }))).status).toBe(403);
    expect((await checkinsPOST(checkinRequest({ projectId: "p-other" }))).status).toBe(403);
  });

  it("stores a pending check-in, strips EXIF server-side, keeps location, and drafts a message", async () => {
    const res = await checkinsPOST(checkinRequest({ id: "api-test-0001", files: [{ name: "a.jpg", bytes: jpegWithExif() }] }));
    expect(res.status).toBe(201);
    const store = getStore();
    const c = (await store.getCheckin("api-test-0001"))!;
    expect(c.review).toBe("pending");
    expect(c.location).toEqual({ lat: 28.4, lng: 77.1, accuracy: 20 });
    expect(c.draftMessage).toContain("Hi Anita,");
    expect(c.photos).toHaveLength(1);
    const bytes = (await store.readPhoto("p-verma", c.photos[0].fileName))!;
    expect(jpegHasMetadata(bytes)).toBe(false);
    expect(Buffer.from(bytes).toString("latin1")).not.toContain("GPS!");
  });

  it("is idempotent for retries with the same id", async () => {
    const before = (await getStore().listCheckins("p-verma")).length;
    const res = await checkinsPOST(checkinRequest({ id: "api-test-0001" }));
    expect(res.status).toBe(200);
    expect((await res.json()).duplicate).toBe(true);
    expect((await getStore().listCheckins("p-verma")).length).toBe(before);
  });

  it("validates input and rejects SVG / non-images / too many photos", async () => {
    const bad = async (o: PostOpts) => (await checkinsPOST(checkinRequest(o))).status;
    expect(await bad({ updates: [{ stageId: "nope", state: "done" }] })).toBe(400);
    expect(await bad({ updates: [{ stageId: "paint", state: "blocked" }] })).toBe(400);
    expect(await bad({ updates: [{ stageId: "paint", state: "working", percent: 120 }] })).toBe(400);
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');
    const r = await checkinsPOST(checkinRequest({ files: [{ name: "x.svg", bytes: svg, type: "image/svg+xml" }] }));
    expect(r.status).toBe(400);
    expect(JSON.stringify(await r.json())).toMatch(/SVG/);
    expect(await bad({ files: [{ name: "x.jpg", bytes: svg, type: "image/jpeg" }] })).toBe(400); // lying mime type
    const nine = Array.from({ length: 9 }, (_, i) => ({ name: `${i}.jpg`, bytes: jpegWithExif() }));
    expect(await bad({ files: nine })).toBe(400);
  });

  it("survives many concurrent submissions without losing any", async () => {
    const before = (await getStore().listCheckins()).length;
    const results = await Promise.all(Array.from({ length: 15 }, (_, i) => checkinsPOST(checkinRequest({ id: `parallel-${String(i).padStart(3, "0")}`, note: `n${i}` }))));
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect((await getStore().listCheckins()).length).toBe(before + 15);
    JSON.parse(fs.readFileSync(path.join(dir, "db.json"), "utf8")); // still valid JSON
    expect(fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});

describe("photo access", () => {
  let photo = "";
  beforeAll(async () => {
    photo = (await getStore().getCheckin("api-test-0001"))!.photos[0].fileName;
  });

  it("pending photos: owner and supervisor yes, client and strangers no (404)", async () => {
    expect((await photoReq("p-verma", photo, OWNER)).status).toBe(200);
    expect((await photoReq("p-verma", photo, SUP)).status).toBe(200);
    expect((await photoReq("p-verma", photo, CLIENT)).status).toBe(404);
    expect((await photoReq("p-verma", photo, OTHER_CLIENT)).status).toBe(404);
    expect((await photoReq("p-verma", photo)).status).toBe(404);
    expect((await photoReq("p-verma", photo, "garbage")).status).toBe(404);
  });

  it("approved photos: only that project's client, plus path tricks fail", async () => {
    const approvedSeed = (await getStore().listCheckins("p-verma")).find((c) => c.review === "approved")!.photos[0].fileName;
    const ok = await photoReq("p-verma", approvedSeed, CLIENT);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/svg+xml");
    expect(ok.headers.get("content-security-policy")).toContain("sandbox");
    expect((await photoReq("p-verma", approvedSeed, OTHER_CLIENT)).status).toBe(404);
    expect((await photoReq("p-sharma", approvedSeed, CLIENT)).status).toBe(404);
    expect((await photoReq("p-verma", "..%2Fdb.json", OWNER)).status).toBe(404);
    expect((await photoReq("p-verma", "../db.json", OWNER)).status).toBe(404);
    expect((await photoReq("..", "db.json", OWNER)).status).toBe(404);
  });

  it("a pending seed photo is hidden from its own client until the owner publishes it", async () => {
    const pendingSeed = (await getStore().listCheckins("p-sharma")).find((c) => c.review === "pending")!;
    const f = pendingSeed.photos[0].fileName;
    expect((await photoReq("p-sharma", f, "demo-client-sharma")).status).toBe(404);
    expect((await approveReq(pendingSeed.id, { token: OWNER, message: "Update" })).status).toBe(200);
    expect((await photoReq("p-sharma", f, "demo-client-sharma")).status).toBe(200);
  });
});

describe("POST /api/checkins/:id/approve", () => {
  it("is owner only", async () => {
    expect((await approveReq("api-test-0001", { message: "hi" })).status).toBe(401);
    expect((await approveReq("api-test-0001", { token: SUP, message: "hi" })).status).toBe(403);
    expect((await approveReq("api-test-0001", { token: CLIENT, message: "hi" })).status).toBe(403);
  });
  it("validates the message and the id", async () => {
    expect((await approveReq("api-test-0001", { token: OWNER, message: "   " })).status).toBe(400);
    expect((await approveReq("api-test-0001", { token: OWNER, message: "x".repeat(2000) })).status).toBe(400);
    expect((await approveReq("does-not-exist", { token: OWNER, message: "hi" })).status).toBe(404);
  });
  it("publishes once; a second publish is 409 and does not change the stored message", async () => {
    const ok = await approveReq("api-test-0001", { token: OWNER, message: "Edited message" });
    expect(ok.status).toBe(200);
    const again = await approveReq("api-test-0001", { token: OWNER, message: "Overwrite attempt" });
    expect(again.status).toBe(409);
    const c = (await getStore().getCheckin("api-test-0001"))!;
    expect(c.review).toBe("approved");
    expect(c.clientMessage).toBe("Edited message");
  });
  it("double-click race: exactly one of two simultaneous publishes wins", async () => {
    await checkinsPOST(checkinRequest({ id: "api-race-0001" }));
    const [a, b] = await Promise.all([approveReq("api-race-0001", { token: OWNER, message: "A" }), approveReq("api-race-0001", { token: OWNER, message: "B" })]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });
});

describe("POST /api/drafts", () => {
  it("401/403 before anything else", async () => {
    expect((await draftsPOST(jsonReq({ checkinId: "x" }))).status).toBe(401);
    expect((await draftsPOST(jsonReq({ token: SUP, checkinId: "x" }))).status).toBe(403);
  });
  it("is 501 without an API key", async () => {
    const r = await draftsPOST(jsonReq({ token: OWNER, checkinId: "x" }));
    expect(r.status).toBe(501);
  });
  describe("with a key (HTTP mocked)", () => {
    const pendingId = "api-ai-0001";
    beforeAll(async () => {
      process.env.ANTHROPIC_API_KEY = "test-key";
      await checkinsPOST(checkinRequest({ id: pendingId }));
    });
    afterAll(() => { delete process.env.ANTHROPIC_API_KEY; vi.unstubAllGlobals(); });

    it("returns the AI text when it passes the guard", async () => {
      vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ content: [{ type: "text", text: "Hi Anita! Carpentry is 80% done today." }] })));
      const r = await draftsPOST(jsonReq({ token: OWNER, checkinId: pendingId }));
      expect(await r.json()).toMatchObject({ source: "ai", message: "Hi Anita! Carpentry is 80% done today." });
    });
    it("falls back to the template when the AI invents a date", async () => {
      vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ content: [{ type: "text", text: "Hi Anita! We will finish on 3 Jan." }] })));
      const body = await (await draftsPOST(jsonReq({ token: OWNER, checkinId: pendingId }))).json();
      expect(body.source).toBe("template");
      expect(body.message).toContain("Hi Anita,");
      expect(body.warning).toMatch(/AI rewrite was not used/);
    });
    it("404 for an unknown check-in, 409 for a published one", async () => {
      expect((await draftsPOST(jsonReq({ token: OWNER, checkinId: "nope" }))).status).toBe(404);
      expect((await draftsPOST(jsonReq({ token: OWNER, checkinId: "api-test-0001" }))).status).toBe(409);
    });
  });
});
