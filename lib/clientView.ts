/**
 * THE client privacy boundary. Everything a client can see is built here from
 * APPROVED check-ins only, and contains no address/locality, GPS, supervisor
 * name or notes, raw internal reasons, or other roles' tokens. Pages must pass
 * only this object (never Project/Checkin) to anything client-facing.
 */
import { AMC_LABEL, AMC_TONE, computeAmc, type AmcStatus } from "./amc";
import { fmtDate, fmtLong } from "./dates";
import { slipPhrase, firstName } from "./draft";
import { buildFeed, buildFinishedHomes, type FeedPost, type FinishedHome } from "./feed";
import { completionDate, computeSchedule, plainReason, timelineRows, type TimelineRow } from "./schedule";
import type { Checkin, Interest, ISODate, Project } from "./types";

export interface ClientPhoto { url: string; alt: string }
export interface ClientUpdate { id: string; dateLabel: string; message: string; photos: ClientPhoto[] }
export interface ClientNow { id: string; name: string; percent: number; state: "working" | "blocked"; reason?: string; expected: string }

export interface ClientAmc {
  plan: string;
  status: AmcStatus;
  statusLabel: string;
  tone: "ok" | "warn" | "bad" | "info";
  validity: string | null; // "12 Dec 2026 to 11 Dec 2027"
  startsNote: string | null; // while the project is not handed over yet
  daysLeft: number | null;
  visitsIncluded: number;
  visitsUsed: number;
  nextVisit: string | null;
  nextVisitOverdue: boolean;
  coverage: string[];
  visitLog: { date: string; note: string }[];
  needsRenewal: boolean;
  contactHref: string; // WhatsApp link to the studio
}

export interface ClientView {
  studioName: string;
  projectName: string;
  clientFirstName: string;
  percent: number;
  complete: boolean;
  hasUpdates: boolean;
  plannedHandover: string;
  expectedHandover: string;
  slipDays: number;
  headline: { tone: "ok" | "late" | "ahead" | "none"; text: string };
  lastUpdate: string | null;
  now: ClientNow[];
  upNext: string[];
  timeline: { rows: TimelineRow[]; today: ISODate; axisStart: ISODate; axisEnd: ISODate };
  updates: ClientUpdate[];
  feed: FeedPost[]; // other sites, consent-gated and anonymised (see lib/feed.ts)
  finished: FinishedHome[]; // the common gallery of other clients' finished homes (same gate)
  interested: string[]; // feed post ids this client already asked about
  amc: ClientAmc | null; // only when this client bought an AMC
  studioHref: string; // WhatsApp link to the studio
}

export interface ClientViewInput {
  project: Project;
  studioName: string;
  studioPhone?: string;
  projects: Project[]; // all projects (feed source); never serialised into the view
  checkins: Checkin[]; // all check-ins
  interests: Interest[];
  today: ISODate;
}

const waLink = (phone: string | undefined, text: string) => `https://wa.me/${phone ?? ""}?text=${encodeURIComponent(text)}`;

export function buildClientView({ project, studioName, studioPhone, projects, checkins: allCheckins, interests, today }: ClientViewInput): ClientView {
  const approved = allCheckins.filter((c) => c.projectId === project.id && c.review === "approved");
  const s = computeSchedule(project, approved, today);
  const rows = timelineRows(project.stages, s);
  const hasUpdates = approved.length > 0;
  const stageById = new Map(project.stages.map((x) => [x.id, x]));

  const now: ClientNow[] = project.stages
    .filter((st) => s.status[st.id].state === "working" || s.status[st.id].state === "blocked")
    .map((st) => {
      const stt = s.status[st.id];
      return {
        id: st.id, name: st.name, percent: stt.percent, state: stt.state as "working" | "blocked",
        reason: stt.state === "blocked" ? plainReason(stt.blockedReason) : undefined,
        expected: fmtDate(s.forecast[st.id].end),
      };
    });

  const upNext: string[] = [];
  for (const st of s.nextUp.ready) upNext.push(st.name);
  if (s.nextUp.waiting) {
    const w = s.nextUp.waiting.waitingFor.map((x) => x.name);
    upNext.push(`${s.nextUp.waiting.stage.name} (starts once ${w.join(" and ")} ${w.length > 1 ? "are" : "is"} done)`);
  }

  let headline: ClientView["headline"];
  if (!hasUpdates) headline = { tone: "none", text: "The first site update will appear here soon" };
  else if (s.complete) headline = { tone: "ok", text: "All work is complete" };
  else if (s.slipDays > 0) headline = { tone: "late", text: `${s.slipDays} ${s.slipDays === 1 ? "day" : "days"} behind the original plan` };
  else if (s.slipDays < 0) headline = { tone: "ahead", text: slipPhrase(s.slipDays) };
  else headline = { tone: "ok", text: "On schedule" };

  const starts = rows.flatMap((r) => [r.planned.start, r.expected.start]);
  const ends = rows.flatMap((r) => [r.planned.end, r.expected.end]);
  const axisStart = [...starts, today].sort()[0];
  const axisEnd = [...ends, today].sort().slice(-1)[0];

  const updates: ClientUpdate[] = [...approved]
    .sort((a, b) => (a.date === b.date ? b.createdAt.localeCompare(a.createdAt) : b.date.localeCompare(a.date)))
    .map((c) => ({
      id: c.id,
      dateLabel: fmtDate(c.date),
      message: c.clientMessage ?? "",
      photos: c.photos.map((p) => ({
        url: `/api/photos/${project.id}/${p.fileName}?t=${project.clientToken}`,
        alt: `Photo: ${stageById.get(p.stageId)?.name ?? "site"}`,
      })),
    }));

  let amc: ClientAmc | null = null;
  if (project.amc) {
    const v = computeAmc(project.amc, completionDate(project.stages, approved), s.forecastEnd, today);
    amc = {
      plan: v.plan,
      status: v.status,
      statusLabel: AMC_LABEL[v.status],
      tone: AMC_TONE[v.status],
      validity: v.startDate && v.endDate ? `${fmtLong(v.startDate)} to ${fmtLong(v.endDate)}` : null,
      startsNote: v.expectedStart ? `Your AMC begins once the work is handed over (expected from ${fmtLong(v.expectedStart)}).` : null,
      daysLeft: v.daysLeft,
      visitsIncluded: v.visitsIncluded,
      visitsUsed: v.visitsUsed,
      nextVisit: v.nextVisitDue ? fmtDate(v.nextVisitDue) : null,
      nextVisitOverdue: v.nextVisitOverdue,
      coverage: v.coverage,
      visitLog: v.visitLog.map((x) => ({ date: fmtDate(x.date), note: x.note })),
      needsRenewal: v.needsRenewal,
      contactHref: waLink(studioPhone, `Hi, I would like to ${v.status === "expired" ? "renew" : v.needsRenewal ? "renew" : "ask about"} the AMC for ${project.name}.`),
    };
  }
  const feed = buildFeed(project, projects, allCheckins, today);
  const finished = buildFinishedHomes(project, projects, allCheckins, interests, today);
  const postIds = new Set([...feed.map((p) => p.id), ...finished.map((h) => h.id)]);

  return {
    studioName,
    projectName: project.name,
    clientFirstName: firstName(project.clientName),
    percent: s.percent,
    complete: s.complete,
    hasUpdates,
    plannedHandover: fmtDate(s.plannedEnd),
    expectedHandover: fmtDate(s.forecastEnd),
    slipDays: s.slipDays,
    headline,
    lastUpdate: hasUpdates ? fmtDate(approved.reduce((m, c) => (c.date > m ? c.date : m), "0000-00-00")) : null,
    now,
    upNext,
    timeline: { rows, today, axisStart, axisEnd },
    updates,
    feed,
    finished,
    interested: interests.filter((i) => i.projectId === project.id && postIds.has(i.showcaseId)).map((i) => i.showcaseId),
    amc,
    studioHref: waLink(studioPhone, `Hi, this is ${firstName(project.clientName)} (${project.name}).`),
  };
}
