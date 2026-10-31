import { describe, expect, it } from "vitest";
import { LIMITS, validateCheckin, validateMessage } from "@/lib/validation";
import { jpegHasMetadata, sniffImage, stripJpeg, stripPng, stripWebp } from "@/lib/photos";
import { project } from "./helpers";

const p = project();
const now = new Date("2026-03-20T06:00:00Z"); // 11:30 IST
const ok = { updates: [{ stageId: "civil", state: "working", percent: 50 }], note: "", photoMeta: [], location: null, fileCount: 0 };
const run = (over: object) => validateCheckin({ ...ok, ...over } as never, p, now);
const errs = (over: object) => { const r = run(over); return r.ok ? [] : r.errors; };

describe("check-in validation", () => {
  it("accepts a normal check-in and stamps the IST date", () => {
    const r = run({});
    expect(r.ok && r.value.date).toBe("2026-03-20");
    expect(r.ok && r.value.updates).toEqual([{ stageId: "civil", state: "working", percent: 50 }]);
  });
  it("uses the IST date near midnight", () => {
    const late = validateCheckin(ok as never, p, new Date("2026-03-20T19:00:00Z")); // 00:30 IST next day
    expect(late.ok && late.value.date).toBe("2026-03-21");
  });
  it("rejects unknown stage ids, bad states, duplicates", () => {
    expect(errs({ updates: [{ stageId: "nope", state: "done" }] })[0]).toMatch(/unknown stage/);
    expect(errs({ updates: [{ stageId: "civil", state: "finished" }] })[0]).toMatch(/invalid state/);
    expect(errs({ updates: [{ stageId: "civil", state: "done" }, { stageId: "civil", state: "working" }] })[0]).toMatch(/twice/);
    expect(errs({ updates: "x" })[0]).toMatch(/list/);
    expect(errs({ updates: [null] })[0]).toMatch(/object/);
  });
  it.each([-1, 101, 50.5, "50", NaN])("rejects percent %s", (percent) => {
    expect(errs({ updates: [{ stageId: "civil", state: "working", percent }] })[0]).toMatch(/percent/);
  });
  it("blocked needs a reason", () => {
    expect(errs({ updates: [{ stageId: "civil", state: "blocked" }] })[0]).toMatch(/reason is required/);
    expect(errs({ updates: [{ stageId: "civil", state: "blocked", blockedReason: "  " }] })[0]).toMatch(/reason is required/);
    expect(errs({ updates: [{ stageId: "civil", state: "blocked", blockedReason: "x".repeat(201) }] })[0]).toMatch(/too long/);
    const r = run({ updates: [{ stageId: "civil", state: "blocked", blockedReason: " Material not arrived " }] });
    expect(r.ok && r.value.updates[0].blockedReason).toBe("Material not arrived");
  });
  it("drops stray reason/percent on states that do not use them", () => {
    const r = run({ updates: [{ stageId: "civil", state: "done", percent: 40, blockedReason: "x" }] });
    expect(r.ok && r.value.updates[0]).toEqual({ stageId: "civil", state: "done" });
  });
  it("limits note length", () => {
    expect(errs({ note: "x".repeat(LIMITS.maxNoteChars + 1) })[0]).toMatch(/note is too long/);
    expect(errs({ note: 5 })[0]).toMatch(/note/);
  });
  it("limits photos to 8 and needs matching metadata", () => {
    expect(errs({ fileCount: 9, photoMeta: Array(9).fill({ stageId: "civil", width: 10, height: 10 }) }).join()).toMatch(/at most 8/);
    expect(errs({ fileCount: 1, photoMeta: [] })[0]).toMatch(/one entry per photo/);
    expect(errs({ fileCount: 1, photoMeta: [{ stageId: "zzz", width: 10, height: 10 }] })[0]).toMatch(/unknown stage/);
    expect(errs({ fileCount: 1, photoMeta: [{ stageId: "civil", width: 0, height: 10 }] })[0]).toMatch(/invalid size/);
    expect(errs({ fileCount: 1, photoMeta: [{ stageId: "civil", width: 99999, height: 10 }] })[0]).toMatch(/invalid size/);
    expect(run({ fileCount: 8, photoMeta: Array(8).fill({ stageId: "civil", width: 1600, height: 900 }) }).ok).toBe(true);
  });
  it("validates location ranges", () => {
    expect(errs({ location: { lat: 91, lng: 0 } })[0]).toMatch(/location/);
    expect(errs({ location: { lat: 0, lng: 181 } })[0]).toMatch(/location/);
    expect(errs({ location: "here" })[0]).toMatch(/location/);
    const r = run({ location: { lat: 28.45, lng: 77.03, accuracy: 12.4 } });
    expect(r.ok && r.value.location).toEqual({ lat: 28.45, lng: 77.03, accuracy: 12 });
  });
  it("rejects an empty check-in but allows note-only or photo-only", () => {
    expect(errs({ updates: [] })[0]).toMatch(/nothing to send/);
    expect(run({ updates: [], note: "Site closed, festival" }).ok).toBe(true);
  });
  it("accepts a queued check-in made up to 72h ago, ignores timestamps from the future", () => {
    const past = run({ submittedAt: "2026-03-19T10:00:00Z" });
    expect(past.ok && past.value.createdAt).toBe("2026-03-19T10:00:00.000Z");
    const ancient = run({ submittedAt: "2026-03-01T10:00:00Z" });
    expect(ancient.ok && ancient.value.createdAt).toBe(now.toISOString());
    const future = run({ submittedAt: "2027-01-01T00:00:00Z" });
    expect(future.ok && future.value.createdAt).toBe(now.toISOString());
  });
  it("checks the client-supplied id format", () => {
    expect(errs({ id: "../../etc" })[0]).toMatch(/id must be/);
    expect(run({ id: "abcd1234-ef" }).ok).toBe(true);
  });
  it("validates owner messages", () => {
    expect(validateMessage("  ")).toMatchObject({ ok: false });
    expect(validateMessage(5)).toMatchObject({ ok: false });
    expect(validateMessage("x".repeat(LIMITS.maxMessageChars + 1))).toMatchObject({ ok: false });
    expect(validateMessage(" hello ")).toEqual({ ok: true, text: "hello" });
  });
});

function jpegWithExif(): Uint8Array {
  const exif = [0xff, 0xe1, 0x00, 0x0e, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x47, 0x50, 0x53, 0x21]; // "Exif..GPS!"
  const jfif = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const sos = [0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 63, 0, 0x12, 0x34, 0xff, 0xd9];
  return Uint8Array.from([0xff, 0xd8, ...jfif, ...exif, ...sos]);
}

describe("photo safety", () => {
  it("sniffs real types from bytes and rejects SVG/others", () => {
    expect(sniffImage(jpegWithExif())).toBe("jpeg");
    expect(sniffImage(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 0]))).toBe("png");
    expect(sniffImage(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("webp");
    expect(sniffImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(sniffImage(new TextEncoder().encode("GIF89a......"))).toBeNull();
    expect(sniffImage(new Uint8Array(0))).toBeNull();
  });
  it("strips EXIF/GPS from JPEG but keeps JFIF and image data", () => {
    const src = jpegWithExif();
    expect(jpegHasMetadata(src)).toBe(true);
    const out = stripJpeg(src);
    expect(jpegHasMetadata(out)).toBe(false);
    expect(Array.from(out.slice(0, 2))).toEqual([0xff, 0xd8]);
    expect(new TextDecoder("latin1").decode(out)).not.toContain("GPS");
    expect(new TextDecoder("latin1").decode(out)).toContain("JFIF");
    expect(Array.from(out.slice(-2))).toEqual([0xff, 0xd9]);
  });
  it("strips text/EXIF chunks from PNG", () => {
    const chunk = (type: string, data: number[]) => [0, 0, 0, data.length, ...new TextEncoder().encode(type), ...data, 0, 0, 0, 0];
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, ...chunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]), ...chunk("eXIf", [1, 2, 3]), ...chunk("tEXt", [65, 0, 66]), ...chunk("IDAT", [9, 9]), ...chunk("IEND", [])]);
    const text = new TextDecoder("latin1").decode(stripPng(png));
    expect(text).toContain("IHDR");
    expect(text).toContain("IDAT");
    expect(text).not.toContain("eXIf");
    expect(text).not.toContain("tEXt");
  });
  it("strips EXIF/XMP chunks from WebP and fixes the RIFF size", () => {
    const chunk = (t: string, d: number[]) => [...new TextEncoder().encode(t), d.length, 0, 0, 0, ...d, ...(d.length % 2 ? [0] : [])];
    const body = [...chunk("VP8X", [0x0c, 0, 0, 0, 0, 0, 0, 0, 0, 0]), ...chunk("EXIF", [1, 2, 3]), ...chunk("VP8 ", [7, 7, 7, 7]), ...chunk("XMP ", [5, 5])];
    const size = 4 + body.length;
    const webp = Uint8Array.from([...new TextEncoder().encode("RIFF"), size & 255, size >> 8, 0, 0, ...new TextEncoder().encode("WEBP"), ...body]);
    const out = stripWebp(webp);
    const text = new TextDecoder("latin1").decode(out);
    expect(text).not.toContain("EXIF");
    expect(text).not.toContain("XMP ");
    expect(text).toContain("VP8 ");
    expect(out[4] | (out[5] << 8)).toBe(out.length - 8);
    const vp8x = text.indexOf("VP8X");
    expect(out[vp8x + 8] & 0x0c).toBe(0);
  });
});
