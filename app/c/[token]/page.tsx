import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { InspirationFeed } from "@/components/InspirationFeed";
import { PhotoGrid } from "@/components/PhotoGrid";
import { Timeline } from "@/components/Timeline";
import { Loading, ProgressBar, TopBar } from "@/components/ui";
import { resolveToken } from "@/lib/auth";
import { buildClientView } from "@/lib/clientView";
import { todayIST } from "@/lib/dates";
import { getStore } from "@/lib/store";

export const metadata = { title: "Your project" };

export default function Page({ params }: PageProps<"/c/[token]">) {
  return (
    <Suspense fallback={<Loading />}>
      <ClientPage params={params} />
    </Suspense>
  );
}

async function ClientPage({ params }: Pick<PageProps<"/c/[token]">, "params">) {
  const { token } = await params;
  await connection();
  const store = getStore();
  const who = await resolveToken(store, token);
  if (who?.role !== "client") notFound();
  const [studio, projects, checkins, interests] = await Promise.all([store.getStudio(), store.listProjects(), store.listCheckins(), store.listInterests()]);
  // Only the client-safe view model crosses this line: approved updates, consented/anonymised feed, no internal fields.
  const v = buildClientView({ project: who.project, studioName: studio.name, studioPhone: studio.phone, projects, checkins, interests, today: todayIST() });

  return (
    <main className="wrap stack" data-testid="client-page">
      <TopBar title={v.studioName} role="Your project" />

      <section className="hero" aria-label="Project summary">
        <p style={{ margin: 0, opacity: 0.9 }}>Hi {v.clientFirstName}, here is where things stand</p>
        <h1>{v.projectName}</h1>
        <div className="pct" data-testid="hero-percent">{v.percent}%</div>
        <div className="bar" role="progressbar" aria-valuenow={v.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Overall progress"><i style={{ width: `${v.percent}%` }} /></div>
        <span className={`headline ${v.headline.tone}`} data-testid="headline">{v.headline.text}</span>
        <dl>
          <div><dt>Expected handover</dt><dd data-testid="expected-handover">{v.hasUpdates ? v.expectedHandover : v.plannedHandover}</dd></div>
          <div><dt>Originally planned</dt><dd>{v.plannedHandover}</dd></div>
          <div><dt>Last update</dt><dd data-testid="last-update">{v.lastUpdate ?? "Not yet"}</dd></div>
        </dl>
      </section>

      <nav className="subnav" aria-label="Sections" data-testid="subnav">
        <a href="#progress">My project</a>
        {v.feed.length > 0 && <a href="#inspiration" data-testid="nav-inspiration">Inspiration</a>}
        {v.amc && <a href="#amc" data-testid="nav-amc">AMC</a>}
      </nav>

      <div id="progress" className="stack scroll-target">
        <section className="card" aria-labelledby="now-h" data-testid="happening-now">
          <h2 id="now-h">Happening now</h2>
          {v.now.length === 0 && <p className="muted">{v.complete ? "All work is complete." : v.hasUpdates ? "No work is in progress at this moment." : "Work will be shown here after the first update."}</p>}
          {v.now.map((n) => (
            <div className="now-item" key={n.id}>
              <div className="row between"><span className="strong">{n.name}</span><span className="small muted">{n.percent}% done</span></div>
              <ProgressBar percent={n.percent} tone={n.state === "blocked" ? "bad" : undefined} label={`${n.name} progress`} />
              {n.state === "blocked"
                ? <p className="small" style={{ color: "var(--bad)", fontWeight: 600, margin: "6px 0 0" }} data-testid="on-hold">On hold: {n.reason}</p>
                : <p className="small muted" style={{ margin: "6px 0 0" }}>Expected to finish around {n.expected}</p>}
            </div>
          ))}
        </section>

        {v.upNext.length > 0 && (
          <section className="card" aria-labelledby="next-h" data-testid="up-next">
            <h2 id="next-h">Up next</h2>
            <ul style={{ margin: 0, paddingLeft: 20 }}>{v.upNext.map((t) => <li key={t}>{t}</li>)}</ul>
          </section>
        )}

        <section className="card" aria-labelledby="tl-h">
          <h2 id="tl-h">Timeline</h2>
          <Timeline rows={v.timeline.rows} axisStart={v.timeline.axisStart} axisEnd={v.timeline.axisEnd} today={v.timeline.today} />
        </section>

        <section className="card" aria-labelledby="up-h" data-testid="updates">
          <h2 id="up-h">Updates from site</h2>
          {v.updates.length === 0 && <p className="muted">The first update from the site will appear here soon.</p>}
          {v.updates.map((u) => (
            <article className="update" key={u.id} data-testid="update">
              <div className="when">{u.dateLabel}</div>
              <div className="msg pre">{u.message}</div>
              <PhotoGrid photos={u.photos} />
            </article>
          ))}
        </section>
      </div>

      {v.feed.length > 0 && (
        <section id="inspiration" className="card scroll-target" aria-labelledby="insp-h" data-testid="inspiration">
          <h2 id="insp-h">Inspiration from our other sites</h2>
          <p className="muted small">Work in progress and finished looks from homes we are designing, shared with the owners&apos; permission. Tap a photo to enlarge it. Like something? Tell us and we will plan a similar design for your home.</p>
          <InspirationFeed posts={v.feed} token={token} interested={v.interested} />
        </section>
      )}

      {v.amc && (
        <section id="amc" className="card scroll-target" aria-labelledby="amc-h" data-testid="amc-card">
          <div className="row between">
            <h2 id="amc-h" style={{ margin: 0 }}>Annual Maintenance Contract</h2>
            <span className={`badge ${v.amc.tone}`} data-testid="amc-status">{v.amc.statusLabel}</span>
          </div>
          <p className="strong" style={{ margin: "8px 0 2px" }}>{v.amc.plan}</p>
          {v.amc.validity && <p className="muted small" style={{ margin: 0 }} data-testid="amc-validity">Valid {v.amc.validity}{v.amc.daysLeft !== null ? ` · ${v.amc.daysLeft} ${v.amc.daysLeft === 1 ? "day" : "days"} left` : ""}</p>}
          {v.amc.startsNote && <p className="muted small" style={{ margin: 0 }} data-testid="amc-starts">{v.amc.startsNote}</p>}

          <div style={{ margin: "14px 0 6px" }}>
            <div className="row between small"><span className="strong">Service visits</span><span data-testid="amc-visits">{v.amc.visitsUsed} of {v.amc.visitsIncluded} used</span></div>
            <ProgressBar percent={v.amc.visitsIncluded ? Math.round((v.amc.visitsUsed / v.amc.visitsIncluded) * 100) : 0} label="AMC visits used" />
            {v.amc.nextVisit && <p className="small" style={{ margin: "6px 0 0", color: v.amc.nextVisitOverdue ? "var(--bad)" : undefined }} data-testid="amc-next">{v.amc.nextVisitOverdue ? "Visit due since" : "Next visit due"}: <span className="strong">{v.amc.nextVisit}</span></p>}
          </div>

          {v.amc.coverage.length > 0 && (
            <>
              <h3 style={{ marginTop: 14 }}>What is covered</h3>
              <ul style={{ margin: 0, paddingLeft: 20 }}>{v.amc.coverage.map((c) => <li key={c}>{c}</li>)}</ul>
            </>
          )}
          {v.amc.visitLog.length > 0 && (
            <>
              <h3 style={{ marginTop: 14 }}>Visits so far</h3>
              {v.amc.visitLog.map((x) => <div className="update" key={x.date + x.note} data-testid="amc-visit"><div className="when">{x.date}</div><div className="small">{x.note}</div></div>)}
            </>
          )}
          {v.amc.needsRenewal && (
            <div className={`banner ${v.amc.status === "expired" ? "bad" : "warn"}`} style={{ marginTop: 14 }}>
              <p style={{ margin: "0 0 8px" }}>{v.amc.status === "expired" ? "Your AMC has ended." : "Your AMC is ending soon."} Renew to keep your home covered.</p>
              <a className="btn primary small" href={v.amc.contactHref} target="_blank" rel="noopener noreferrer" data-testid="amc-renew">Renew on WhatsApp</a>
            </div>
          )}
        </section>
      )}

      <div className="row between" style={{ justifyContent: "center" }}>
        <a className="btn small" href={v.studioHref} target="_blank" rel="noopener noreferrer" data-testid="contact-studio">Message the studio on WhatsApp</a>
      </div>
      <p className="note" style={{ textAlign: "center" }}>Dates are estimates based on the latest site update.</p>
    </main>
  );
}
