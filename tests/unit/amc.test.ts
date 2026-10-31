import { describe, expect, it } from "vitest";
import { computeAmc, visitDueDates } from "@/lib/amc";
import { completionDate } from "@/lib/schedule";
import { DEFAULT_STAGES } from "@/lib/stages";
import { blocked, ck, done, w } from "./helpers";
import { addDays, addMonths, diffDays, fmtLong } from "@/lib/dates";
import type { Amc } from "@/lib/types";

const base: Amc = { plan: "Gold AMC", startsOn: "2026-01-01", months: 12, visits: 4, coverage: ["a", "b"], visitLog: [] };
const view = (over: Partial<Amc>, today: string, handover: string | null = null, forecastEnd = "2026-06-30") =>
  computeAmc({ ...base, ...over }, handover, forecastEnd, today);

describe("dates for AMC", () => {
  it("adds months and clamps the day", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
    expect(addMonths("2026-01-01", 12)).toBe("2027-01-01");
    expect(fmtLong("2026-11-05")).toBe("5 Nov 2026");
  });
});

describe("completionDate (what an AMC starting at handover is anchored to)", () => {
  const all = DEFAULT_STAGES.map((st) => done(st.id));
  it("is null until every stage is done, then the day it first happened", () => {
    expect(completionDate(DEFAULT_STAGES, [])).toBeNull();
    expect(completionDate(DEFAULT_STAGES, [ck("2026-03-01", [done("civil")])])).toBeNull();
    expect(completionDate(DEFAULT_STAGES, [ck("2026-04-20", [w("handover", 50)]), ck("2026-04-30", all)])).toBe("2026-04-30");
  });
  it("is not moved by reopening a stage later (a snag fix must not rewrite a contract)", () => {
    const history = [ck("2026-04-30", all), ck("2026-09-10", [w("handover", 90)]), ck("2026-09-12", [blocked("fittings", "Material not arrived")])];
    expect(completionDate(DEFAULT_STAGES, history)).toBe("2026-04-30");
    const amc = { ...base, startsOn: "handover" as const };
    const v = computeAmc(amc, completionDate(DEFAULT_STAGES, history), "2026-12-01", "2026-09-20");
    expect(v).toMatchObject({ status: "active", startDate: "2026-05-01", endDate: "2027-04-30" });
  });
  it("uses the first completion when the project was completed, reopened and completed again", () => {
    const history = [ck("2026-04-30", all), ck("2026-06-01", [w("handover", 50)]), ck("2026-06-05", [done("handover")])];
    expect(completionDate(DEFAULT_STAGES, history)).toBe("2026-04-30");
  });
});

describe("AMC status", () => {
  it("is active mid-term with days left", () => {
    const v = view({}, "2026-06-01");
    expect(v).toMatchObject({ status: "active", startDate: "2026-01-01", endDate: "2026-12-31", needsRenewal: false });
    expect(v.daysLeft).toBe(diffDays("2026-12-31", "2026-06-01"));
  });
  it("is expiring within 30 days of the end, including the last day", () => {
    expect(view({}, "2026-12-01").status).toBe("expiring"); // 30 days left
    expect(view({}, "2026-11-30").status).toBe("active"); // 31 days left
    const last = view({}, "2026-12-31");
    expect(last).toMatchObject({ status: "expiring", daysLeft: 0, needsRenewal: true });
  });
  it("is expired the day after the end", () => {
    const v = view({}, "2027-01-01");
    expect(v).toMatchObject({ status: "expired", needsRenewal: true, nextVisitDue: null, daysLeft: null });
  });
  it("is upcoming before an explicit start date", () => {
    const v = view({ startsOn: "2026-09-01" }, "2026-06-01");
    expect(v).toMatchObject({ status: "upcoming", startDate: "2026-09-01", endDate: "2027-08-31" });
  });
  it("handover mode: upcoming with an expected start while work is still going", () => {
    const v = view({ startsOn: "handover" }, "2026-06-01", null, "2026-07-10");
    expect(v).toMatchObject({ status: "upcoming", startDate: null, endDate: null, expectedStart: "2026-07-11", daysLeft: null });
    expect(v.nextVisitDue).toBeNull();
  });
  it("handover mode: starts the day after handover once the project is done", () => {
    const v = view({ startsOn: "handover" }, "2026-08-01", "2026-07-10");
    expect(v).toMatchObject({ status: "active", startDate: "2026-07-11", endDate: "2027-07-10", expectedStart: null });
  });
  it("a 6 month term ends the day before the 6 month mark", () => {
    expect(view({ months: 6 }, "2026-02-01").endDate).toBe("2026-06-30");
  });
});

describe("AMC visits", () => {
  it("spreads included visits evenly across the term, the last one on the final day", () => {
    const dues = visitDueDates("2026-01-01", "2026-12-31", 4);
    expect(dues).toHaveLength(4);
    expect(dues[3]).toBe("2026-12-31");
    for (let i = 1; i < dues.length; i++) expect(diffDays(dues[i], dues[i - 1])).toBeGreaterThanOrEqual(90);
    expect(visitDueDates("2026-01-01", "2026-12-31", 0)).toEqual([]);
    expect(visitDueDates("2026-01-01", "2026-12-31", 1)).toEqual(["2026-12-31"]);
  });
  it("counts used and left visits and points at the next due date", () => {
    const dues = visitDueDates("2026-01-01", "2026-12-31", 4);
    const v = view({ visitLog: [{ date: "2026-04-05", note: "Checked doors" }] }, "2026-05-01");
    expect(v).toMatchObject({ visitsIncluded: 4, visitsUsed: 1, visitsLeft: 3, nextVisitDue: dues[1], nextVisitOverdue: false });
  });
  it("flags an overdue visit", () => {
    const dues = visitDueDates("2026-01-01", "2026-12-31", 4);
    const v = view({}, addDays(dues[0], 3));
    expect(v.nextVisitDue).toBe(dues[0]);
    expect(v.nextVisitOverdue).toBe(true);
  });
  it("has no next visit once all are used, and lists the log newest first", () => {
    const log = [1, 2, 3, 4].map((n) => ({ date: `2026-0${n}-10`, note: `v${n}` }));
    const v = view({ visitLog: log }, "2026-06-01");
    expect(v.visitsLeft).toBe(0);
    expect(v.nextVisitDue).toBeNull();
    expect(v.visitLog.map((x) => x.note)).toEqual(["v4", "v3", "v2", "v1"]);
  });
});
