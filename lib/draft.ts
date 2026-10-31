/**
 * Client-message drafting. The TEMPLATE draft is plain code; the optional AI
 * rewrite (lib/ai.ts) must pass guardAiDraft() or we fall back to the template.
 */
import { fmtDate, MONTH_NAMES, plural } from "./dates";
import { computeSchedule, plainReason, sortCheckins, type Schedule } from "./schedule";
import type { Checkin, ISODate, Project, StatusMap } from "./types";
import { replay } from "./schedule";

export function firstName(clientName: string): string {
  return clientName.trim().split(/\s+/)[0] || "there";
}

export function slipPhrase(slipDays: number): string {
  if (slipDays > 0) return `${plural(slipDays, "day")} later than planned`;
  if (slipDays < 0) return `${plural(-slipDays, "day")} ahead of plan`;
  return "on schedule";
}

export interface DraftContext {
  project: Project;
  checkin: Checkin;
  allCheckins: Checkin[]; // every check-in of the project (any review state)
  today: ISODate;
}

/** State "as it will be after this check-in": everything up to and including it. */
export function stateAfter(ctx: DraftContext): { before: StatusMap; schedule: Schedule } {
  const sorted = sortCheckins(ctx.allCheckins);
  const idx = sorted.findIndex((c) => c.id === ctx.checkin.id);
  const upTo = idx === -1 ? [...sorted, ctx.checkin] : sorted.slice(0, idx + 1);
  const prior = idx === -1 ? sorted : sorted.slice(0, idx);
  return {
    before: replay(ctx.project.stages, prior),
    schedule: computeSchedule(ctx.project, upTo, ctx.today),
  };
}

export function changeLines(ctx: DraftContext, before: StatusMap): string[] {
  const lines: string[] = [];
  for (const u of ctx.checkin.updates) {
    const stage = ctx.project.stages.find((s) => s.id === u.stageId);
    const prev = before[u.stageId];
    if (!stage || !prev) continue;
    const pct = u.percent ?? prev.percent;
    switch (u.state) {
      case "done":
        if (prev.state !== "done") lines.push(`${stage.name} completed`);
        break;
      case "working":
        if (prev.state === "working" && prev.percent === pct) lines.push(`${stage.name} continues (${pct}% done)`);
        else if (prev.state === "not_started") lines.push(`${stage.name} started (${pct}% done)`);
        else if (prev.state === "blocked") lines.push(`${stage.name} is back in progress (${pct}% done)`);
        else if (prev.state === "done") lines.push(`${stage.name} reopened for finishing work`);
        else lines.push(`${stage.name} in progress (${pct}% done)`);
        break;
      case "blocked":
        lines.push(`${stage.name} is on hold: ${plainReason(u.blockedReason)}`);
        break;
      case "not_started":
        if (prev.state !== "not_started") lines.push(`${stage.name} moved back to not started`);
        break;
    }
  }
  return lines;
}

export function templateDraft(ctx: DraftContext): string {
  const { before, schedule } = stateAfter(ctx);
  const lines = changeLines(ctx, before);
  const head = ctx.checkin.date === ctx.today ? "Today at site:" : `On ${fmtDate(ctx.checkin.date)} at site:`;
  const out = [`Hi ${firstName(ctx.project.clientName)},`, head];
  if (lines.length) for (const l of lines) out.push(`• ${l}`);
  else out.push("• Site visited, no change in progress to report.");

  const { ready, waiting } = schedule.nextUp;
  const names = (ids: { name: string }[]) => ids.map((s) => s.name);
  if (ready.length) {
    out.push(`Next up: ${names(ready).join(", ")}`);
  } else if (waiting) {
    const w = names(waiting.waitingFor);
    out.push(`Next up: ${waiting.stage.name} (once ${w.join(" and ")} ${w.length > 1 ? "are" : "is"} done)`);
  }
  if (schedule.complete) out.push("All stages are complete.");
  else out.push(`Expected handover: ${fmtDate(schedule.forecastEnd)} (${slipPhrase(schedule.slipDays)})`);
  return out.join("\n");
}

/** Every date the schedule computed for this project: the only dates a client text may mention. */
export function allowedDates(project: Project, schedule: Schedule, extra: ISODate[] = []): ISODate[] {
  const set = new Set<ISODate>([project.startDate, ...extra]);
  for (const r of [...Object.values(schedule.plan), ...Object.values(schedule.forecast)]) {
    set.add(r.start);
    set.add(r.end);
  }
  return [...set];
}

export function allowedDayCounts(schedule: Schedule): number[] {
  return [Math.abs(schedule.slipDays)];
}

// ---------- AI guard ---------------------------------------------------------

export interface GuardOptions {
  allowedDates: ISODate[];
  allowedDayCounts: number[];
  maxWords?: number;
}
export type GuardResult = { ok: true; text: string } | { ok: false; reason: string };

const MON = "(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const monthIndex = (m: string) => MONTH_NAMES.findIndex((n) => m.toLowerCase().startsWith(n.toLowerCase()));

export function guardAiDraft(raw: string, opts: GuardOptions): GuardResult {
  const text = (raw ?? "").trim();
  const maxWords = opts.maxWords ?? 110;
  if (!text) return { ok: false, reason: "the AI returned an empty message" };
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words > maxWords) return { ok: false, reason: `the AI message was too long (${words} words, limit ${maxWords})` };
  if (/https?:\/\/|www\.|wa\.me|\b[a-z0-9-]+\.(?:com|in|co|org|net|io|app|me|ly|info)\b/i.test(text)) {
    return { ok: false, reason: "the AI message contained a link" };
  }
  if (/\b(tomorrow|next week|next month|day after|this weekend|by (?:mon|tues|wednes|thurs|fri|satur|sun)day)\b/i.test(text)) {
    return { ok: false, reason: "the AI message made up a relative date" };
  }

  const allowed = opts.allowedDates.map((d) => ({ y: +d.slice(0, 4), m: +d.slice(5, 7) - 1, d: +d.slice(8, 10) }));
  const known = (d: number, m: number, y?: number) =>
    allowed.some((a) => a.d === d && a.m === m && (y === undefined || a.y === y));

  const bad: string[] = [];
  // ISO 2026-11-20
  for (const x of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    if (!known(+x[3], +x[2] - 1, +x[1])) bad.push(x[0]);
  }
  // 20 Nov / 20th November 2026
  for (const x of text.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MON}\\b(?:,?\\s+(\\d{4}))?`, "gi"))) {
    if (!known(+x[1], monthIndex(x[2]), x[3] ? +x[3] : undefined)) bad.push(x[0]);
  }
  // Nov 20 / November 20th, 2026
  for (const x of text.matchAll(new RegExp(`\\b${MON}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`, "gi"))) {
    if (!known(+x[2], monthIndex(x[1]), x[3] ? +x[3] : undefined)) bad.push(x[0]);
  }
  // 20/11, 20-11-2026, 20.11
  for (const x of text.matchAll(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/g)) {
    const a = +x[1], b = +x[2];
    if (!known(a, b - 1) && !known(b, a - 1)) bad.push(x[0]);
  }
  if (bad.length) return { ok: false, reason: `the AI message mentioned a date the schedule did not compute (${bad[0]})` };

  for (const x of text.matchAll(/\b(\d+)(?:\s*-\s*(\d+))?\s*(?:working\s+|more\s+)?days?\b/gi)) {
    for (const n of [x[1], x[2]].filter(Boolean).map(Number)) {
      if (!opts.allowedDayCounts.includes(n)) return { ok: false, reason: `the AI message used a day count the schedule did not compute (${x[0]})` };
    }
  }
  if (/\b\d+\s*(?:weeks?|months?)\b/i.test(text)) return { ok: false, reason: "the AI message used a week/month estimate" };
  return { ok: true, text };
}
