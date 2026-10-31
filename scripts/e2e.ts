/**
 * End-to-end check against the PRODUCTION build (run `npm run build` first; `npm run verify` does).
 * Starts the server on a free port with a throwaway data dir, then drives real Chromium
 * through the whole pilot flow at real viewports. Exits non-zero on any failure.
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import pg from "pg";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { addDays, todayIST } from "../lib/dates";
import { jpegHasMetadata } from "../lib/photos";

const ROOT = path.resolve(import.meta.dirname, "..");
const SHOTS = path.join(ROOT, "e2e-output", "shots");
fs.mkdirSync(SHOTS, { recursive: true });

type Backend = "json" | "pg";
const SUP = "demo-supervisor", OWNER = "demo-owner";
const CLIENT = (slug: string) => `demo-client-${slug}`;
const NOTE_MARK = "Aaj tile ka kaam ho gaya MARKER-7731";
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };
const GEO = { latitude: 28.4595, longitude: 77.0266, accuracy: 15 };

// ---------------------------------------------------------------- harness
let results: { name: string; ok: boolean; err?: string }[] = [];
const problems: string[] = []; // browser console errors, page errors, 5xx
async function step(name: string, fn: () => Promise<void>) {
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name} (${Date.now() - t} ms)`);
  } catch (e) {
    const msg = e instanceof Error ? e.message.split("\n").slice(0, 6).join("\n      ") : String(e);
    results.push({ name, ok: false, err: msg });
    console.log(`  ✗ ${name}\n      ${msg}`);
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
    s.on("error", reject);
  });
}

interface Row { id: string; projectId: string; review: string; location: unknown; photos: { fileName: string; width: number; height: number }[]; note: string; clientMessage?: string; showcase?: { id: string; fileName: string }[]; showcaseCaption?: string }
interface Backing { checkins(): Promise<Row[]>; photo(projectId: string, fileName: string): Promise<Buffer | null>; tmpFiles(): string[]; close(): Promise<void> }
interface Server { base: string; backing: Backing; stop: () => Promise<void> }

async function startServer(backend: Backend, env: Record<string, string | undefined> = {}): Promise<Server> {
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sv-e2e-"));
  const nextBin = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
  const e: NodeJS.ProcessEnv = { ...process.env, DATA_DIR: dataDir, NODE_ENV: "production", PORT: String(port), DEMO_HUB: "on" };
  delete e.ANTHROPIC_API_KEY; delete e.DATABASE_URL;
  let pgServer: PGLiteSocketServer | null = null;
  let pglite: PGlite | null = null;
  let pool: pg.Pool | null = null;
  if (backend === "pg") {
    // Real Postgres (WASM) over TCP, so the production `pg` driver and SQL run exactly as they would on a host.
    pglite = await PGlite.create();
    const pgPort = await freePort();
    pgServer = new PGLiteSocketServer({ db: pglite, port: pgPort, host: "127.0.0.1", maxConnections: 10 });
    await pgServer.start();
    e.DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${pgPort}/postgres`;
    pool = new pg.Pool({ connectionString: e.DATABASE_URL, max: 2 });
  }
  Object.assign(e, env);
  const child: ChildProcess = spawn(process.execPath, [nextBin, "start", "-p", String(port)], { cwd: ROOT, env: e, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout?.on("data", (d) => (log += d));
  child.stderr?.on("data", (d) => (log += d));
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(base + "/robots.txt");
      if (r.ok) break;
    } catch { /* not up yet */ }
    if (child.exitCode !== null) throw new Error(`server exited early:\n${log}`);
    await new Promise((r) => setTimeout(r, 250));
    if (i === 79) throw new Error(`server did not start:\n${log}`);
  }
  const backing: Backing = pool
    ? {
        checkins: async () => (await pool!.query("SELECT data FROM checkins ORDER BY seq")).rows.map((r) => r.data as Row),
        photo: async (projectId, fileName) => { const r = await pool!.query("SELECT bytes FROM photos WHERE project_id = $1 AND file_name = $2", [projectId, fileName]); return r.rows[0] ? Buffer.from(r.rows[0].bytes) : null; },
        tmpFiles: () => [],
        close: async () => { await pool!.end(); },
      }
    : {
        checkins: async () => (JSON.parse(fs.readFileSync(path.join(dataDir, "db.json"), "utf8")) as { checkins: Row[] }).checkins,
        photo: async (projectId, fileName) => { const f = path.join(dataDir, "photos", projectId, fileName); return fs.existsSync(f) ? fs.readFileSync(f) : null; },
        tmpFiles: () => fs.readdirSync(dataDir).filter((f) => f.endsWith(".tmp")),
        close: async () => undefined,
      };
  return {
    base,
    backing,
    stop: async () => {
      child.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 300));
      await backing.close();
      await pgServer?.stop();
      await pglite?.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

function watch(page: Page, label: string) {
  page.on("pageerror", (e) => problems.push(`[${label}] pageerror: ${e.message}`));
  page.on("console", (m) => {
    // Going offline on purpose (the offline step) makes the browser log this; it is expected there and only there.
    if (m.type() === "error" && !(label === "offline" && /ERR_INTERNET_DISCONNECTED/.test(m.text()))) problems.push(`[${label}] console.error: ${m.text()}`);
  });
  page.on("response", (r) => { if (r.status() >= 500) problems.push(`[${label}] ${r.status()} ${r.url()}`); });
}

async function newPage(browser: Browser, label: string, opts: Parameters<Browser["newContext"]>[0] = {}): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  watch(page, label);
  return { ctx, page };
}

const phoneOpts = (extra = {}) => ({ viewport: PHONE, isMobile: true, hasTouch: true, deviceScaleFactor: 2, ...extra });
const desktopOpts = { viewport: DESKTOP };

// ---------------------------------------------------------------- image helpers
async function makeExifJpeg(browser: Browser, w = 3000, h = 2000): Promise<Buffer> {
  const page = await browser.newPage();
  const b64 = await page.evaluate(({ w, h }) => {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d")!;
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, "#d8a15b"); grad.addColorStop(1, "#3f6d8c");
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    g.fillStyle = "#fff"; g.font = "bold 160px sans-serif"; g.fillText("SITE PHOTO", 200, 600);
    return c.toDataURL("image/jpeg", 0.92).split(",")[1];
  }, { w, h });
  await page.close();
  const jpg = Buffer.from(b64, "base64");
  const payload = Buffer.from("II*\0GPS-SECRET-LAT-28.4595N-LON-77.0266E");
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), Buffer.from([(payload.length + 8) >> 8, (payload.length + 8) & 255]), Buffer.from("Exif\0\0"), payload]);
  return Buffer.concat([jpg.subarray(0, 2), app1, jpg.subarray(2)]);
}

function jpegSize(b: Buffer): { w: number; h: number } {
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m === 0xc0 || m === 0xc2) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + b.readUInt16BE(i + 2);
  }
  throw new Error("no SOF marker");
}

// ---------------------------------------------------------------- page helpers
async function scrollThrough(page: Page) {
  await page.evaluate(async () => {
    const h = document.documentElement.scrollHeight;
    for (let y = 0; y < h; y += Math.max(300, window.innerHeight / 2)) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
    window.scrollTo(0, 0);
  });
}
async function assertNoHScroll(page: Page, where: string) {
  const over = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
  assert.ok(over <= 0, `${where}: horizontal scroll of ${over}px`);
}
async function assertImagesLoaded(page: Page, where: string) {
  await scrollThrough(page);
  await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete), null, { timeout: 8000 }).catch(() => undefined);
  const broken = await page.evaluate(() => Array.from(document.images).filter((i) => !(i.complete && i.naturalWidth > 0)).map((i) => i.src));
  assert.deepEqual(broken, [], `${where}: broken images`);
}
async function assertTapTargets(page: Page, where: string, selector = "button:visible, .btn:visible, input:not([type=file]):visible") {
  const small = await page.$$eval(selector, (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { t: (e.textContent || (e as HTMLInputElement).placeholder || e.className).trim().slice(0, 30), h: Math.round(r.height), w: Math.round(r.width) }; }).filter((x) => x.h > 0 && x.h < 44));
  assert.deepEqual(small, [], `${where}: tap targets under 44px`);
}
async function textareasNotCut(page: Page, where: string) {
  const cut = await page.$$eval("textarea", (els) => els.filter((t) => t.scrollHeight > t.clientHeight + 2).map((t) => t.id));
  assert.deepEqual(cut, [], `${where}: textarea content cut off`);
}

// ---------------------------------------------------------------- main
async function makeNoisyJpeg(browser: Browser, w: number, h: number): Promise<Buffer> {
  const page = await browser.newPage();
  const b64 = await page.evaluate(({ w, h }) => {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d")!;
    const img = g.createImageData(w, h);
    for (let i = 0; i < img.data.length; i += 4) { img.data[i] = Math.random() * 255; img.data[i + 1] = Math.random() * 255; img.data[i + 2] = Math.random() * 255; img.data[i + 3] = 255; }
    g.putImageData(img, 0, 0);
    return c.toDataURL("image/jpeg", 0.95).split(",")[1];
  }, { w, h });
  await page.close();
  return Buffer.from(b64, "base64");
}

async function suite(browser: Browser, backend: Backend, exifJpeg: Buffer) {
  results = [];
  problems.length = 0;
  const server = await startServer(backend);
  const { base, backing } = server;
  console.log(`\n=== E2E: ${backend === "pg" ? "Postgres (real SQL via PGlite over TCP, node-postgres driver)" : "JSON-file store"} · ${base} ===`);

  let newCheckinId = "";
  let newPhotoFile = "";
  const today = todayIST();

  console.log("\nSupervisor on a phone");
  await step("site list shows all sites with Update due / Updated", async () => {
    const { ctx, page } = await newPage(browser, "sup-list", phoneOpts({ geolocation: GEO, permissions: ["geolocation"] }));
    await page.goto(`${base}/s/${SUP}`);
    await page.waitForSelector('[data-testid="site-sharma"]');
    assert.equal(await page.locator('a[data-testid^="site-"]').count(), 4);
    const statuses = await page.locator('[data-testid="site-status"]').allTextContents();
    assert.ok(statuses.some((s) => /Update due/.test(s)), "Verma/Kapoor should be Update due");
    assert.ok(statuses.some((s) => /Updated/.test(s)), "Sharma/Mehta should be Updated");
    await assertNoHScroll(page, "supervisor list");
    await ctx.close();
  });

  await step("posts an update with a photo, note, validation and location", async () => {
    const { ctx, page } = await newPage(browser, "sup-form", phoneOpts({ geolocation: GEO, permissions: ["geolocation"] }));
    await page.goto(`${base}/s/${SUP}/p-mehta`);
    await page.waitForSelector('[data-testid="checkin-form"]');
    await assertNoHScroll(page, "check-in form");
    await assertTapTargets(page, "check-in form");

    await page.click('[data-testid="state-elec-blocked"]');
    await page.click('[data-testid="send"]');
    await page.waitForSelector('[data-testid="error-elec"]');
    assert.match(await page.textContent('[data-testid="error-elec"]') ?? "", /why it is blocked/i);
    await page.click('[data-testid="state-elec-not_started"]');
    assert.equal(await page.locator('[data-testid="error-elec"]').count(), 0);

    await page.click('[data-testid="pct-civil-75"]');
    await page.setInputFiles('[data-testid="photo-input-civil"]', { name: "site.jpg", mimeType: "image/jpeg", buffer: exifJpeg });
    await page.waitForSelector('[data-testid="photo-thumb-form"] img');
    await page.fill('[data-testid="note"]', NOTE_MARK);
    await textareasNotCut(page, "note");
    await page.waitForTimeout(1200);

    const summary = (await page.textContent('[data-testid="send-summary"]')) ?? "";
    assert.match(summary, /1 stage/); assert.match(summary, /1 photo/); assert.match(summary, /note/); assert.match(summary, /location/);
    await page.click('text=See exactly what is sent');
    const detail = (await page.textContent('[data-testid="send-detail"]')) ?? "";
    assert.match(detail, /Civil & demolition: Working 75%/);
    assert.match(detail, /Site location: captured/);

    await page.screenshot({ path: path.join(SHOTS, `${backend}-phone-sup-checkin-filled.png`) });
    await page.click('[data-testid="send"]');
    await page.waitForSelector('[data-testid="sent-ok"]', { timeout: 20_000 });
    await ctx.close();

    const mine = (await backing.checkins()).filter((c) => c.projectId === "p-mehta" && c.note === NOTE_MARK);
    assert.equal(mine.length, 1, "exactly one new check-in stored");
    const c = mine[0];
    newCheckinId = c.id;
    assert.equal(c.review, "pending", "stored as pending");
    assert.deepEqual({ lat: (c.location as { lat: number }).lat, lng: (c.location as { lng: number }).lng }, { lat: GEO.latitude, lng: GEO.longitude }, "location kept");
    assert.equal(c.photos.length, 1);
    newPhotoFile = c.photos[0].fileName;
    const bytes = (await backing.photo("p-mehta", newPhotoFile))!;
    assert.ok(bytes, "photo stored");
    assert.equal(bytes[0], 0xff); assert.equal(bytes[1], 0xd8);
    assert.ok(!jpegHasMetadata(bytes), "stored JPEG has no EXIF/APP segments");
    assert.ok(!bytes.toString("latin1").includes("GPS-SECRET"), "GPS marker removed");
    const { w, h } = jpegSize(bytes);
    assert.ok(Math.max(w, h) <= 1600, `compressed to max 1600px (got ${w}x${h})`);
    assert.equal(Math.max(c.photos[0].width, c.photos[0].height), 1600);
  });

  console.log("\nClient cannot see unapproved data");
  await step("client does not see the pending update or its photo", async () => {
    const { ctx, page } = await newPage(browser, "client-before", phoneOpts());
    await page.goto(`${base}/c/${CLIENT("mehta")}`);
    await page.waitForSelector('[data-testid="client-page"]');
    const html = await page.content();
    assert.ok(!html.includes("MARKER-7731"), "note must not appear");
    assert.equal(await page.locator('[data-testid="update"]').count(), 2, "only the 2 published updates");
    assert.equal((await page.request.get(`${base}/api/photos/p-mehta/${newPhotoFile}?t=${CLIENT("mehta")}`)).status(), 404, "unapproved photo is 404 for the client");
    assert.equal((await page.request.get(`${base}/api/photos/p-mehta/${newPhotoFile}`)).status(), 404);
    assert.equal((await page.request.get(`${base}/api/photos/p-mehta/${newPhotoFile}?t=${OWNER}`)).status(), 200, "owner can see it");
    assert.equal((await page.request.get(`${base}/api/photos/p-mehta/${newPhotoFile}?t=${SUP}`)).status(), 200, "supervisor can see it");
    await ctx.close();
  });

  console.log("\nOwner on desktop");
  await step("dashboard: KPIs and cards sorted by urgency (finished projects last)", async () => {
    const { ctx, page } = await newPage(browser, "owner-dash", desktopOpts);
    await page.goto(`${base}/a/${OWNER}`);
    await page.waitForSelector('[data-testid="kpi-awaiting"]');
    assert.equal((await page.textContent('[data-testid="kpi-awaiting"] .v'))?.trim(), "3", "Sharma 1 + Mehta 2");
    assert.equal((await page.textContent('[data-testid="kpi-active"] .v'))?.trim(), "3", "Kapoor is finished");
    const order = await page.locator('[data-testid^="project-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
    assert.deepEqual(order, ["project-sharma", "project-mehta", "project-verma", "project-kapoor"], "most urgent first, finished last");
    const healths = await page.locator('[data-testid^="project-"] [data-testid="health"]').allTextContents();
    assert.match(healths[0], /Needs attention/); assert.match(healths[1], /Watch/); assert.match(healths[2], /On track/);
    assert.match((await page.textContent('[data-testid="project-sharma"] [data-testid="first-flag"]')) ?? "", /blocked/i);
    assert.match((await page.textContent('[data-testid="project-kapoor"]')) ?? "", /All stages complete/);
    assert.ok(await page.isVisible('[data-testid="new-project"]'));
    await assertNoHScroll(page, "owner dashboard");
    await ctx.close();
  });

  await step("owner reviews both pending cards, edits the first draft, publishes, then the second", async () => {
    const { ctx, page } = await newPage(browser, "owner-project", desktopOpts);
    await page.goto(`${base}/a/${OWNER}/p-mehta`);
    await page.waitForSelector('[data-testid="approval-card"]');
    assert.equal(await page.locator('[data-testid="approval-card"]').count(), 2);
    assert.equal(await page.locator('[data-testid="rewrite-ai"]').count(), 0, "no AI button without a key");
    assert.equal(await page.locator('[data-testid="feed-picker"]').count(), 0, "no feed picker: Mehta has not given feed consent");
    await assertImagesLoaded(page, "owner project (pending photos)");
    await textareasNotCut(page, "owner drafts");

    const cardWithNote = page.locator('[data-testid="approval-card"]', { hasText: "MARKER-7731" });
    assert.equal(await cardWithNote.count(), 1);
    assert.match((await cardWithNote.locator('[data-testid="reported"]').textContent()) ?? "", /Civil & demolition: Working · 75%/);
    assert.equal(await cardWithNote.locator('[data-testid="photo-thumb"]').count(), 1);
    assert.match((await cardWithNote.locator('[data-testid="location-proof"]').textContent()) ?? "", /28\.4595, 77\.0266/);
    const drafted = await cardWithNote.locator('[data-testid="client-message"]').inputValue();
    assert.match(drafted, /^Hi Rohan,\nToday at site:\n• Civil & demolition in progress \(75% done\)/);
    assert.match(drafted, /Expected handover: \w{3} \d+ \w{3} \(\d+ days? later than planned\)$/);
    await page.screenshot({ path: path.join(SHOTS, `${backend}-desktop-owner-project-pending.png`), fullPage: true });

    const second = page.locator('[data-testid="approval-card"]').nth(1);
    const secondDraft = await second.locator('[data-testid="client-message"]').inputValue();
    await second.locator('[data-testid="client-message"]').fill("junk");
    await second.locator('[data-testid="reset-draft"]').click();
    assert.equal(await second.locator('[data-testid="client-message"]').inputValue(), secondDraft, "reset restores the draft");

    const first = page.locator('[data-testid="approval-card"]').first();
    const firstText = await first.locator('[data-testid="client-message"]').inputValue();
    await first.locator('[data-testid="client-message"]').fill(firstText + "\nThanks for your patience, Rohan.");
    await first.locator('[data-testid="approve"]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="approval-card"]').length === 1, null, { timeout: 15_000 });
    await page.locator('[data-testid="approval-card"]').first().locator('[data-testid="approve"]').click();
    await page.waitForSelector('[data-testid="queue-empty"]', { timeout: 15_000 });
    assert.equal(await page.locator('[data-testid="published-item"]').count(), 4, "2 seeded + 2 just published");
    assert.match((await page.textContent('[data-testid="published-feed"]')) ?? "", /Thanks for your patience, Rohan\./);
    assert.equal((await page.textContent('[data-testid="kpi-pending"] .v'))?.trim(), "0");
    await assertNoHScroll(page, "owner project");
    await ctx.close();
  });

  await step("double publish is blocked (409) and the stored message is unchanged", async () => {
    const before = (await backing.checkins()).find((c) => c.id === newCheckinId)!.clientMessage;
    const r = await fetch(`${base}/api/checkins/${newCheckinId}/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: OWNER, message: "Overwrite!" }) });
    assert.equal(r.status, 409);
    assert.equal((await backing.checkins()).find((c) => c.id === newCheckinId)!.clientMessage, before);
  });

  console.log("\nClient on a phone");
  await step("client sees both updates; photo viewer opens and closes; no broken images", async () => {
    const { ctx, page } = await newPage(browser, "client-after", phoneOpts());
    await page.goto(`${base}/c/${CLIENT("mehta")}`);
    await page.waitForSelector('[data-testid="client-page"]');
    assert.equal(await page.locator('[data-testid="update"]').count(), 4);
    assert.match((await page.textContent('[data-testid="updates"]')) ?? "", /Thanks for your patience, Rohan\./);
    assert.match((await page.textContent('[data-testid="updates"]')) ?? "", /Civil & demolition in progress \(75% done\)/);
    await assertImagesLoaded(page, "client page");
    await assertNoHScroll(page, "client page");
    const thumb = page.locator('[data-testid="updates"] [data-testid="photo-thumb"]').first();
    await thumb.scrollIntoViewIfNeeded();
    await thumb.click();
    await page.waitForSelector('[data-testid="photo-viewer"]');
    assert.ok((await page.$eval('[data-testid="photo-viewer-img"]', (i) => (i as HTMLImageElement).naturalWidth)) > 0, "viewer image loaded");
    await page.screenshot({ path: path.join(SHOTS, `${backend}-phone-client-viewer.png`) });
    await page.click('[data-testid="photo-viewer-close"]');
    assert.equal(await page.locator('[data-testid="photo-viewer"]').count(), 0, "closed with the button");
    await thumb.click();
    await page.keyboard.press("Escape");
    assert.equal(await page.locator('[data-testid="photo-viewer"]').count(), 0, "closed with Escape");
    await ctx.close();
  });

  await step("client HTML leaks no other client, address, GPS, supervisor, raw reason, note or token", async () => {
    const people: Record<string, string[]> = {
      sharma: ["Sharma", "Priya", "p-sharma", "Palm Residency", "Sector 56"],
      mehta: ["Mehta", "Rohan", "p-mehta", "Greenview", "Golf Course"],
      verma: ["Verma", "Anita", "p-verma", "Lotus", "Sector 82"],
      kapoor: ["Kapoor", "Neha", "p-kapoor", "Orchid", "Sector 49"],
    };
    const everyone = ["Gurgaon", "Ravi", "Kumar", "MARKER-7731", "tile ka kaam", "Material not arrived", "supplier ne late", "Supplier ne", "Wardrobe shutters", "28.4595", "77.0266", "28.42", '"lat"', '"lng"', "accuracy", "GPS-SECRET", OWNER, SUP];
    for (const slug of Object.keys(people)) {
      const page = await (await browser.newContext()).newPage();
      await page.goto(`${base}/c/${CLIENT(slug)}`);
      await page.waitForSelector('[data-testid="client-page"]');
      const dom = await page.content();
      const text = await page.innerText("body");
      const raw = await (await page.request.get(`${base}/c/${CLIENT(slug)}`)).text(); // includes the RSC payload (feed data included)
      const others = Object.entries(people).filter(([k]) => k !== slug);
      const forbidden = [...everyone, ...others.flatMap(([k, v]) => [...v, CLIENT(k)])];
      for (const bad of forbidden) {
        assert.ok(!dom.includes(bad), `${slug}: DOM leaks "${bad}"`);
        assert.ok(!raw.includes(bad), `${slug}: HTML/payload leaks "${bad}"`);
      }
      assert.ok(await page.locator('[data-testid="feed-post"]').count() > 0 || slug === "x", `${slug}: feed shows other sites`);
      if (slug === "sharma") {
        assert.match(text, /On hold: waiting for material to be delivered/);
        assert.match(text, /\d+ days behind the original plan/);
      }
      await page.context().close();
    }
  });

  console.log("\nTokens, roles and API rules");
  await step("wrong, foreign and cross-role tokens are rejected everywhere", async () => {
    const codes: [string, number][] = [
      ["/s/nope", 404], ["/a/nope", 404], ["/c/nope", 404],
      [`/a/${SUP}`, 404], [`/a/${CLIENT("sharma")}`, 404], [`/c/${OWNER}`, 404], [`/c/${SUP}`, 404],
      [`/s/${OWNER}`, 404], [`/s/${CLIENT("sharma")}`, 404], [`/s/${SUP}/p-nope`, 404], [`/a/${OWNER}/p-nope`, 404],
      [`/a/${CLIENT("sharma")}/p-sharma`, 404], [`/a/${CLIENT("sharma")}/new`, 404], [`/a/${SUP}/new`, 404], [`/c/${CLIENT("sharma")}/extra`, 404],
      [`/a/${OWNER}/new`, 200],
    ];
    for (const [url, want] of codes) {
      const r = await fetch(base + url);
      assert.equal(r.status, want, `${url} -> ${r.status}`);
      if (want === 404) assert.ok(!(await r.text()).includes("Sharma"), `${url} leaked data`);
    }
    const fd = (token: string | null) => { const f = new FormData(); if (token) f.set("token", token); f.set("projectId", "p-verma"); f.set("updates", "[]"); f.set("note", "x"); return f; };
    assert.equal((await fetch(`${base}/api/checkins`, { method: "POST", body: fd(null) })).status, 401);
    assert.equal((await fetch(`${base}/api/checkins`, { method: "POST", body: fd("garbage") })).status, 401);
    assert.equal((await fetch(`${base}/api/checkins`, { method: "POST", body: fd(CLIENT("verma")) })).status, 403);
    assert.equal((await fetch(`${base}/api/checkins`, { method: "POST", body: fd(OWNER) })).status, 403);
    const jsonPost = (url: string, token: string | undefined, body: object, method = "POST") => fetch(base + url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify({ token, ...body }) });
    for (const [url, method, body] of [["/api/projects", "POST", { name: "X Y", clientName: "X Y", address: "x", startDate: today, newSupervisorName: "ab" }], ["/api/supervisors", "POST", { name: "Ab" }], ["/api/projects/p-verma", "PATCH", { showcase: true }], [`/api/projects/p-verma/amc`, "PUT", { amc: null }], ["/api/projects/p-verma/amc/visits", "POST", { date: today, note: "abc" }]] as const) {
      assert.equal((await jsonPost(url, undefined, body, method)).status, 401, `${url} without token`);
      assert.equal((await jsonPost(url, SUP, body, method)).status, 403, `${url} as supervisor`);
      assert.equal((await jsonPost(url, CLIENT("verma"), body, method)).status, 403, `${url} as client`);
    }
    assert.equal((await jsonPost("/api/interests", OWNER, { showcaseId: "x" })).status, 403);
    assert.equal((await jsonPost("/api/interests", SUP, { showcaseId: "x" })).status, 403);
    assert.equal((await jsonPost("/api/interests", undefined, { showcaseId: "x" })).status, 401);
    const approve = (token: string) => jsonPost(`/api/checkins/${newCheckinId}/approve`, token, { message: "hi" });
    assert.equal((await approve(SUP)).status, 403);
    assert.equal((await approve(CLIENT("mehta"))).status, 403);
    assert.equal((await approve("garbage")).status, 401);
    const sharmaPhoto = (await backing.checkins()).find((c) => c.projectId === "p-sharma" && c.review === "pending")!.photos[0].fileName;
    assert.equal((await fetch(`${base}/api/photos/p-sharma/${sharmaPhoto}?t=${CLIENT("sharma")}`)).status, 404, "Sharma's still-pending photo is hidden from its own client");
    assert.equal((await fetch(`${base}/api/photos/p-sharma/${sharmaPhoto}?t=${CLIENT("mehta")}`)).status, 404, "foreign client token");
  });

  await step("AI route is 501 without a key (owner), 401/403 otherwise; health is ok", async () => {
    const post = (token?: string) => fetch(`${base}/api/drafts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, checkinId: newCheckinId }) });
    assert.equal((await post(OWNER)).status, 501);
    assert.equal((await post()).status, 401);
    assert.equal((await post(SUP)).status, 403);
    const h = await fetch(`${base}/api/health`);
    assert.equal(h.status, 200);
    assert.deepEqual(await h.json(), { ok: true });
  });

  console.log("\nOwner runs the studio from the UI");
  let newClientToken = "", newSupToken = "", newProjectId = "";
  await step("owner creates a supervisor and a project in the browser; both links work and are scoped", async () => {
    const { ctx, page } = await newPage(browser, "owner-create", phoneOpts());
    await page.goto(`${base}/a/${OWNER}`);
    await page.click('[data-testid="new-project"]');
    await page.waitForSelector('[data-testid="new-project-form"]');
    await assertNoHScroll(page, "new project form");
    await assertTapTargets(page, "new project form", "button:visible, .btn:visible, input:not([type=file]):not([type=radio]):not([type=checkbox]):visible");
    const rows = await page.$$eval("label.radio", (els) => els.map((e) => Math.round(e.getBoundingClientRect().height)).filter((h) => h < 44));
    assert.deepEqual(rows, [], "radio/checkbox rows are at least 44px tall");
    await page.fill('[data-testid="np-name"]', "Rao 3BHK");
    await page.fill('[data-testid="np-client"]', "Asha Rao");
    await page.fill('[data-testid="np-address"]', "12 Lake Road, Secret Colony");
    await page.fill("#np-type", "3BHK");
    await page.fill("#np-style", "Boho");
    await page.check('[data-testid="np-sup-new"]');
    await page.fill('[data-testid="np-sup-name"]', "Salim");
    await page.click('[data-testid="np-submit"]');
    await page.waitForSelector('[data-testid="project-created"]', { timeout: 15_000 });
    newClientToken = (await page.inputValue('[data-testid="created-client-link"]')).split("/c/")[1];
    newSupToken = (await page.inputValue('[data-testid="created-supervisor-link"]')).split("/s/")[1];
    assert.ok(newClientToken.length >= 20 && newSupToken.length >= 20, "long random tokens");
    newProjectId = (await page.getAttribute('[data-testid="open-new-project"]', "href"))!.split("/").pop()!;
    await ctx.close();

    const c = await fetch(`${base}/c/${newClientToken}`);
    assert.equal(c.status, 200);
    assert.ok((await c.text()).includes("Rao 3BHK"));
    assert.equal((await fetch(`${base}/s/${newSupToken}`)).status, 200);
    assert.equal((await fetch(`${base}/s/${newSupToken}/${newProjectId}`)).status, 200);
    assert.equal((await fetch(`${base}/s/${newSupToken}/p-mehta`)).status, 404, "the new supervisor cannot open another site");
    assert.equal((await fetch(`${base}/c/${newClientToken}`, { headers: {} })).status, 200);
    const sup = await (await fetch(`${base}/s/${newSupToken}`)).text();
    assert.ok(sup.includes("Rao 3BHK") && !sup.includes("Mehta"), "supervisor list shows only their own site");
    const noAmc = await (await fetch(`${base}/c/${newClientToken}`)).text();
    assert.ok(!noAmc.includes('data-testid="amc-card"'), "no AMC card without an AMC");
    // the owner dashboard now lists the project and its supervisor
    const dash = await (await fetch(`${base}/a/${OWNER}`)).text();
    assert.ok(dash.includes("Rao 3BHK") && dash.includes("Salim"));
  });

  await step("a brand-new supervisor can post a check-in on their new site", async () => {
    const { ctx, page } = await newPage(browser, "new-sup", phoneOpts());
    await page.goto(`${base}/s/${newSupToken}/${newProjectId}`);
    await page.waitForSelector('[data-testid="checkin-form"]');
    await page.click('[data-testid="state-civil-working"]');
    await page.click('[data-testid="pct-civil-25"]');
    await page.click('[data-testid="send"]');
    await page.waitForSelector('[data-testid="sent-ok"]', { timeout: 20_000 });
    await ctx.close();
    assert.equal((await backing.checkins()).filter((c) => c.projectId === newProjectId && c.review === "pending").length, 1);
  });

  console.log("\nInspiration feed: consent, selection, interest");
  await step("owner publishes Sharma's update choosing which photos go on the feed; another client sees exactly those", async () => {
    const { ctx, page } = await newPage(browser, "owner-feed", desktopOpts);
    await page.goto(`${base}/a/${OWNER}/p-sharma`);
    const card = page.locator('[data-testid="approval-card"]').first();
    await card.waitFor();
    const picks = card.locator('[data-testid="feed-picker"] input[type=checkbox]');
    assert.equal(await picks.count(), 3, "all three photos offered");
    for (let i = 0; i < 3; i++) assert.ok(await picks.nth(i).isChecked(), "selected by default when the project has consent");
    await picks.nth(1).uncheck();
    await card.locator('[data-testid^="appr-"][data-testid$="-caption"]').fill("Fresh from site: the ceiling cove");
    await assertImagesLoaded(page, "owner project with picker");
    await card.locator('[data-testid="approve"]').click();
    await page.waitForSelector('[data-testid="queue-empty"]', { timeout: 15_000 });
    await ctx.close();

    const c = (await backing.checkins()).find((x) => x.projectId === "p-sharma" && x.showcaseCaption === "Fresh from site: the ceiling cove")!;
    assert.ok(c, "caption stored");
    assert.equal(c.showcase!.length, 2);
    assert.ok(!c.showcase!.some((s) => s.fileName === c.photos[1].fileName), "the unticked photo is not shared");
    for (const s of c.showcase!) {
      assert.equal((await fetch(`${base}/api/feed/${s.id}?t=${CLIENT("mehta")}`)).status, 200, "other client can load a selected photo");
      assert.equal((await fetch(`${base}/api/feed/${s.id}?t=${SUP}`)).status, 404, "supervisors never see the client feed route");
      assert.equal((await fetch(`${base}/api/feed/${s.id}`)).status, 404);
    }
    assert.equal((await fetch(`${base}/api/photos/p-sharma/${c.photos[1].fileName}?t=${CLIENT("mehta")}`)).status, 404, "unselected photo is not reachable by another client");
    assert.equal((await fetch(`${base}/api/photos/p-sharma/${c.showcase![0].fileName}?t=${CLIENT("mehta")}`)).status, 404, "the raw photo route stays private to its own client");
  });

  await step("client sees other sites only, anonymised, six at a time; interest is recorded and reaches the owner", async () => {
    const { ctx, page } = await newPage(browser, "client-feed", phoneOpts());
    await page.goto(`${base}/c/${CLIENT("mehta")}`);
    await page.waitForSelector('[data-testid="inspiration"]');
    assert.ok(await page.isVisible('[data-testid="nav-inspiration"]'));
    assert.equal(await page.locator('[data-testid="feed-post"]').count(), 6);
    await page.click('[data-testid="feed-more"]');
    assert.equal(await page.locator('[data-testid="feed-post"]').count(), 12);
    await page.click('[data-testid="feed-more"]');
    assert.equal(await page.locator('[data-testid="feed-post"]').count(), 15, "5 per site x 3 consenting sites");
    assert.equal(await page.locator('[data-testid="feed-more"]').count(), 0, "no more button once everything is shown");
    const labels = new Set(await page.locator('[data-testid="feed-label"]').allTextContents());
    assert.deepEqual([...labels].sort(), ["2BHK · Modern minimal", "3BHK · Classic warm", "3BHK · Contemporary"], "other sites only, labelled by home type and style");
    assert.ok(![...labels].some((l) => /Scandinavian/.test(l)), "never the client's own home");
    const first = page.locator('[data-testid="feed-post"]').first();
    assert.match((await first.textContent()) ?? "", /Fresh from site: the ceiling cove/, "newest post first, with the owner's caption");
    assert.equal(await first.locator('[data-testid="photo-thumb"]').count(), 2);
    await assertImagesLoaded(page, "client feed");
    await first.locator('[data-testid="photo-thumb"]').first().click();
    await page.waitForSelector('[data-testid="photo-viewer"]');
    assert.ok((await page.$eval('[data-testid="photo-viewer-img"]', (i) => (i as HTMLImageElement).naturalWidth)) > 0);
    await page.click('[data-testid="photo-viewer-close"]');
    await first.locator('[data-testid="interest-btn"]').click();
    await first.locator('[data-testid="interest-sent"]').waitFor();
    await page.reload();
    await page.waitForSelector('[data-testid="inspiration"]');
    assert.ok(await page.locator('[data-testid="feed-post"]').first().locator('[data-testid="interest-sent"]').isVisible(), "still marked as sent after reload");
    await page.screenshot({ path: path.join(SHOTS, `${backend}-phone-client-feed.png`), fullPage: true });
    await ctx.close();

    const own = await page.context().browser()!.newContext({ viewport: DESKTOP }).then((c) => c.newPage());
    await own.goto(`${base}/a/${OWNER}`);
    const row = own.locator('[data-testid="interest-row"]').first();
    await row.waitFor();
    assert.match((await row.textContent()) ?? "", /Rohan Mehta \(Mehta 2BHK\) liked 3BHK · Contemporary/);
    assert.ok(await row.locator("img").evaluate((i) => (i as HTMLImageElement).naturalWidth > 0), "owner sees which photo was liked");
    await own.context().close();
  });

  await step("feed consent lifecycle: no consent -> nothing; consent + selection -> visible; withdrawn -> gone at once", async () => {
    const watcher = await newPage(browser, "kapoor-client", phoneOpts());
    const kapoorFeed = async () => { await watcher.page.goto(`${base}/c/${CLIENT("kapoor")}`); await watcher.page.waitForSelector('[data-testid="client-page"]'); return (await watcher.page.locator('[data-testid="feed-label"]').allTextContents()); };
    assert.ok(!(await kapoorFeed()).some((l) => /Scandinavian/.test(l)), "Mehta has no consent: not on the feed");

    const { ctx, page } = await newPage(browser, "owner-consent", desktopOpts);
    await page.goto(`${base}/a/${OWNER}/p-mehta`);
    await page.check('[data-testid="set-showcase"]');
    await page.click('[data-testid="set-save"]');
    await page.getByText("Saved ✓").waitFor();
    assert.ok(!(await kapoorFeed()).some((l) => /Scandinavian/.test(l)), "consent alone shows nothing: the owner must pick photos");

    await page.reload();
    const editor = page.locator('[data-testid="published-feed-editor"]').first();
    await editor.locator("summary").click();
    await editor.locator('input[type=checkbox]').first().check();
    await editor.locator('[data-testid="feed-save"]').click();
    await editor.getByText(/on the feed ✓/).waitFor();
    const withMehta = await kapoorFeed();
    assert.ok(withMehta.some((l) => /2BHK · Scandinavian/.test(l)), "selected photo appears for other clients");
    const mehtaPhoto = (await backing.checkins()).flatMap((c) => c.showcase ?? []).find((s) => (s.fileName ?? "").includes("-1."))!;
    assert.ok(mehtaPhoto, "selection stored");

    await page.reload();
    await page.uncheck('[data-testid="set-showcase"]');
    await page.click('[data-testid="set-save"]');
    await page.getByText("Saved ✓").waitFor();
    assert.ok(!(await kapoorFeed()).some((l) => /Scandinavian/.test(l)), "withdrawn consent removes it immediately");
    const cs = (await backing.checkins()).filter((c) => c.projectId === "p-mehta").flatMap((c) => c.showcase ?? []);
    for (const s of cs) assert.equal((await fetch(`${base}/api/feed/${s.id}?t=${CLIENT("kapoor")}`)).status, 404, "its photos stop being served too");
    await ctx.close();
    await watcher.ctx.close();
  });

  console.log("\nAMC");
  await step("AMC: starts at handover, becomes active, logs visits, turns 'expiring' with a renew button, and only shows when bought", async () => {
    const mehta = await newPage(browser, "mehta-amc", phoneOpts());
    await mehta.page.goto(`${base}/c/${CLIENT("mehta")}`);
    await mehta.page.waitForSelector('[data-testid="amc-card"]');
    assert.match((await mehta.page.textContent('[data-testid="amc-status"]')) ?? "", /Starts after handover/);
    assert.match((await mehta.page.textContent('[data-testid="amc-starts"]')) ?? "", /begins once the work is handed over \(expected from \d+ \w{3} \d{4}\)/);
    assert.equal(await mehta.page.locator('[data-testid="amc-renew"]').count(), 0);

    const { ctx, page } = await newPage(browser, "owner-amc", desktopOpts);
    const setAmc = async (startDate: string, months: number, visits: number) => {
      await page.goto(`${base}/a/${OWNER}/p-mehta`);
      await page.click('[data-testid="amc-edit"]');
      await page.check('[data-testid="amc-start-date"]');
      await page.fill('[data-testid="amc-start-input"]', startDate);
      await page.fill('[data-testid="amc-months"]', String(months));
      await page.fill('[data-testid="amc-visits-input"]', String(visits));
      await page.click('[data-testid="amc-save"]');
      await page.getByText("AMC saved ✓").waitFor();
    };
    await setAmc(addDays(today, -60), 6, 2);
    await mehta.page.reload();
    assert.match((await mehta.page.textContent('[data-testid="amc-status"]')) ?? "", /Active/);
    assert.match((await mehta.page.textContent('[data-testid="amc-validity"]')) ?? "", /Valid \d+ \w{3} \d{4} to \d+ \w{3} \d{4} · \d+ days left/);
    assert.match((await mehta.page.textContent('[data-testid="amc-visits"]')) ?? "", /0 of 2 used/);
    assert.match((await mehta.page.textContent('[data-testid="amc-card"]')) ?? "", /Next visit due: \w{3} \d+ \w{3}/);

    await page.fill('[data-testid="visit-date"]', today);
    await page.fill('[data-testid="visit-note"]', "Aligned two doors and checked the geyser");
    await page.click('[data-testid="visit-add"]');
    await page.getByText(/Visit logged/).waitFor();
    await mehta.page.reload();
    assert.match((await mehta.page.textContent('[data-testid="amc-visits"]')) ?? "", /1 of 2 used/);
    assert.match((await mehta.page.textContent('[data-testid="amc-card"]')) ?? "", /Aligned two doors and checked the geyser/);
    assert.equal(await mehta.page.locator('[data-testid="amc-visit"]').count(), 1);

    await setAmc(addDays(today, -170), 6, 2); // ends in about 10 days -> expiring; the logged visit is kept
    await mehta.page.reload();
    assert.match((await mehta.page.textContent('[data-testid="amc-status"]')) ?? "", /Expiring soon/);
    const renew = await mehta.page.getAttribute('[data-testid="amc-renew"]', "href");
    assert.match(renew ?? "", /^https:\/\/wa\.me\/\?text=.*renew/i);
    assert.equal(await mehta.page.locator('[data-testid="amc-visit"]').count(), 1, "visit history survives editing the AMC");
    assert.match((await page.textContent('[data-testid="owner-amc-status"]')) ?? "", /Expiring soon/);

    await setAmc(addDays(today, -400), 12, 4); // long over -> expired
    await mehta.page.reload();
    assert.match((await mehta.page.textContent('[data-testid="amc-status"]')) ?? "", /Expired/);
    await mehta.page.locator('[data-testid="amc-renew"]').waitFor({ state: "visible" }); // streamed content is swapped into view after load
    assert.equal(await mehta.page.locator('[data-testid="amc-next"]').count(), 0, "no next visit once expired");

    await page.click('[data-testid="amc-edit"]');
    await page.click('[data-testid="amc-remove"]');
    await page.click('[data-testid="amc-remove"]'); // second tap confirms
    await page.getByText(/has not bought an AMC/).waitFor();
    await mehta.page.reload();
    assert.equal(await mehta.page.locator('[data-testid="amc-card"]').count(), 0, "AMC card disappears when the AMC is removed");
    assert.equal(await mehta.page.locator('[data-testid="nav-amc"]').count(), 0);
    await ctx.close();
    await mehta.ctx.close();

    const k = await newPage(browser, "kapoor-amc", phoneOpts());
    await k.page.goto(`${base}/c/${CLIENT("kapoor")}`);
    await k.page.waitForSelector('[data-testid="amc-card"]');
    assert.match((await k.page.textContent('[data-testid="amc-status"]')) ?? "", /Active/);
    assert.match((await k.page.textContent('[data-testid="amc-visits"]')) ?? "", /1 of 4 used/);
    assert.match((await k.page.textContent('[data-testid="amc-card"]')) ?? "", /Checked all fittings/);
    assert.match((await k.page.textContent('[data-testid="amc-card"]')) ?? "", /Carpentry and hinge adjustments/);
    assert.equal(await k.page.locator('[data-testid="amc-renew"]').count(), 0, "no renewal prompt while comfortably active");
    await k.page.click('[data-testid="nav-amc"]');
    await assertNoHScroll(k.page, "client with AMC");
    await k.page.screenshot({ path: path.join(SHOTS, `${backend}-phone-client-kapoor.png`), fullPage: true });
    await k.ctx.close();
  });

  console.log("\nFinished homes gallery");
  await step("finished homes: other clients' completed homes with the AMC tag, social proof and interest", async () => {
    const mehta = await newPage(browser, "finished-mehta", phoneOpts());
    await mehta.page.goto(`${base}/c/${CLIENT("mehta")}`);
    await mehta.page.waitForSelector('[data-testid="finished-homes"]');
    const homes = mehta.page.locator('[data-testid="finished-home"]');
    assert.equal(await homes.count(), 1, "only Kapoor is finished (and it is not Mehta's own)");
    assert.equal((await homes.first().locator('[data-testid="finished-label"]').textContent())?.trim(), "3BHK · Classic warm");
    assert.match((await homes.first().textContent()) ?? "", /Finished · \d+ \w{3} \d{4}/);
    assert.match((await homes.first().locator('[data-testid="amc-badge"]').textContent()) ?? "", /Has an AMC · Gold AMC · Active/, "the home bought an AMC");
    assert.ok((await homes.first().locator('[data-testid="photo-thumb"]').count()) >= 3, "final-result photos");
    await assertImagesLoaded(mehta.page, "finished homes");
    await mehta.page.screenshot({ path: path.join(SHOTS, `${backend}-phone-client-finished.png`), fullPage: true });

    // The AMC tag is on the work-in-progress posts too, both ways.
    const posts = mehta.page.locator('[data-testid="in-progress-feed"] [data-testid="feed-post"]');
    const n = await posts.count();
    assert.ok(n > 0);
    for (let i = 0; i < n; i++) {
      const label = (await posts.nth(i).locator('[data-testid="feed-label"]').textContent()) ?? "";
      const badge = (await posts.nth(i).locator('[data-testid="amc-badge"]').textContent()) ?? "";
      if (/Classic warm/.test(label)) assert.match(badge, /Has an AMC/); else assert.match(badge, /^No AMC$/);
    }

    // Interest on a finished home reaches the owner, and other clients see only a count.
    assert.equal(await homes.first().locator('[data-testid="finished-wants"]').count(), 0, "nobody has asked yet");
    await homes.first().locator('[data-testid="interest-btn"]').click();
    await homes.first().locator('[data-testid="interest-sent"]').waitFor();
    await mehta.page.reload();
    await mehta.page.waitForSelector('[data-testid="finished-homes"]');
    assert.match((await mehta.page.textContent('[data-testid="finished-wants"]')) ?? "", /^1 client has asked for a similar design$/);
    await mehta.ctx.close();

    const verma = await newPage(browser, "finished-verma", phoneOpts());
    await verma.page.goto(`${base}/c/${CLIENT("verma")}`);
    await verma.page.waitForSelector('[data-testid="finished-homes"]');
    const vText = (await verma.page.locator('[data-testid="finished-home"]').first().textContent()) ?? "";
    assert.match(vText, /1 client has asked for a similar design/, "social proof is visible to others");
    assert.ok(!/Mehta|Rohan/.test(vText), "never who");
    await verma.ctx.close();

    const own = await newPage(browser, "finished-own", phoneOpts());
    await own.page.goto(`${base}/c/${CLIENT("kapoor")}`);
    await own.page.waitForSelector('[data-testid="client-page"]');
    assert.equal(await own.page.locator('[data-testid="finished-home"]').count(), 0, "a client never sees their own home in the gallery");
    await own.ctx.close();

    const ownerPage = await newPage(browser, "finished-owner", desktopOpts);
    await ownerPage.page.goto(`${base}/a/${OWNER}`);
    await ownerPage.page.locator('[data-testid="interest-row"]').first().waitFor();
    assert.ok((await ownerPage.page.locator('[data-testid="interest-row"]').allTextContents()).some((t) => /Rohan Mehta \(Mehta 2BHK\) liked 3BHK · Classic warm/.test(t)), "owner sees the lead");
    await ownerPage.ctx.close();

    // Without an AMC the tag says so.
    const del = await fetch(`${base}/api/projects/p-kapoor/amc`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: OWNER, amc: null }) });
    assert.equal(del.status, 200);
    const again = await newPage(browser, "finished-noamc", phoneOpts());
    await again.page.goto(`${base}/c/${CLIENT("mehta")}`);
    await again.page.waitForSelector('[data-testid="finished-homes"]');
    assert.equal((await again.page.locator('[data-testid="finished-home"] [data-testid="amc-badge"]').first().textContent())?.trim(), "No AMC");
    await again.ctx.close();
  });

  console.log("\nPhotos stay under the host's request limit");
  await step("eight big photos are shrunk to fit one request under 4.5 MB, and all are stored", async () => {
    const noisy = await Promise.all([0, 1, 2, 3, 4, 5].map(() => makeNoisyJpeg(browser, 2000, 1333)));
    assert.ok(noisy.reduce((n, b) => n + b.length, 0) > 8_000_000, "test photos are big");
    const { ctx, page } = await newPage(browser, "budget", phoneOpts());
    const sizes: number[] = [];
    page.on("request", (r) => { if (r.method() === "POST" && r.url().endsWith("/api/checkins")) sizes.push(r.postDataBuffer()?.length ?? 0); });
    await page.goto(`${base}/s/${SUP}/p-verma`);
    await page.waitForSelector('[data-testid="checkin-form"]');
    await page.click('[data-testid="pct-carpentry-90"]');
    for (const [i, b] of noisy.entries()) await page.setInputFiles('[data-testid="photo-input-carpentry"]', { name: `big${i}.jpg`, mimeType: "image/jpeg", buffer: b });
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="photo-thumb-form"] img').length === n, noisy.length, { timeout: 60_000 });
    await page.click('[data-testid="send"]');
    await page.waitForSelector('[data-testid="sent-ok"]', { timeout: 90_000 });
    await ctx.close();
    assert.equal(sizes.length, 1, "one request");
    assert.ok(sizes[0] <= 4.4 * 1024 * 1024, `request body ${(sizes[0] / 1048576).toFixed(2)} MB must stay under the 4.5 MB host limit`);
    const mine = (await backing.checkins()).filter((c) => c.projectId === "p-verma" && c.photos.length === 6);
    assert.equal(mine.length, 1);
    let total = 0;
    for (const p of mine[0].photos) { const bytes = (await backing.photo("p-verma", p.fileName))!; total += bytes.length; assert.ok(Math.max(jpegSize(bytes).w, jpegSize(bytes).h) <= 1600); }
    assert.ok(total <= 3_600_000, `stored photos ${total} bytes within the budget`);
  });

  console.log("\nOld Android WebView (no createImageBitmap, geolocation, clipboard, toBlob)");
  await step("supervisor flow works with every modern API missing", async () => {
    const init = () => {
      (window as unknown as { createImageBitmap: unknown }).createImageBitmap = undefined;
      (HTMLCanvasElement.prototype as unknown as { toBlob: unknown }).toBlob = undefined;
      Object.defineProperty(navigator, "geolocation", { value: undefined, configurable: true });
      Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    };
    const ua = "Mozilla/5.0 (Linux; Android 8.1.0; SM-J200G Build/LMY47X; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/70.0.3538.80 Mobile Safari/537.36";
    const { ctx, page } = await newPage(browser, "webview", phoneOpts({ viewport: { width: 360, height: 640 }, userAgent: ua }));
    await ctx.addInitScript(init);
    await page.goto(`${base}/s/${SUP}/p-kapoor`);
    await page.waitForSelector('[data-testid="checkin-form"]');
    assert.equal(await page.evaluate(() => typeof createImageBitmap), "undefined");
    assert.equal(await page.evaluate(() => typeof HTMLCanvasElement.prototype.toBlob), "undefined");
    await assertNoHScroll(page, "webview form");
    await page.click('[data-testid="state-handover-working"]');
    await page.click('[data-testid="pct-handover-50"]');
    await page.setInputFiles('[data-testid="photo-input-handover"]', { name: "site.jpg", mimeType: "image/jpeg", buffer: exifJpeg });
    await page.waitForSelector('[data-testid="photo-thumb-form"] img', { timeout: 20_000 });
    await page.click('[data-testid="send"]');
    await page.waitForSelector('[data-testid="sent-ok"]', { timeout: 20_000 });
    await ctx.close();
    const mine = (await backing.checkins()).filter((c) => c.projectId === "p-kapoor" && c.review === "pending");
    assert.equal(mine.length, 1);
    assert.equal(mine[0].location, null, "no geolocation API -> location is null, send still works");
    // The supervisor just reopened Kapoor's final stage (a snag fix). That must not rewrite the AMC anchored to handover.
    const ownerView = await (await fetch(`${base}/a/${OWNER}/p-kapoor`)).text();
    assert.ok(!/Starts after handover/.test(ownerView), "reopening a stage does not move the AMC start");
    const bytes = (await backing.photo("p-kapoor", mine[0].photos[0].fileName))!;
    assert.ok(!jpegHasMetadata(bytes) && !bytes.toString("latin1").includes("GPS-SECRET"));
    assert.ok(Math.max(jpegSize(bytes).w, jpegSize(bytes).h) <= 1600);
  });

  await step("offline: send fails with a clear error, the update is kept on the phone, and recovers with no duplicate", async () => {
    const MARK = "OFFLINE-4482 pani aa gaya";
    const { ctx, page } = await newPage(browser, "offline", phoneOpts({ geolocation: GEO, permissions: ["geolocation"] }));
    await page.goto(`${base}/s/${SUP}/p-mehta`);
    await page.waitForSelector('[data-testid="checkin-form"]');
    await page.click('[data-testid="pct-civil-90"]');
    await page.fill('[data-testid="note"]', MARK);
    await ctx.setOffline(true);
    await page.click('[data-testid="send"]');
    await page.waitForSelector('[data-testid="send-error"]', { timeout: 15_000 });
    assert.match((await page.textContent('[data-testid="send-error"]')) ?? "", /saved on this phone/i);
    assert.ok(await page.isVisible('[data-testid="retry"]'), "Retry button is offered");
    assert.equal((await backing.checkins()).filter((c) => c.note === MARK).length, 0, "nothing reached the server");
    await ctx.setOffline(false);
    await page.goto(`${base}/s/${SUP}`);
    await page.waitForSelector('[data-testid="outbox-banner"]');
    assert.match((await page.textContent('[data-testid="outbox-banner"]')) ?? "", /1 update saved on this phone/);
    await page.click('[data-testid="outbox-retry"]');
    await page.waitForSelector('[data-testid="outbox-banner"]', { state: "detached", timeout: 20_000 });
    assert.equal((await backing.checkins()).filter((c) => c.note === MARK).length, 1, "stored exactly once");
    await page.reload();
    assert.equal(await page.locator('[data-testid="outbox-banner"]').count(), 0, "outbox is empty after success");
    await ctx.close();
  });

  await step("owner copy-link falls back to execCommand when navigator.clipboard is missing", async () => {
    const { ctx, page } = await newPage(browser, "owner-noclip", desktopOpts);
    await ctx.addInitScript(() => Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true }));
    await page.goto(`${base}/a/${OWNER}/p-verma`);
    await page.waitForSelector('[data-testid="share-box"]');
    const link = await page.inputValue('[data-testid="client-link"]');
    assert.match(link, new RegExp(`/c/${CLIENT("verma")}$`));
    await page.click('[data-testid="copy-client"]');
    await page.waitForFunction(() => /Copied/.test(document.querySelector('[data-testid="copy-client"]')?.textContent ?? ""), null, { timeout: 5000 });
    const wa = await page.getAttribute('[data-testid="whatsapp"]', "href");
    assert.match(wa ?? "", /^https:\/\/wa\.me\/\?text=/);
    assert.ok(decodeURIComponent(wa ?? "").includes(link));
    await ctx.close();
  });

  if (backend === "json") {
    console.log("\nLayout at real viewports (no horizontal scroll, no broken images, screenshots)");
    const viewsFor = (): [string, string][] => [
      ["hub", "/"], ["sup-list", `/s/${SUP}`], ["sup-checkin", `/s/${SUP}/p-sharma`],
      ["owner-dash", `/a/${OWNER}`], ["owner-new", `/a/${OWNER}/new`], ["owner-project", `/a/${OWNER}/p-sharma`], ["owner-project-kapoor", `/a/${OWNER}/p-kapoor`],
      ["client-sharma", `/c/${CLIENT("sharma")}`], ["client-mehta", `/c/${CLIENT("mehta")}`], ["client-kapoor", `/c/${CLIENT("kapoor")}`],
    ];
    for (const [label, vp, mobile] of [["320", { width: 320, height: 568 }, true], ["phone", PHONE, true], ["tablet", { width: 768, height: 1024 }, false], ["desktop", DESKTOP, false]] as const) {
      await step(`all views at ${label} (${vp.width}px)`, async () => {
        const { ctx, page } = await newPage(browser, `layout-${label}`, { viewport: vp, isMobile: mobile, hasTouch: mobile, geolocation: GEO, permissions: ["geolocation"] });
        for (const [name, url] of viewsFor()) {
          await page.goto(base + url, { waitUntil: "networkidle" });
          await assertNoHScroll(page, `${name} @${vp.width}`);
          await assertImagesLoaded(page, `${name} @${vp.width}`);
          if (name === "sup-checkin") { await assertTapTargets(page, `${name} @${vp.width}`); await textareasNotCut(page, `${name} @${vp.width}`); }
          await page.screenshot({ path: path.join(SHOTS, `${label}-${name}.png`), fullPage: true });
        }
        await ctx.close();
      });
    }

    await step("a real deployment config: demo off, OWNER_TOKEN required, empty studio, owner can start from nothing", async () => {
      const token = "prod-owner-token-abcdef123456";
      const off = await startServer("json", { DEMO_HUB: "off", OWNER_TOKEN: token, STUDIO_NAME: "Aarav Interiors" });
      try {
        assert.equal((await fetch(off.base + "/")).status, 404, "hub is off");
        assert.equal((await fetch(`${off.base}/a/${OWNER}`)).status, 404, "demo owner token does not exist");
        assert.equal((await fetch(`${off.base}/c/${CLIENT("sharma")}`)).status, 404, "demo client links do not exist");
        const dash = await fetch(`${off.base}/a/${token}`);
        assert.equal(dash.status, 200);
        const text = await dash.text();
        assert.ok(text.includes("Aarav Interiors") && text.includes("No projects yet"));
        assert.equal((await fetch(`${off.base}/api/health`)).status, 200);
        assert.equal((await off.backing.checkins()).length, 0);
      } finally { await off.stop(); }
    });
  }

  await step("data integrity: no temp files, every photo present, nothing orphaned", async () => {
    const all = await backing.checkins();
    assert.ok(all.length >= 29, `${all.length} check-ins`);
    assert.deepEqual(backing.tmpFiles(), []);
    for (const c of all) for (const p of c.photos) assert.ok(await backing.photo(c.projectId, p.fileName), `missing photo ${p.fileName}`);
  });

  await step("no browser errors, no page errors, no 5xx anywhere", async () => {
    assert.deepEqual(problems, []);
  });

  await server.stop();
  return results;
}

async function main() {
  const browser = await chromium.launch();
  const exifJpeg = await makeExifJpeg(browser);
  assert.ok(jpegHasMetadata(exifJpeg), "test image must carry EXIF");
  const all: { backend: Backend; results: typeof results }[] = [];
  for (const backend of (process.env.E2E_BACKENDS ?? "json,pg").split(",") as Backend[]) all.push({ backend, results: await suite(browser, backend, exifJpeg) });
  await browser.close();

  let failed = 0, total = 0;
  for (const { backend, results: r } of all) {
    const bad = r.filter((x) => !x.ok);
    failed += bad.length; total += r.length;
    console.log(`\n[${backend}] ${r.length - bad.length}/${r.length} E2E steps passed`);
    if (bad.length) console.log("FAILED:\n" + bad.map((f) => ` - ${f.name}\n     ${f.err}`).join("\n"));
  }
  console.log(`\n${total - failed}/${total} E2E steps passed across ${all.length} backend(s)`);
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
