import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AmcEditor, type AmcForm, type AmcSummary } from "@/components/AmcEditor";
import { ApprovalCard, type ApprovalItem } from "@/components/ApprovalCard";
import { PublishedFeedEditor } from "@/components/FeedPicker";
import { PhotoGrid } from "@/components/PhotoGrid";
import { ProjectSettings } from "@/components/ProjectSettings";
import { ShareBox } from "@/components/ShareBox";
import { Timeline } from "@/components/Timeline";
import { HealthBadge, Kpi, Loading, ProgressBar, TopBar } from "@/components/ui";
import { aiConfigured } from "@/lib/ai";
import { AMC_LABEL, AMC_TONE, computeAmc } from "@/lib/amc";
import { resolveToken } from "@/lib/auth";
import { fmtDate, fmtLong, istDateOf, plural, todayIST } from "@/lib/dates";
import { slipPhrase, templateDraft } from "@/lib/draft";
import { completionDate, computeSchedule, sortCheckins, timelineRows } from "@/lib/schedule";
import { getStore } from "@/lib/store";
import type { Checkin, Project, StageState } from "@/lib/types";

export const metadata = { title: "Project" };

export default function Page({ params }: PageProps<"/a/[token]/[projectId]">) {
  return (
    <Suspense fallback={<Loading />}>
      <ProjectPage params={params} />
    </Suspense>
  );
}

const STATE_TEXT: Record<StageState, string> = { not_started: "Not started", working: "Working", blocked: "Blocked", done: "Done" };

function photoUrls(c: Checkin, project: Project, token: string) {
  return c.photos.map((p) => ({
    url: `/api/photos/${project.id}/${p.fileName}?t=${token}`,
    alt: `Photo: ${project.stages.find((s) => s.id === p.stageId)?.name ?? "site"}`,
  }));
}

async function ProjectPage({ params }: Pick<PageProps<"/a/[token]/[projectId]">, "params">) {
  const { token, projectId } = await params;
  await connection();
  const store = getStore();
  const who = await resolveToken(store, token);
  if (who?.role !== "owner") notFound();
  const project = await store.getProject(projectId);
  if (!project) notFound();

  const today = todayIST();
  const checkins = await store.listCheckins(projectId);
  const s = computeSchedule(project, checkins, today);
  const sorted = sortCheckins(checkins);
  const pending = sorted.filter((c) => c.review === "pending");
  const published = sorted.filter((c) => c.review === "approved").reverse();
  const supervisor = await store.getSupervisor(project.supervisorId);
  const stageName = (id: string) => project.stages.find((x) => x.id === id)?.name ?? id;

  const items: ApprovalItem[] = pending.map((c) => ({
    id: c.id,
    dateLabel: fmtDate(c.date),
    supervisor: supervisor?.name ?? "Supervisor",
    stages: c.updates.map((u) => ({
      name: stageName(u.stageId),
      label: STATE_TEXT[u.state] + (u.percent !== undefined && u.state !== "not_started" ? ` · ${u.percent}%` : ""),
      detail: u.blockedReason,
    })),
    note: c.note,
    photos: photoUrls(c, project, token),
    location: c.location
      ? {
          text: `${c.location.lat.toFixed(4)}, ${c.location.lng.toFixed(4)}${c.location.accuracy ? ` (±${c.location.accuracy} m)` : ""}`,
          mapUrl: `https://www.google.com/maps?q=${c.location.lat},${c.location.lng}`,
        }
      : null,
    draft: c.draftMessage ?? templateDraft({ project, checkin: c, allCheckins: checkins, today }),
    feed: project.showcase ? { photos: c.photos.map((p, i) => ({ fileName: p.fileName, url: photoUrls(c, project, token)[i].url, alt: photoUrls(c, project, token)[i].alt })) } : undefined,
  }));

  let amcForm: AmcForm | null = null;
  let amcSummary: AmcSummary | null = null;
  if (project.amc) {
    const a = project.amc;
    const v = computeAmc(a, completionDate(project.stages, checkins), s.forecastEnd, today);
    amcForm = { plan: a.plan, startsOn: a.startsOn === "handover" ? "handover" : "date", startDate: a.startsOn === "handover" ? today : a.startsOn, months: a.months, visits: a.visits, coverage: a.coverage.join("\n"), purchasedOn: a.purchasedOn ?? "" };
    amcSummary = {
      statusLabel: AMC_LABEL[v.status],
      tone: AMC_TONE[v.status],
      line: v.startDate && v.endDate ? `${a.plan}: ${fmtLong(v.startDate)} to ${fmtLong(v.endDate)}${v.daysLeft !== null ? ` (${v.daysLeft} days left)` : ""}` : `${a.plan}: starts at handover (expected from ${fmtLong(v.expectedStart!)})`,
      visits: `${v.visitsUsed} of ${v.visitsIncluded} visits used`,
      next: v.nextVisitDue ? `${v.nextVisitOverdue ? "overdue since" : "next due"} ${fmtDate(v.nextVisitDue)}` : null,
      log: v.visitLog.map((x) => ({ date: fmtDate(x.date), note: x.note })),
    };
  }

  const rows = timelineRows(project.stages, s);
  const axisStart = [...rows.flatMap((r) => [r.planned.start, r.expected.start]), today].sort()[0];
  const axisEnd = [...rows.flatMap((r) => [r.planned.end, r.expected.end]), today].sort().slice(-1)[0];

  return (
    <main className="wrap wide stack">
      <TopBar title="Design by Aarav" role="Owner" />
      <div>
        <Link href={`/a/${token}`} className="backlink">← All projects</Link>
        <div className="row between" style={{ marginTop: 6 }}>
          <h1 style={{ margin: 0 }}>{project.name}</h1>
          <HealthBadge health={s.health} />
        </div>
        <p className="muted small break">{project.clientName} · {project.address}</p>
      </div>

      <div className="kpis">
        <Kpi value={`${s.percent}%`} label="Complete" testId="kpi-percent" />
        <Kpi value={fmtDate(s.forecastEnd)} label={s.complete ? "Handed over" : `Expected handover · ${slipPhrase(s.slipDays)}`} tone={s.slipDays >= 4 ? "bad" : s.slipDays > 0 ? "warn" : undefined} testId="kpi-handover" />
        <Kpi value={pending.length} label="Waiting for approval" tone={pending.length ? "warn" : undefined} testId="kpi-pending" />
        <Kpi value={s.lastCheckinDate ? fmtDate(s.lastCheckinDate) : "None yet"} label="Last site update" />
      </div>
      {pending.length > 0 && <p className="note" data-testid="includes-pending">These numbers include {plural(pending.length, "update")} you have not published yet. The client still sees the last published state.</p>}

      <div className="split stack">
        <div className="stack">
          <section aria-labelledby="queue-h">
            <h2 id="queue-h">Approval queue {pending.length ? `(${pending.length})` : ""}</h2>
            {items.length ? items.map((it) => <ApprovalCard key={it.id} item={it} token={token} aiEnabled={aiConfigured()} />) : <div className="card muted" data-testid="queue-empty">Nothing is waiting. You are all caught up.</div>}
          </section>

          <section className="card" aria-labelledby="feed-h" data-testid="published-feed">
            <h2 id="feed-h">Published updates</h2>
            {published.length === 0 && <p className="muted">Nothing has been published to the client yet.</p>}
            {published.map((c) => (
              <div className="update" key={c.id} data-testid="published-item">
                <div className="when">{fmtDate(c.date)} <span className="muted small">· published {fmtDate(istDateOf(c.approvedAt ?? c.createdAt))}</span></div>
                <div className="msg pre small">{c.clientMessage}</div>
                <PhotoGrid photos={photoUrls(c, project, token)} />
                {project.showcase && c.photos.length > 0 && (
                  <PublishedFeedEditor
                    token={token}
                    checkinId={c.id}
                    photos={c.photos.map((p, i) => ({ fileName: p.fileName, url: photoUrls(c, project, token)[i].url, alt: photoUrls(c, project, token)[i].alt }))}
                    initialSelected={(c.showcase ?? []).map((x) => x.fileName)}
                    initialCaption={c.showcaseCaption ?? ""}
                  />
                )}
              </div>
            ))}
          </section>
        </div>

        <div className="stack">
          <section className="card" aria-labelledby="flags-h">
            <h2 id="flags-h">Flags</h2>
            {s.flags.length ? (
              <ul className="flaglist" data-testid="flags">{s.flags.map((f) => <li key={f.text} className={f.severity}>{f.text}</li>)}</ul>
            ) : <p className="muted">No flags. This project is on track.</p>}
            <ProgressBar percent={s.percent} tone={s.health} label="Overall progress" />
          </section>
          <AmcEditor token={token} projectId={project.id} today={today} form={amcForm} summary={amcSummary} />
          <ProjectSettings token={token} projectId={project.id} initial={{ showcase: project.showcase, homeType: project.homeType, style: project.style ?? "", clientPhone: project.clientPhone ?? "" }} />
          <ShareBox clientPath={`/c/${project.clientToken}`} supervisorPath={`/s/${supervisor?.token ?? ""}`} firstName={project.clientName.split(" ")[0]} projectName={project.name} phone={project.clientPhone} />
        </div>
      </div>

      <section className="card" aria-labelledby="tl-h">
        <h2 id="tl-h">Timeline</h2>
        <Timeline rows={rows} axisStart={axisStart} axisEnd={axisEnd} today={today} />
      </section>
    </main>
  );
}
