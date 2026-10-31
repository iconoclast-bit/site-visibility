/**
 * AMC (Annual Maintenance Contract) status. Deterministic, like schedule.ts:
 * every date and status the client sees is computed here, never by an LLM.
 */
import { addDays, addMonths, diffDays } from "./dates";
import type { Amc, ISODate } from "./types";

export type AmcStatus = "upcoming" | "active" | "expiring" | "expired";
export const EXPIRING_DAYS = 30;

export interface AmcView {
  plan: string;
  status: AmcStatus;
  /** null while the project is not handed over yet and the AMC starts at handover */
  startDate: ISODate | null;
  endDate: ISODate | null;
  expectedStart: ISODate | null; // set while startDate is null (handover forecast + 1 day)
  daysLeft: number | null; // days until the AMC ends (only when running)
  visitsIncluded: number;
  visitsUsed: number;
  visitsLeft: number;
  nextVisitDue: ISODate | null;
  nextVisitOverdue: boolean;
  coverage: string[];
  visitLog: { date: ISODate; note: string }[];
  purchasedOn: ISODate | null;
  needsRenewal: boolean; // expiring or expired
}

export const AMC_LABEL: Record<AmcStatus, string> = {
  upcoming: "Starts after handover",
  active: "Active",
  expiring: "Expiring soon",
  expired: "Expired",
};

export const AMC_TONE: Record<AmcStatus, "ok" | "warn" | "bad" | "info"> = { active: "ok", expiring: "warn", expired: "bad", upcoming: "info" };

/** Evenly spaced due dates across the term: n visits in a term of D days are due at start + k*D/n. */
export function visitDueDates(start: ISODate, end: ISODate, visits: number): ISODate[] {
  const termDays = diffDays(end, start) + 1;
  return Array.from({ length: Math.max(0, visits) }, (_, i) => addDays(start, Math.round(((i + 1) * termDays) / visits) - 1));
}

/** `handover` is the project's first completion date (see completionDate() in schedule.ts), or null while work continues. */
export function computeAmc(amc: Amc, handover: ISODate | null, forecastEnd: ISODate, today: ISODate): AmcView {
  const start = amc.startsOn === "handover" ? (handover ? addDays(handover, 1) : null) : amc.startsOn;
  const end = start ? addDays(addMonths(start, amc.months), -1) : null;
  const used = amc.visitLog.length;

  let status: AmcStatus;
  let daysLeft: number | null = null;
  if (!start || !end || today < start) status = "upcoming";
  else if (today > end) status = "expired";
  else {
    daysLeft = diffDays(end, today);
    status = daysLeft <= EXPIRING_DAYS ? "expiring" : "active";
  }

  const dues = start && end ? visitDueDates(start, end, amc.visits) : [];
  const nextVisitDue = used < amc.visits ? (dues[used] ?? null) : null;
  return {
    plan: amc.plan,
    status,
    startDate: start,
    endDate: end,
    expectedStart: start ? null : addDays(forecastEnd, 1),
    daysLeft,
    visitsIncluded: amc.visits,
    visitsUsed: used,
    visitsLeft: Math.max(0, amc.visits - used),
    nextVisitDue: status === "expired" ? null : nextVisitDue,
    nextVisitOverdue: status !== "expired" && status !== "upcoming" && nextVisitDue !== null && nextVisitDue < today,
    coverage: amc.coverage,
    visitLog: [...amc.visitLog].sort((a, b) => b.date.localeCompare(a.date)),
    purchasedOn: amc.purchasedOn ?? null,
    needsRenewal: status === "expiring" || status === "expired",
  };
}
