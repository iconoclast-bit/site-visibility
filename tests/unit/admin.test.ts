import { describe, expect, it } from "vitest";
import { newToken, validateAmc, validateNewProject, validateProjectPatch, validateShowcase, validateSupervisor, validateVisit } from "@/lib/adminValidation";

const good = { name: "Rao 3BHK", clientName: "Asha Rao", address: "12 Lake Road", startDate: "2026-07-01", newSupervisorName: "Imran" };

describe("new project", () => {
  it("accepts a minimal project and builds ids, token and default stages", () => {
    const r = validateNewProject(good, []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.project.id).toMatch(/^p-rao-3bhk-[0-9a-f]{6}$/);
    expect(r.value.project.clientToken).toHaveLength(24);
    expect(r.value.project.stages).toHaveLength(7);
    expect(r.value.project.showcase).toBe(false);
    expect(r.value.newSupervisorName).toBe("Imran");
  });
  it("normalises phone numbers and rejects bad input", () => {
    const ok = validateNewProject({ ...good, clientPhone: "+91 98765-43210" }, []);
    expect(ok.ok && ok.value.project.clientPhone).toBe("919876543210");
    const errs = (b: object, sups: string[] = []) => { const r = validateNewProject({ ...good, ...b }, sups); return r.ok ? [] : r.errors.join("|"); };
    expect(errs({ clientPhone: "12ab" })).toMatch(/Phone/);
    expect(errs({ name: "" })).toMatch(/Project name is required/);
    expect(errs({ name: "x".repeat(61) })).toMatch(/too long/);
    expect(errs({ startDate: "2026-02-30" })).toMatch(/Start date/);
    expect(errs({ startDate: "tomorrow" })).toMatch(/Start date/);
    expect(errs({ newSupervisorName: "" })).toMatch(/Supervisor name/);
    expect(errs({ supervisorId: "ghost" }, ["sup-1"])).toMatch(/existing supervisor/);
    expect(validateNewProject({ ...good, newSupervisorName: undefined, supervisorId: "sup-1" }, ["sup-1"]).ok).toBe(true);
    expect(validateNewProject("x", []).ok).toBe(false);
  });
  it("only treats showcase === true as consent", () => {
    for (const v of ["true", 1, "yes", undefined]) {
      const r = validateNewProject({ ...good, showcase: v }, []);
      expect(r.ok && r.value.project.showcase).toBe(false);
    }
    const on = validateNewProject({ ...good, showcase: true }, []);
    expect(on.ok && on.value.project.showcase).toBe(true);
  });
  it("tokens are long and unique", () => {
    const t = new Set(Array.from({ length: 200 }, newToken));
    expect(t.size).toBe(200);
    expect([...t][0]).toMatch(/^[A-Za-z0-9_-]{24}$/);
  });
});

describe("supervisor and patch", () => {
  it("validates supervisor names", () => {
    expect(validateSupervisor({ name: "A" }).ok).toBe(false);
    const r = validateSupervisor({ name: " Imran " });
    expect(r.ok && r.value).toMatchObject({ name: "Imran", projectIds: [] });
  });
  it("validates project patches", () => {
    expect(validateProjectPatch({})).toMatchObject({ ok: false });
    expect(validateProjectPatch({ showcase: "yes" })).toMatchObject({ ok: false });
    expect(validateProjectPatch({ showcase: true, style: "Boho", clientPhone: "" })).toEqual({ ok: true, value: { showcase: true, style: "Boho", clientPhone: null } });
    expect(validateProjectPatch({ clientPhone: "abc" })).toMatchObject({ ok: false });
  });
});

describe("AMC input", () => {
  const amc = { plan: "Gold AMC", startsOn: "handover", months: 12, visits: 4, coverage: "Hinges\n\n  Paint touch-ups  \n" };
  it("accepts handover or a date start and keeps the visit log", () => {
    const log = [{ date: "2026-03-01", note: "x" }];
    const r = validateAmc(amc, log);
    expect(r.ok && r.value).toMatchObject({ startsOn: "handover", months: 12, visits: 4, coverage: ["Hinges", "Paint touch-ups"], visitLog: log });
    expect(validateAmc({ ...amc, startsOn: "2026-09-01", purchasedOn: "2026-08-01" }).ok).toBe(true);
  });
  it("rejects bad terms", () => {
    const bad = (o: object) => validateAmc({ ...amc, ...o }).ok;
    expect(bad({ plan: "" })).toBe(false);
    expect(bad({ startsOn: "soon" })).toBe(false);
    expect(bad({ months: 0 })).toBe(false);
    expect(bad({ months: 61 })).toBe(false);
    expect(bad({ months: 1.5 })).toBe(false);
    expect(bad({ visits: -1 })).toBe(false);
    expect(bad({ purchasedOn: "x" })).toBe(false);
    expect(bad({ coverage: Array(13).fill("a") })).toBe(false);
    expect(bad({ coverage: ["x".repeat(121)] })).toBe(false);
    expect(validateAmc(null).ok).toBe(false);
  });
  it("validates logged visits", () => {
    expect(validateVisit({ date: "2026-06-10", note: "Checked doors" }, "2026-06-15")).toMatchObject({ ok: true });
    expect(validateVisit({ date: "2026-06-30", note: "Checked doors" }, "2026-06-15")).toMatchObject({ ok: false });
    expect(validateVisit({ date: "2026-06-10", note: "ab" }, "2026-06-15")).toMatchObject({ ok: false });
    expect(validateVisit({ date: "nope", note: "Checked doors" }, "2026-06-15")).toMatchObject({ ok: false });
  });
});

describe("feed selection", () => {
  const checkin = {
    photos: ["a.jpg", "b.jpg", "c.jpg"].map((fileName, i) => ({ fileName, stageId: i ? "paint" : "civil", takenAt: "x", width: 1, height: 1 })),
    showcase: [{ id: "s-keep", fileName: "a.jpg", stageId: "civil" }],
  };
  it("keeps the opaque id of photos that stay selected and mints new ones", () => {
    const r = validateShowcase({ fileNames: ["a.jpg", "b.jpg", "a.jpg"], caption: " Nice " }, checkin);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.caption).toBe("Nice");
    expect(r.value.photos).toHaveLength(2); // duplicate dropped
    expect(r.value.photos[0]).toEqual({ id: "s-keep", fileName: "a.jpg", stageId: "civil" });
    expect(r.value.photos[1].id).toMatch(/^s/);
    expect(r.value.photos[1].id).not.toBe("s-keep");
    expect(r.value.photos[1].stageId).toBe("paint");
  });
  it("allows clearing the selection and rejects foreign photos", () => {
    expect(validateShowcase({ fileNames: [], caption: "" }, checkin)).toMatchObject({ ok: true, value: { photos: [] } });
    expect(validateShowcase({ fileNames: ["other-project.jpg"], caption: "" }, checkin)).toMatchObject({ ok: false });
    expect(validateShowcase({ fileNames: "a.jpg", caption: "" }, checkin)).toMatchObject({ ok: false });
    expect(validateShowcase({ fileNames: [], caption: "x".repeat(201) }, checkin)).toMatchObject({ ok: false });
  });
});
