import { describe, expect, it } from "vitest";
import { addDays, diffDays, fmtDate, todayIST } from "@/lib/dates";
import {
  urgencyScore, buildPlan, computeSchedule, forecast, nextUp, overallPercent, plainReason, replay, validateStages, ScheduleError, healthOf, initialStatus, plannedEnd,
} from "@/lib/schedule";
import { DEFAULT_STAGES } from "@/lib/stages";
import { blocked, ck, done, project, START, w } from "./helpers";

describe("dates", () => {
  it("does UTC calendar math", () => {
    expect(addDays("2026-02-27", 2)).toBe("2026-03-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(diffDays("2026-03-10", "2026-03-01")).toBe(9);
    expect(fmtDate("2026-11-20")).toBe("Fri 20 Nov");
  });
  it("uses IST for today (UTC+5:30)", () => {
    expect(todayIST(new Date("2026-03-01T18:29:00Z"))).toBe("2026-03-01");
    expect(todayIST(new Date("2026-03-01T18:31:00Z"))).toBe("2026-03-02");
  });
});

describe("plan / dependencies", () => {
  it("starts a stage the day after its last dependency ends", () => {
    const plan = buildPlan(DEFAULT_STAGES, START);
    expect(plan.civil).toEqual({ start: "2026-03-02", end: "2026-03-08" });
    expect(plan.elec).toEqual({ start: "2026-03-09", end: "2026-03-14" });
    expect(plan.ceiling).toEqual({ start: "2026-03-15", end: "2026-03-21" });
    expect(plan.carpentry).toEqual({ start: "2026-03-15", end: "2026-04-08" });
    expect(plan.paint).toEqual({ start: "2026-04-09", end: "2026-04-18" }); // after BOTH ceiling and carpentry
    expect(plan.fittings).toEqual({ start: "2026-04-19", end: "2026-04-22" });
    expect(plan.handover).toEqual({ start: "2026-04-23", end: "2026-04-24" });
    expect(plannedEnd(plan)).toBe("2026-04-24");
  });
  it("detects cycles, unknown ids, duplicates, self-dependency and bad durations", () => {
    const s = (id: string, dependsOn: string[], plannedDays = 1) => ({ id, name: id, short: id, trade: "x", plannedDays, dependsOn });
    expect(() => validateStages([s("a", ["b"]), s("b", ["a"])])).toThrow(/cycle/i);
    expect(() => validateStages([s("a", ["zzz"])])).toThrow(/unknown stage/);
    expect(() => validateStages([s("a", []), s("a", [])])).toThrow(/Duplicate/);
    expect(() => validateStages([s("a", ["a"])])).toThrow(ScheduleError);
    expect(() => validateStages([s("a", [], 0)])).toThrow(/plannedDays/);
    expect(() => validateStages([])).toThrow();
    expect(() => buildPlan([s("a", ["b"]), s("b", ["a"])], START)).toThrow(/cycle/i);
  });
});

describe("replay", () => {
  const stages = DEFAULT_STAGES;
  it("a later update wins, regardless of array order", () => {
    const later = ck("2026-03-06", [w("civil", 80)]);
    const earlier = ck("2026-03-04", [w("civil", 30)]);
    expect(replay(stages, [later, earlier]).civil.percent).toBe(80);
  });
  it("orders same-day check-ins by createdAt", () => {
    const a = ck("2026-03-04", [w("civil", 30)], { createdAt: "2026-03-04T05:00:00.000Z" });
    const b = ck("2026-03-04", [w("civil", 60)], { createdAt: "2026-03-04T09:00:00.000Z" });
    expect(replay(stages, [b, a]).civil.percent).toBe(60);
  });
  it("records start and done dates; done means 100%", () => {
    const st = replay(stages, [ck("2026-03-03", [w("civil", 20)]), ck("2026-03-09", [done("civil")])]);
    expect(st.civil).toMatchObject({ state: "done", percent: 100, startedDate: "2026-03-03", doneDate: "2026-03-09" });
  });
  it("reopening a done stage clears its done date", () => {
    const st = replay(stages, [ck("2026-03-08", [done("civil")]), ck("2026-03-10", [w("civil", 60)])]);
    expect(st.civil.state).toBe("working");
    expect(st.civil.doneDate).toBeUndefined();
    expect(st.civil.percent).toBe(60);
  });
  it("reopening without a percent assumes 90%", () => {
    const st = replay(stages, [ck("2026-03-08", [done("civil")]), ck("2026-03-10", [{ stageId: "civil", state: "working" }])]);
    expect(st.civil.percent).toBe(90);
  });
  it("blocked keeps percent and reason; not_started resets everything", () => {
    let st = replay(stages, [ck("2026-03-03", [w("civil", 40)]), ck("2026-03-04", [blocked("civil", "Material not arrived")])]);
    expect(st.civil).toMatchObject({ state: "blocked", percent: 40, blockedReason: "Material not arrived" });
    st = replay(stages, [ck("2026-03-03", [w("civil", 40)]), ck("2026-03-04", [{ stageId: "civil", state: "not_started" }])]);
    expect(st.civil).toMatchObject({ state: "not_started", percent: 0 });
    expect(st.civil.startedDate).toBeUndefined();
  });
  it("ignores unknown stage ids defensively", () => {
    expect(() => replay(stages, [ck("2026-03-03", [w("nope", 10)])])).not.toThrow();
  });
});

describe("forecast and slip", () => {
  const p = project();
  const base = [ck("2026-03-05", [w("civil", 50)]), ck("2026-03-09", [done("civil")]), ck("2026-03-12", [w("elec", 50)]), ck("2026-03-15", [done("elec")])];

  it("done = actual dates", () => {
    const s = computeSchedule(p, base, "2026-03-15");
    expect(s.forecast.civil).toEqual({ start: "2026-03-05", end: "2026-03-09" });
    expect(s.forecast.elec.end).toBe("2026-03-15");
  });
  it("working = today + planned days x (1 - %) rounded up", () => {
    const s = computeSchedule(p, [...base, ck("2026-03-16", [w("carpentry", 40), w("ceiling", 90)])], "2026-03-16");
    expect(s.forecast.carpentry.end).toBe(addDays("2026-03-16", 15)); // 25 x 0.6
    expect(s.forecast.ceiling.end).toBe(addDays("2026-03-16", 1)); // 7 x 0.1 = 0.7 -> 1
  });
  it("working at 100% ends today", () => {
    const s = computeSchedule(p, [ck("2026-03-03", [w("civil", 100)])], "2026-03-04");
    expect(s.forecast.civil.end).toBe("2026-03-04");
  });
  it("not started = after dependencies, never before planned start, never in the past", () => {
    const early = computeSchedule(p, [], "2026-02-20"); // project not started yet
    expect(early.forecast.civil.start).toBe(START);
    expect(early.slipDays).toBe(0);
    const s = computeSchedule(p, base, "2026-03-20");
    expect(s.forecast.ceiling).toEqual({ start: "2026-03-20", end: "2026-03-26" });
    expect(s.forecast.carpentry).toEqual({ start: "2026-03-20", end: "2026-04-13" });
    expect(s.forecast.paint.start).toBe("2026-04-14"); // after the slower of the two
  });
  it("slip = forecast end - planned end (positive late, negative ahead)", () => {
    const late = computeSchedule(p, base, "2026-03-20");
    expect(late.plannedEnd).toBe("2026-04-24");
    expect(late.forecastEnd).toBe("2026-04-29");
    expect(late.slipDays).toBe(5);
    // not-started stages are never forecast before their planned start, so "ahead" only happens when all work is done early
    const quick = computeSchedule(project(), [ck("2026-03-30", DEFAULT_STAGES.map((st) => done(st.id)))], "2026-03-31");
    expect(quick.slipDays).toBe(diffDays("2026-03-30", "2026-04-24"));
    expect(quick.slipDays).toBeLessThan(0);
  });
  it("is on schedule when everything is on its planned dates", () => {
    const s = computeSchedule(p, [ck("2026-03-08", [done("civil")])], "2026-03-09");
    expect(s.slipDays).toBe(0);
    expect(s.flags).toEqual([]);
    expect(s.health).toBe("ok");
  });
  it("forecast() works directly on a status map", () => {
    const plan = buildPlan(DEFAULT_STAGES, START);
    const fc = forecast(DEFAULT_STAGES, plan, initialStatus(DEFAULT_STAGES), START);
    expect(fc).toEqual(plan);
  });
});

describe("flags and health", () => {
  const p = project();
  it("blocked", () => {
    const s = computeSchedule(p, [ck("2026-03-20", [done("civil"), done("elec"), w("carpentry", 50), blocked("ceiling", "Material not arrived", 30)])], "2026-03-20");
    const f = s.flags.find((x) => x.kind === "blocked")!;
    expect(f).toMatchObject({ severity: "bad", stageId: "ceiling" });
    expect(f.text).toContain("Material not arrived"); // owner-facing text keeps the raw reason
    expect(s.health).toBe("bad");
    expect(s.flags[0].kind).toBe("blocked"); // most important first
  });
  it("heading N days late (warn below 4, bad from 4)", () => {
    const warn = computeSchedule(p, [ck("2026-03-05", [w("civil", 50)]), ck("2026-03-11", [w("elec", 50)])], "2026-03-12");
    expect(warn.slipDays).toBe(1);
    expect(warn.flags.map((x) => [x.kind, x.severity])).toEqual([["late", "warn"]]);
    expect(warn.health).toBe("warn");
    const bad = computeSchedule(p, [ck("2026-03-05", [done("civil")]), ck("2026-03-20", [w("elec", 10)])], "2026-03-20");
    expect(bad.slipDays).toBeGreaterThanOrEqual(4);
    expect(bad.flags.find((x) => x.kind === "late")!.severity).toBe("bad");
  });
  it("should-have-started-but-hasn't (ready stage past its planned start)", () => {
    const s = computeSchedule(p, [ck("2026-03-08", [done("civil")]), ck("2026-03-14", [w("elec", 10)])], "2026-03-14");
    expect(s.flags.some((x) => x.kind === "not_started")).toBe(false); // elec started, ceiling not ready yet
    const s2 = computeSchedule(p, [ck("2026-03-08", [done("civil")]), ck("2026-03-16", [done("elec")])], "2026-03-17");
    expect(s2.flags.filter((x) => x.kind === "not_started").map((x) => x.stageId).sort()).toEqual(["carpentry", "ceiling"]);
  });
  it("does not flag a stage whose dependencies are not done", () => {
    const s = computeSchedule(p, [ck("2026-03-30", [w("civil", 10)])], "2026-03-30");
    expect(s.flags.some((x) => x.kind === "not_started" && x.stageId === "paint")).toBe(false);
  });
  it("no site update for 2+ days (any review state counts as a visit)", () => {
    const s = computeSchedule(p, [ck("2026-03-04", [w("civil", 30)], { review: "pending" })], "2026-03-06");
    expect(s.flags.find((x) => x.kind === "stale")!.text).toMatch(/2 days/);
    const fresh = computeSchedule(p, [ck("2026-03-05", [w("civil", 30)])], "2026-03-06");
    expect(fresh.flags.some((x) => x.kind === "stale")).toBe(false);
  });
  it("stale counts from project start when there is no check-in, but not before it starts", () => {
    expect(computeSchedule(p, [], "2026-03-04").flags.some((x) => x.kind === "stale")).toBe(true);
    expect(computeSchedule(p, [], "2026-02-25").flags).toEqual([]);
  });
  it("no flags once complete", () => {
    const all = DEFAULT_STAGES.map((s) => done(s.id));
    const s = computeSchedule(p, [ck("2026-04-30", all)], "2026-05-20");
    expect(s.complete).toBe(true);
    expect(s.flags).toEqual([]);
    expect(s.health).toBe("ok");
    expect(s.percent).toBe(100);
  });
  it("healthOf", () => {
    expect(healthOf([])).toBe("ok");
    expect(healthOf([{ kind: "stale", severity: "warn", text: "" }])).toBe("warn");
    expect(healthOf([{ kind: "stale", severity: "warn", text: "" }, { kind: "blocked", severity: "bad", text: "" }])).toBe("bad");
  });
});

describe("helpers", () => {
  it("overall % is weighted by planned days", () => {
    const st = replay(DEFAULT_STAGES, [ck("2026-03-08", [done("civil"), w("carpentry", 50)])]);
    // civil 7x100 + carpentry 25x50 = 700 + 1250 = 1950 over 61 days
    expect(overallPercent(DEFAULT_STAGES, st)).toBe(Math.round(1950 / 61));
    expect(overallPercent(DEFAULT_STAGES, initialStatus(DEFAULT_STAGES))).toBe(0);
  });
  it("next-up lists ready stages", () => {
    const st = replay(DEFAULT_STAGES, [ck("2026-03-08", [done("civil")])]);
    expect(nextUp(DEFAULT_STAGES, st).ready.map((s) => s.id)).toEqual(["elec"]);
    const st2 = replay(DEFAULT_STAGES, [ck("2026-03-16", [done("civil"), done("elec")])]);
    expect(nextUp(DEFAULT_STAGES, st2).ready.map((s) => s.id)).toEqual(["ceiling", "carpentry"]);
  });
  it("next-up falls back to what the first waiting stage waits for", () => {
    const st = replay(DEFAULT_STAGES, [ck("2026-03-20", [done("civil"), done("elec"), w("ceiling", 50), w("carpentry", 20)])]);
    const n = nextUp(DEFAULT_STAGES, st);
    expect(n.ready).toEqual([]);
    expect(n.waiting!.stage.id).toBe("paint");
    expect(n.waiting!.waitingFor.map((s) => s.id)).toEqual(["ceiling", "carpentry"]);
    const only = replay(DEFAULT_STAGES, [ck("2026-03-20", [done("civil"), done("elec"), done("ceiling"), w("carpentry", 20)])]);
    expect(nextUp(DEFAULT_STAGES, only).waiting!.waitingFor.map((s) => s.id)).toEqual(["carpentry"]);
  });
  it("plain-language reasons never repeat raw text", () => {
    expect(plainReason("Material not arrived")).toBe("waiting for material to be delivered");
    expect(plainReason("Workers not available")).toBe("waiting for the work team to be available");
    expect(plainReason("Waiting for client decision")).toBe("waiting for a decision to be confirmed");
    expect(plainReason("Previous stage not finished")).toBe("waiting for earlier work to be completed");
    expect(plainReason("Mr Gupta in flat 4 is complaining about drilling")).toBe("waiting on a site issue that is being sorted out");
    expect(plainReason(undefined)).toBe("waiting on a site issue that is being sorted out");
  });
});

describe("plainReason with chip + free text", () => {
  it("classifies by the chip first so free text cannot change its meaning", () => {
    expect(plainReason("Workers not available: material also late")).toBe("waiting for the work team to be available");
    expect(plainReason("Waiting for client decision — tile colour")).toBe("waiting for a decision to be confirmed");
    expect(plainReason("Material not arrived: plywood")).toBe("waiting for material to be delivered");
  });
});

describe("dashboard urgency", () => {
  it("ranks blocked > late > watch > on track, and finished projects last", () => {
    const p = project();
    const sc = (cs: ReturnType<typeof ck>[], today: string) => computeSchedule(p, cs, today);
    const bad = sc([ck("2026-03-20", [done("civil"), done("elec"), blocked("ceiling", "Material not arrived", 30), w("carpentry", 5)])], "2026-03-20");
    const warn = sc([ck("2026-03-05", [w("civil", 50)]), ck("2026-03-11", [w("elec", 50)])], "2026-03-12");
    const ok = sc([ck("2026-03-08", [done("civil")])], "2026-03-09");
    const finished = sc([ck("2026-03-30", DEFAULT_STAGES.map((st) => done(st.id)))], "2026-03-31"); // done early -> negative slip
    const late = sc([ck("2026-04-30", DEFAULT_STAGES.map((st) => done(st.id)))], "2026-05-02"); // done late
    expect(finished.complete && late.complete).toBe(true);
    const order = [bad, warn, ok, finished].map((s) => urgencyScore(s, 0));
    expect([...order].sort((a, b) => b - a)).toEqual(order);
    expect(urgencyScore(late, 0)).toBeLessThan(urgencyScore(ok, 1)); // a late-finished project never outranks an active on-track one
  });
});
