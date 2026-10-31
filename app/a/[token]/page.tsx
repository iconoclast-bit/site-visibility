import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { SupervisorsCard } from "@/components/SupervisorsCard";
import { HealthBadge, Kpi, Loading, ProgressBar, TopBar } from "@/components/ui";
import { resolveToken } from "@/lib/auth";
import { fmtDate, istDateOf, plural, todayIST } from "@/lib/dates";
import { slipPhrase } from "@/lib/draft";
import { findShowcase, homeLabel } from "@/lib/feed";
import { computeSchedule, urgencyScore } from "@/lib/schedule";
import { getStore } from "@/lib/store";

export const metadata = { title: "Dashboard" };

export default function Page({ params }: PageProps<"/a/[token]">) {
  return (
    <Suspense fallback={<Loading />}>
      <Dashboard params={params} />
    </Suspense>
  );
}

async function Dashboard({ params }: Pick<PageProps<"/a/[token]">, "params">) {
  const { token } = await params;
  await connection();
  const store = getStore();
  const who = await resolveToken(store, token);
  if (who?.role !== "owner") notFound();
  const today = todayIST();
  const [studio, projects, checkins, supervisors, interests] = await Promise.all([store.getStudio(), store.listProjects(), store.listCheckins(), store.listSupervisors(), store.listInterests()]);

  const rows = projects
    .map((p) => {
      const cs = checkins.filter((c) => c.projectId === p.id);
      const s = computeSchedule(p, cs, today); // owner sees the true state, pending updates included
      const pending = cs.filter((c) => c.review === "pending").length;
      return { p, s, pending };
    })
    .sort((a, b) => urgencyScore(b.s, b.pending) - urgencyScore(a.s, a.pending));

  const active = rows.filter((r) => !r.s.complete);
  const awaiting = rows.reduce((n, r) => n + r.pending, 0);
  const late = active.filter((r) => r.s.slipDays > 0).length;
  const stale = active.filter((r) => r.s.flags.some((f) => f.kind === "stale")).length;

  // Design interests: clients who tapped "I'd like something like this" on the inspiration feed.
  const interestRows = [...interests].reverse().slice(0, 12).map((i) => {
    const asker = projects.find((p) => p.id === i.projectId);
    const hit = findShowcase(i.showcaseId, projects, checkins);
    return {
      id: i.id,
      who: asker ? `${asker.clientName} (${asker.name})` : "A client",
      label: hit ? homeLabel(hit.project) : "a look that is no longer on the feed",
      photo: hit ? `/api/feed/${i.showcaseId}?t=${token}` : null,
      when: fmtDate(istDateOf(i.createdAt)),
      reply: asker ? `https://wa.me/${asker.clientPhone ?? ""}?text=${encodeURIComponent(`Hi ${asker.clientName.split(" ")[0]}, thanks for liking this design. Let's plan something similar for your home.`)}` : null,
    };
  });

  return (
    <main className="wrap wide stack">
      <TopBar title={studio.name} role="Owner" />
      <div className="row between">
        <h1 style={{ margin: 0 }}>Your projects</h1>
        <Link href={`/a/${token}/new`} className="btn primary" data-testid="new-project">+ New project</Link>
      </div>
      <div className="kpis">
        <Kpi value={active.length} label="Active sites" testId="kpi-active" />
        <Kpi value={awaiting} label="Awaiting approval" tone={awaiting ? "warn" : undefined} testId="kpi-awaiting" />
        <Kpi value={late} label="Running late" tone={late ? "bad" : undefined} testId="kpi-late" />
        <Kpi value={stale} label="No update in 2+ days" tone={stale ? "warn" : undefined} testId="kpi-stale" />
      </div>
      <div className="grid cols-2 cols-3">
        {rows.map(({ p, s, pending }) => (
          <Link key={p.id} href={`/a/${token}/${p.id}`} className="card link stack-sm" data-testid={`project-${p.slug}`}>
            <div className="row between">
              <h2 style={{ margin: 0 }}>{p.name}</h2>
              <HealthBadge health={s.health} />
            </div>
            <div className="small muted">{p.clientName}</div>
            <ProgressBar percent={s.percent} tone={s.health} label={`${p.name} progress`} />
            <div className="row between small">
              <span><span className="strong">{s.percent}%</span> complete</span>
              <span className="muted">Handover {fmtDate(s.forecastEnd)}</span>
            </div>
            <div className="small muted">{s.complete ? "All stages complete" : slipPhrase(s.slipDays)}</div>
            {s.flags[0] && <div className="small" style={{ color: s.flags[0].severity === "bad" ? "var(--bad)" : "var(--warn)", fontWeight: 600 }} data-testid="first-flag">{s.flags[0].text}</div>}
            {pending > 0 && <div><span className="badge warn" data-testid="pending-count">{plural(pending, "update")} waiting for approval</span></div>}
          </Link>
        ))}
      </div>
      {!rows.length && <div className="card muted" data-testid="no-projects">No projects yet. Add a supervisor below, then create your first project.</div>}

      <div className="split stack">
        <section className="card" aria-labelledby="int-h" data-testid="interests">
          <h2 id="int-h">Design interests {interests.length ? `(${interests.length})` : ""}</h2>
          <p className="muted small">Clients who tapped &ldquo;I&apos;d like something like this&rdquo; on the inspiration feed. A warm lead.</p>
          {interestRows.length === 0 && <p className="muted small" data-testid="no-interests">None yet.</p>}
          {interestRows.map((r) => (
            <div className="interest" key={r.id} data-testid="interest-row">
              {r.photo ? <img src={r.photo} alt={r.label} /> : <span className="thumb" style={{ width: 64, height: 64, marginRight: 12 }} />}
              <div className="grow small"><div><span className="strong">{r.who}</span> liked <span className="strong">{r.label}</span></div><div className="muted">{r.when}</div></div>
              {r.reply && <a className="btn small" href={r.reply} target="_blank" rel="noopener noreferrer">WhatsApp</a>}
            </div>
          ))}
        </section>
        <SupervisorsCard token={token} supervisors={supervisors.map((s) => ({ id: s.id, name: s.name, token: s.token, projects: s.projectIds.length }))} />
      </div>
    </main>
  );
}
