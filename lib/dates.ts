import type { ISODate } from "./types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 330 * 60_000;

export const MONTH_NAMES = MONTHS;

export function isISODate(s: unknown): s is ISODate {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(s + "T00:00:00Z");
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}

function toMs(d: ISODate): number {
  return Date.parse(d + "T00:00:00Z");
}

export function addDays(d: ISODate, n: number): ISODate {
  return new Date(toMs(d) + n * DAY_MS).toISOString().slice(0, 10);
}

/** a - b in whole calendar days */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((toMs(a) - toMs(b)) / DAY_MS);
}

export function maxDate(...ds: ISODate[]): ISODate {
  return ds.reduce((m, d) => (d > m ? d : m));
}
export function minDate(...ds: ISODate[]): ISODate {
  return ds.reduce((m, d) => (d < m ? d : m));
}

/** "Today" in India Standard Time as a calendar date. */
export function todayIST(now: Date = new Date()): ISODate {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** IST calendar date of an ISO timestamp. */
export function istDateOf(iso: string): ISODate {
  return todayIST(new Date(iso));
}

/** "Fri 20 Nov" */
export function fmtDate(d: ISODate): string {
  const t = new Date(toMs(d));
  return `${WEEKDAYS[t.getUTCDay()]} ${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}`;
}

/** "20 Nov 2026" */
export function fmtLong(d: ISODate): string {
  const t = new Date(toMs(d));
  return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}`;
}

/** Add calendar months, clamping the day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(d: ISODate, months: number): ISODate {
  const t = new Date(toMs(d));
  const day = t.getUTCDate();
  const target = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return target.toISOString().slice(0, 10);
}

/** "20 Nov" */
export function fmtShort(d: ISODate): string {
  const t = new Date(toMs(d));
  return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}`;
}

export function plural(n: number, one: string, many = one + "s"): string {
  return `${n} ${n === 1 ? one : many}`;
}
