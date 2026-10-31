/**
 * Deterministic scheduling. Every date, "is it late", dependency and ETA in the
 * product comes from this file. No LLM ever computes or invents these.
 *
 * Conventions: calendar days, UTC date math on YYYY-MM-DD strings, "today" is
 * passed in by the caller (use todayIST()).
 */
import { addDays, diffDays, fmtDate, maxDate, plural } from "./dates";
import type {
  Checkin,
  DateRange,
  ISODate,
  PlanMap,
  Project,
  Stage,
  StageState,
  StageUpdate,
  StatusMap,
} from "./types";

export class ScheduleError extends Error {}

// ---------- plan -----------------------------------------------------------

/** Throws ScheduleError on duplicate/unknown ids, bad durations or cycles. */
export function validateStages(stages: Stage[]): void {
  if (!stages.length) throw new ScheduleError("A project needs at least one stage");
  const ids = new Set<string>();
  for (const s of stages) {
    if (ids.has(s.id)) throw new ScheduleError(`Duplicate stage id "${s.id}"`);
    ids.add(s.id);
    if (!Number.isInteger(s.plannedDays) || s.plannedDays < 1) {
      throw new ScheduleError(`Stage "${s.id}" needs plannedDays of at least 1`);
    }
  }
  for (const s of stages) {
    for (const d of s.dependsOn) {
      if (!ids.has(d)) throw new ScheduleError(`Stage "${s.id}" depends on unknown stage "${d}"`);
      if (d === s.id) throw new ScheduleError(`Stage "${s.id}" depends on itself`);
    }
  }
  topoOrder(stages); // throws on cycle
}

/** Stages in dependency order (Kahn). Stable: ties keep template order. */
export function topoOrder(stages: Stage[]): Stage[] {
  const indeg = new Map<string, number>();
  for (const s of stages) indeg.set(s.id, s.dependsOn.length);
  const out: Stage[] = [];
  const done = new Set<string>();
  while (out.length < stages.length) {
    const next = stages.find((s) => !done.has(s.id) && s.dependsOn.every((d) => done.has(d)));
    if (!next) throw new ScheduleError("Dependency cycle between stages");
    out.push(next);
    done.add(next.id);
  }
  return out;
}

/** A stage starts the day after its last dependency ends; roots start on startDate. */
export function buildPlan(stages: Stage[], startDate: ISODate): PlanMap {
  validateStages(stages);
  const plan: PlanMap = {};
  for (const s of topoOrder(stages)) {
    const start = s.dependsOn.length
      ? addDays(maxDate(...s.dependsOn.map((d) => plan[d].end)), 1)
      : startDate;
    plan[s.id] = { start, end: addDays(start, s.plannedDays - 1) };
  }
  return plan;
}

export function plannedEnd(plan: PlanMap): ISODate {
  return maxDate(...Object.values(plan).map((r) => r.end));
}

// ---------- replay ---------------------------------------------------------

export function sortCheckins(checkins: Checkin[]): Checkin[] {
  return [...checkins].sort((a, b) =>
    a.date === b.date ? a.createdAt.localeCompare(b.createdAt) : a.date.localeCompare(b.date),
  );
}

export function initialStatus(stages: Stage[]): StatusMap {
  const m: StatusMap = {};
  for (const s of stages) m[s.id] = { state: "not_started", percent: 0 };
  return m;
}

/** When a done stage is reopened to working/blocked without a percent, assume nearly finished. */
export const REOPEN_PERCENT = 90;

export function applyUpdate(status: StatusMap, u: StageUpdate, date: ISODate): void {
  const prev = status[u.stageId];
  if (!prev) return; // unknown stage ids are ignored defensively (validation rejects them upstream)
  const base = prev.state === "done" ? REOPEN_PERCENT : prev.percent;
  switch (u.state) {
    case "done":
      status[u.stageId] = {
        state: "done",
        percent: 100,
        startedDate: prev.startedDate ?? date,
        doneDate: date,
        lastUpdate: date,
      };
      break;
    case "working":
      status[u.stageId] = {
        state: "working",
        percent: clampPercent(u.percent ?? base),
        startedDate: prev.startedDate ?? date,
        lastUpdate: date,
      };
      break;
    case "blocked":
      status[u.stageId] = {
        state: "blocked",
        percent: clampPercent(u.percent ?? base),
        blockedReason: u.blockedReason,
        startedDate: prev.startedDate ?? date,
        lastUpdate: date,
      };
      break;
    case "not_started":
      status[u.stageId] = { state: "not_started", percent: 0, lastUpdate: date };
      break;
  }
}

function clampPercent(p: number): number {
  return Math.max(0, Math.min(100, Math.round(p)));
}

/** Replay check-ins in (date, createdAt) order. A later update wins; reopening clears doneDate. */
export function replay(stages: Stage[], checkins: Checkin[]): StatusMap {
  const status = initialStatus(stages);
  for (const c of sortCheckins(checkins)) {
    for (const u of c.updates) applyUpdate(status, u, c.date);
  }
  return status;
}

/**
 * The day the project was FIRST completed (every stage done after some check-in), or null.
 * Pinned to history on purpose: reopening a stage later (a snag fix) must not move the handover
 * date that contracts such as the AMC are anchored to.
 */
export function completionDate(stages: Stage[], checkins: Checkin[]): ISODate | null {
  const status = initialStatus(stages);
  for (const c of sortCheckins(checkins)) {
    for (const u of c.updates) applyUpdate(status, u, c.date);
    if (stages.every((s) => status[s.id].state === "done")) return c.date;
  }
  return null;
}

// ---------- forecast -------------------------------------------------------

export function remainingDays(stage: Stage, percent: number): number {
  return Math.ceil(stage.plannedDays * (1 - percent / 100));
}

/**
 * done          -> actual (started .. done date)
 * working/block -> today + remaining (plannedDays x (1 - %))
 * not started   -> after dependencies, never earlier than its planned start.
 *                  Refinement: also never earlier than today, because a stage
 *                  that has not started cannot start in the past.
 */
export function forecast(stages: Stage[], plan: PlanMap, status: StatusMap, today: ISODate): PlanMap {
  const out: PlanMap = {};
  for (const s of topoOrder(stages)) {
    const st = status[s.id];
    if (st.state === "done") {
      const end = st.doneDate ?? plan[s.id].end;
      out[s.id] = { start: st.startedDate ?? plan[s.id].start, end };
    } else if (st.state === "working" || st.state === "blocked") {
      const start = st.startedDate ?? plan[s.id].start;
      const end = addDays(today, remainingDays(s, st.percent));
      out[s.id] = { start, end: end < start ? start : end };
    } else {
      const depEnds = s.dependsOn.map((d) => addDays(out[d].end, 1));
      const start = maxDate(plan[s.id].start, today, ...depEnds);
      out[s.id] = { start, end: addDays(start, s.plannedDays - 1) };
    }
  }
  return out;
}

// ---------- helpers --------------------------------------------------------

/** Overall completion, weighted by planned days. */
export function overallPercent(stages: Stage[], status: StatusMap): number {
  const total = stages.reduce((n, s) => n + s.plannedDays, 0);
  const done = stages.reduce((n, s) => n + s.plannedDays * (status[s.id]?.percent ?? 0), 0);
  return total ? Math.round(done / total) : 0;
}

export interface NextUp {
  ready: Stage[]; // not started and every dependency is done
  waiting?: { stage: Stage; waitingFor: Stage[] }; // only when nothing is ready
}

export function nextUp(stages: Stage[], status: StatusMap): NextUp {
  const notStarted = topoOrder(stages).filter((s) => status[s.id].state === "not_started");
  const ready = notStarted.filter((s) => s.dependsOn.every((d) => status[d].state === "done"));
  if (ready.length || !notStarted.length) return { ready };
  const first = notStarted[0];
  const waitingFor = first.dependsOn
    .filter((d) => status[d].state !== "done")
    .map((d) => stages.find((x) => x.id === d)!);
  return { ready, waiting: { stage: first, waitingFor } };
}

/**
 * Plain-language version of a raw (internal) blocked reason. Free text is never
 * repeated to a client; unknown reasons become a generic phrase.
 */
export function plainReason(raw: string | undefined): string {
  const GENERIC = "waiting on a site issue that is being sorted out";
  // The quick-reason chip comes first ("Workers not available: ..."), so classify it before any free text.
  const text = (raw ?? "").toLowerCase();
  const head = text.split(/\s[\u2014-]\s|:/)[0];
  const a = classifyReason(head);
  return a !== GENERIC ? a : classifyReason(text);
}

function classifyReason(r: string): string {
  if (/material|stock|delivery|deliver|not arrived|supply|tiles?|plywood|paint not|fixture/.test(r)) {
    return "waiting for material to be delivered";
  }
  if (/worker|labou?r|carpenter|painter|mistri|crew|team|manpower|absent|not available/.test(r)) {
    return "waiting for the work team to be available";
  }
  if (/client|decision|approval|approve|confirm|selection|choice|pending from/.test(r)) {
    return "waiting for a decision to be confirmed";
  }
  if (/previous|earlier|prior|before|dependency|not finished|incomplete|stage/.test(r)) {
    return "waiting for earlier work to be completed";
  }
  return "waiting on a site issue that is being sorted out";
}

// ---------- flags & health ---------------------------------------------------

export type FlagKind = "blocked" | "late" | "not_started" | "stale";
export interface Flag {
  kind: FlagKind;
  severity: "warn" | "bad";
  stageId?: string;
  text: string; // OWNER-facing; may contain raw internal reasons
}

export type Health = "ok" | "warn" | "bad";
export const LATE_BAD_DAYS = 4; // heading this many days late (or more) = needs attention
export const STALE_DAYS = 2;

export interface Schedule {
  plan: PlanMap;
  status: StatusMap;
  forecast: PlanMap;
  plannedEnd: ISODate;
  forecastEnd: ISODate;
  slipDays: number; // forecast end - planned end (negative = ahead)
  percent: number;
  complete: boolean;
  lastCheckinDate: ISODate | null;
  flags: Flag[];
  nextUp: NextUp;
  health: Health;
}

export function computeSchedule(
  project: Pick<Project, "stages" | "startDate">,
  checkins: Checkin[],
  today: ISODate,
): Schedule {
  const { stages } = project;
  const plan = buildPlan(stages, project.startDate);
  const status = replay(stages, checkins);
  const fc = forecast(stages, plan, status, today);
  const pEnd = plannedEnd(plan);
  const complete = stages.every((s) => status[s.id].state === "done");
  const fEnd = maxDate(...Object.values(fc).map((r) => r.end));
  const slipDays = diffDays(fEnd, pEnd);
  const percent = overallPercent(stages, status);
  const lastCheckinDate = checkins.length ? sortCheckins(checkins)[checkins.length - 1].date : null;

  const flags: Flag[] = [];
  const byId = (id: string) => stages.find((s) => s.id === id)!;
  if (!complete) {
    for (const s of stages) {
      const st = status[s.id];
      if (st.state === "blocked") {
        flags.push({
          kind: "blocked",
          severity: "bad",
          stageId: s.id,
          text: `${s.name} is blocked: ${st.blockedReason || "no reason given"}`,
        });
      }
    }
    if (slipDays >= 1) {
      flags.push({
        kind: "late",
        severity: slipDays >= LATE_BAD_DAYS ? "bad" : "warn",
        text: `Heading ${plural(slipDays, "day")} late (handover ${fmtDate(fEnd)})`,
      });
    }
    for (const s of stages) {
      const st = status[s.id];
      const ready = s.dependsOn.every((d) => status[d].state === "done");
      if (st.state === "not_started" && ready && plan[s.id].start < today) {
        flags.push({
          kind: "not_started",
          severity: "warn",
          stageId: s.id,
          text: `${byId(s.id).name} should have started on ${fmtDate(plan[s.id].start)} but has not`,
        });
      }
    }
    const reference = lastCheckinDate ?? project.startDate;
    const quietDays = diffDays(today, reference);
    if (today >= project.startDate && quietDays >= STALE_DAYS) {
      flags.push({
        kind: "stale",
        severity: "warn",
        text: lastCheckinDate
          ? `No site update for ${plural(quietDays, "day")}`
          : `No site update since the project started ${plural(quietDays, "day")} ago`,
      });
    }
  }
  return {
    plan,
    status,
    forecast: fc,
    plannedEnd: pEnd,
    forecastEnd: fEnd,
    slipDays,
    percent,
    complete,
    lastCheckinDate,
    flags,
    nextUp: nextUp(stages, status),
    health: healthOf(flags),
  };
}

export function healthOf(flags: Flag[]): Health {
  if (flags.some((f) => f.severity === "bad")) return "bad";
  if (flags.length) return "warn";
  return "ok";
}

export const HEALTH_LABEL: Record<Health, string> = {
  ok: "On track",
  warn: "Watch",
  bad: "Needs attention",
};

/** Sort key for the dashboard: most urgent first. */
export function urgencyScore(s: Schedule, pending: number): number {
  if (s.complete) return pending; // finished projects sit below every active one
  const h = s.health === "bad" ? 3000 : s.health === "warn" ? 2000 : 1000;
  return h + Math.max(0, s.slipDays) * 10 + pending;
}

/** Stage rows for the timeline (planned vs expected on one date axis). */
export interface TimelineRow {
  id: string;
  name: string;
  short: string;
  state: StageState;
  percent: number;
  planned: DateRange;
  expected: DateRange;
}
export function timelineRows(stages: Stage[], s: Schedule): TimelineRow[] {
  return stages.map((st) => ({
    id: st.id,
    name: st.name,
    short: st.short,
    state: s.status[st.id].state,
    percent: s.status[st.id].percent,
    planned: s.plan[st.id],
    expected: s.forecast[st.id],
  }));
}
