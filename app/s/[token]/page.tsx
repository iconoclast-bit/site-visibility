import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { OutboxBanner } from "@/components/OutboxBanner";
import { Loading, ProgressBar, TopBar } from "@/components/ui";
import { resolveToken } from "@/lib/auth";
import { fmtDate, todayIST } from "@/lib/dates";
import { computeSchedule } from "@/lib/schedule";
import { getStore } from "@/lib/store";

export const metadata = { title: "Today's sites" };

export default function Page({ params }: PageProps<"/s/[token]">) {
  return (
    <Suspense fallback={<Loading />}>
      <Sites params={params} />
    </Suspense>
  );
}

async function Sites({ params }: Pick<PageProps<"/s/[token]">, "params">) {
  const { token } = await params;
  await connection();
  const store = getStore();
  const who = await resolveToken(store, token);
  if (who?.role !== "supervisor") notFound();
  const today = todayIST();
  const [projects, checkins] = await Promise.all([store.listProjects(), store.listCheckins()]);
  const mine = projects.filter((p) => who.supervisor.projectIds.includes(p.id));

  return (
    <main className="wrap stack">
      <TopBar title="Site Visibility" role="Supervisor" />
      <div>
        <h1>Today&apos;s sites</h1>
        <p className="muted">{fmtDate(today)} · one quick check-in per site</p>
      </div>
      <OutboxBanner token={token} />
      <div className="stack">
        {mine.map((p) => {
          const cs = checkins.filter((c) => c.projectId === p.id);
          const sentToday = cs.some((c) => c.date === today);
          const s = computeSchedule(p, cs, today);
          return (
            <Link key={p.id} href={`/s/${token}/${p.id}`} className="card link" data-testid={`site-${p.slug}`}>
              <div className="row between">
                <h2 style={{ margin: 0 }}>{p.name}</h2>
                <span className={`badge ${sentToday ? "ok" : "warn"}`} data-testid="site-status">{sentToday ? "✓ Updated" : "Update due"}</span>
              </div>
              <p className="muted small break" style={{ margin: "4px 0 10px" }}>{p.address}</p>
              <ProgressBar percent={s.percent} label={`${p.name} progress`} />
              <div className="row between small muted" style={{ marginTop: 6 }}>
                <span>{s.percent}% complete</span>
                <span className="strong" style={{ color: "var(--brand)" }}>{sentToday ? "Send another →" : "Start check-in →"}</span>
              </div>
            </Link>
          );
        })}
        {!mine.length && <div className="card muted">No sites are assigned to this link yet.</div>}
      </div>
    </main>
  );
}
